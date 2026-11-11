'use strict';

/* Business rules: required documents, currency equivalents and validation.
   Pure functions of (application, settings, today) so they can be ported 1:1 to a backend service. */
const Rules = {
  settings() { return Store.state.settings; },

  toMWK(amount, ccy) {
    if (!ccy) return NaN;
    if (ccy === 'MWK') return Number(amount);
    const r = this.settings().rates[ccy];
    return r ? Number(amount) * r : NaN;
  },
  toUSD(amount, ccy) {
    return this.toMWK(amount, ccy) / this.settings().rates.USD;
  },

  isStudentCase(app) {
    return app.type === 'STUDENT_FEES' || (app.type === 'MAINTENANCE' && (app.details?.maintenanceFor || 'STUDENT') === 'STUDENT');
  },
  isTravel(app) { return !!TXN_TYPES[app.type]?.travel; },

  /* Travel allowance arithmetic: inclusive number of days between travel and return dates. */
  travel(app) {
    const s = this.settings();
    const d = app.details || {};
    const usd = this.toUSD(app.amount, app.currency);
    const out = { amountUSD: usd, ticketRequired: app.type === 'MEDICAL' || usd > s.ticketThresholdUSD, days: null, maxUSD: null, maxInCcy: null };
    if (d.travelDate && d.returnDate) {
      const days = U.daysBetween(d.travelDate, d.returnDate) + 1;
      if (days > 0) {
        out.days = days;
        out.maxUSD = days * s.perDiemUSD;
        const perUnitUSD = this.toUSD(1, app.currency);
        out.maxInCcy = perUnitUSD ? out.maxUSD / perUnitUSD : null;
      }
    }
    return out;
  },

  /* Document checklist for the application's transaction type. */
  requiredDocs(app) {
    const list = [];
    const add = (code, required = true, note = '') => list.push({ code, label: DOC_TYPES[code], required, note });
    switch (app.type) {
      case 'ADVANCE':
      case 'FREIGHT':
      case 'OPEN_ACCOUNT':
        add('INVOICE', true, app.type === 'ADVANCE' ? 'Required – imports only' : '');
        break;
      case 'GIFTS':
        add('BENEFICIARY_DETAILS', false, 'Beneficiary details must be captured in full');
        break;
      case 'STUDENT_FEES':
        add('ADMISSION'); add('FEES'); add('STUDENT_PASSPORT'); add('VISA', true, 'Expiry date required');
        break;
      case 'MAINTENANCE':
        if (this.isStudentCase(app)) {
          add('ADMISSION'); add('STUDENT_PASSPORT'); add('VISA', true, 'Expiry date required');
          add('SUPPORTING', false, 'e.g. rental agreement for rentals');
        } else {
          add('SUPPORTING', true, 'e.g. rental agreement for rentals');
        }
        add('PROOF');
        break;
      case 'CASH':
      case 'CASH_PASSPORT': {
        const t = this.travel(app);
        add('PASSPORT', true, 'Mandatory for travel');
        add('TICKET', t.ticketRequired, `Required above USD ${U.num(this.settings().ticketThresholdUSD, 0)} or equivalent`);
        break;
      }
      case 'MEDICAL':
        add('PASSPORT', true, 'Mandatory for travel'); add('REFERRAL'); add('MEDICAL_INVOICE'); add('TICKET');
        break;
    }
    const docs = app.documents || [];
    list.forEach(r => { r.files = docs.filter(f => f.code === r.code); r.present = r.files.length > 0; });
    return list;
  },

  /* ---------- one invoice, many applications ----------
     An invoice is identified by its number and the beneficiary (supplier) it is from. Across all applications for the
     same invoice, the total applied for (open applications) or paid (closed ones) can never exceed the invoice amount. */
  INVOICE_TYPES: ['ADVANCE', 'FREIGHT', 'OPEN_ACCOUNT'],

  invoiceKey(app) {
    if (!this.INVOICE_TYPES.includes(app.type)) return null;
    const n = String(app.details?.invoiceNumber || '').replace(/[\s\-_/.]+/g, '').toUpperCase();
    return n ? `${n}|${String(app.beneficiary?.name || '').trim().toLowerCase().replace(/\s+/g, ' ')}` : null;
  },

  /* Other applications for the same invoice and how much of it they use, in this application's currency. */
  invoiceUsage(app) {
    const key = this.invoiceKey(app);
    if (!key) return null;
    const conv = (amt, from) => (from === app.currency ? amt : this.toMWK(amt, from) / this.toMWK(1, app.currency));
    const others = Store.state.apps.filter(a => a.id !== app.id && Engine.inHistory(a) && !['REJECTED', 'EXPIRED'].includes(a.status) && this.invoiceKey(a) === key)
      .map(a => { const t = Engine.totals(a); return { ref: a.ref, status: a.status, used: U.round2(conv(['CLOSED', 'CANCELLED'].includes(a.status) ? t.paid : a.amount, a.currency)), paid: U.round2(conv(t.paid, a.currency)) }; });
    const invoice = Number(app.details?.invoiceAmount) || 0;
    const used = U.round2(U.sum(others, o => o.used)), paidElsewhere = U.round2(U.sum(others, o => o.paid));
    return { number: app.details.invoiceNumber, invoice, used, paidElsewhere, remaining: U.round2(invoice - used), others };
  },

  /* At allocation: the invoice must still have room for this application. */
  assertInvoiceRoom(app) {
    const u = this.invoiceUsage(app);
    if (!u || !u.invoice || !u.others.length) return;
    if (app.amount > u.remaining + 0.005) throw new WorkflowError(`Invoice ${u.number} only has ${app.currency} ${U.num(Math.max(0, u.remaining))} left (already ${app.currency} ${U.num(u.used)} on ${u.others.map(o => o.ref).join(', ')}). Return the application to reduce the amount, or reject it.`);
  },

  /* At payment: total paid on the invoice (all applications) can never exceed the invoice amount. */
  assertInvoicePayment(app, amount) {
    const u = this.invoiceUsage(app);
    if (!u || !u.invoice) return;
    const paidHere = Engine.totals(app).paid;
    if (u.paidElsewhere + paidHere + amount > u.invoice + 0.005) throw new WorkflowError(`This payment would take the total paid on invoice ${u.number} to ${app.currency} ${U.num(u.paidElsewhere + paidHere + amount)}, more than the invoice amount of ${app.currency} ${U.num(u.invoice)}. At most ${app.currency} ${U.num(Math.max(0, u.invoice - u.paidElsewhere - paidHere))} can still be paid.`);
  },

  /* The client's unreconciled advance payments (any branch, matched on account or ID number) and the ones that block
     a new application under the setting: ANY (default) – every unreconciled one; OVERDUE – only those past their due
     date; WARN – none (warning only). Cleared = reconciled by Exchange Control. */
  unreconciledBlock(app, todayKey = U.dayKey(Store.now())) {
    const mode = Store.state.settings.unreconciledBlock || 'ANY';
    const items = Engine.unreconciledFor(app);
    const blocking = mode === 'WARN' ? [] : mode === 'OVERDUE' ? items.filter(a => a.recon.dueDate < todayKey) : items;
    return { mode, items, blocking };
  },

  /* Returns { errors: [], warnings: [], docs: [] }. Errors block submission and authorisation. */
  validate(app, today = Store.now()) {
    const errors = [], warnings = [];
    const err = (field, msg) => errors.push({ field, msg });
    const warn = (field, msg) => warnings.push({ field, msg });
    const c = app.customer || {}, b = app.beneficiary || {}, d = app.details || {};
    const s = this.settings();
    const todayKey = U.dayKey(today);

    // Customer
    if (!c.name?.trim()) err('customer.name', 'Customer name is required');
    if (!c.account?.trim()) err('customer.account', 'Account number is required');
    else if (!/^\d{6,16}$/.test(c.account.trim())) warn('customer.account', 'Account number is usually 6–16 digits');
    if (!c.accountType) err('customer.accountType', 'Select the account type (local or foreign currency)');
    if (!c.idType) err('customer.idType', 'Select the customer ID type');
    if (!c.idNumber?.trim()) err('customer.idNumber', 'Customer ID number is required');
    else if (Engine.normId(c.idNumber).length < 4) err('customer.idNumber', 'ID number looks too short');
    // Outstanding advance payments for the same client (account OR ID number, any branch). Depending on the setting
    // (Admin → Rules & rates), they block submission and authorisation until reconciled; the inputter may reject at input.
    const ub = this.unreconciledBlock(app, todayKey);
    if (ub.items.length) {
      const list = ub.items.map(a => `${a.ref} (${UI.branchName(a.branchId)}, due ${U.fmtDate(a.recon.dueDate)}${a.recon.dueDate < todayKey ? ', overdue' : ''}; ${Engine.unreconciledMatch(app, a)})`).join('; ');
      if (ub.blocking.length) err('customer.account', `Client has ${ub.items.length} unreconciled advance payment(s): ${list}. The application cannot be submitted or authorised until ${ub.mode === 'OVERDUE' ? 'the overdue one(s) are' : 'they are'} reconciled – reject it at input or keep it as a draft.`);
      else warn('customer.account', `Client has ${ub.items.length} unreconciled advance payment(s), not yet overdue: ${list}`);
    }
    if (!c.address?.trim()) err('customer.address', 'Customer address is required');
    if (!c.phone?.trim()) err('customer.phone', 'Contact number is required');
    else if (!/^\+?[\d\s()-]{7,}$/.test(c.phone.trim())) err('customer.phone', 'Contact number looks invalid');
    if (c.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) err('customer.email', 'Email address looks invalid');
    if (!c.email?.trim()) warn('customer.email', 'No email – client notifications will be sent by SMS');
    // Additional phone numbers / emails (directors, signatories) – every one receives the client alerts.
    const seen = new Set([String(c.phone || '').replace(/\D/g, ''), String(c.email || '').trim().toLowerCase()]);
    (c.contacts || []).forEach((k, i) => {
      const v = String(k.value || '').trim(), f = `customer.contacts.${i}`;
      if (!v) err(f, `Additional ${k.kind === 'email' ? 'email address' : 'phone number'} ${i + 1} is empty – fill it in or remove it`);
      else if (k.kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) err(f, `Additional email address "${v}" looks invalid`);
      else if (k.kind === 'phone' && !/^\+?[\d\s()-]{7,}$/.test(v)) err(f, `Additional phone number "${v}" looks invalid`);
      const key = k.kind === 'email' ? v.toLowerCase() : v.replace(/\D/g, '');
      if (v && seen.has(key)) warn(f, `"${v}" is listed more than once – it will receive each alert only once`);
      seen.add(key);
    });
    // Core banking: the account should be confirmed from the CBS (name, type and balance).
    if (Engine.normAccount(c.account).length >= 6 && typeof CBS !== 'undefined' && !CBS.linked(app)) warn('customer.account', 'Account not confirmed from the core banking system (CBS) – name and balance were entered manually. Use "Fetch from CBS".');
    // The account's status in the CBS: a closed or blocked account cannot be used; a dormant one must be reactivated.
    const acctStatus = typeof CBS !== 'undefined' && CBS.linked(app) ? String(c.cbs.accountStatus || '').toUpperCase() : '';
    if (['CLOSED', 'BLOCKED', 'FROZEN'].includes(acctStatus)) err('customer.account', `The account is ${acctStatus.toLowerCase()} in the core banking system and cannot be used for this application.`);
    else if (acctStatus === 'DORMANT') warn('customer.account', 'The account is dormant in the core banking system. Have it reactivated before the client funds it or it is debited.');
    if (typeof CBS !== 'undefined' && CBS.linked(app) && CBS.amended(app).length) warn('customer.address', `Contact details amended from the CBS record (${CBS.amended(app).join(', ')}). The application uses the amended details; the CBS record itself is not changed.`);

    // Transaction
    if (!app.type) err('type', 'Select the transaction type');
    if (!(Number(app.amount) > 0)) err('amount', 'Amount applied must be greater than zero');
    if (!app.currency) err('currency', 'Select the currency applied for');
    if (app.balance === '' || app.balance == null || isNaN(app.balance)) err('balance', 'Account balance is required');
    if (!app.balanceCurrency) err('balanceCurrency', 'Select the account currency');
    if (c.accountType === 'LCY' && app.balanceCurrency && app.balanceCurrency !== 'MWK') warn('balanceCurrency', 'A local currency account is normally in MWK');
    if (c.accountType === 'FCY' && app.balanceCurrency === 'MWK') err('balanceCurrency', 'A foreign currency account cannot be in MWK');
    if (Number(app.amount) > 0 && app.currency && app.balanceCurrency && app.balance !== '') {
      const need = this.toMWK(app.amount, app.currency), have = this.toMWK(app.balance, app.balanceCurrency);
      if (have < need) warn('balance', `Balance (≈ MWK ${U.num(have, 0)}) is below the amount applied (≈ MWK ${U.num(need, 0)}). The client must fund the account if allocated.`);
    }

    // Beneficiary
    if (!b.name?.trim()) err('beneficiary.name', 'Beneficiary name is required');
    if (!b.address?.trim()) err('beneficiary.address', 'Beneficiary address is required');
    if (!b.country?.trim()) err('beneficiary.country', 'Country of remittance is required');
    if (!b.product?.trim()) err('beneficiary.product', 'Product / service applying for is required');
    if (app.type === 'GIFTS' && !b.relationship?.trim()) err('beneficiary.relationship', 'Relationship to the beneficiary is required for gifts');
    if (b.swift?.trim() && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(b.swift.trim().toUpperCase())) err('beneficiary.swift', 'SWIFT / BIC must be 8 or 11 letters and digits (e.g. SBZAZAJJ)');

    // Invoice date: required for imports (advance payment, freight, open account), optional for medical invoices.
    // Applications already submitted before this field existed only get a warning.
    const invoiceType = ['ADVANCE', 'FREIGHT', 'OPEN_ACCOUNT'].includes(app.type);
    if (invoiceType && !d.invoiceDate) {
      if (!app.status || ['DRAFT', 'RETURNED'].includes(app.status)) err('details.invoiceDate', 'Invoice date is required');
      else warn('details.invoiceDate', 'Invoice date not captured');
    }
    if (invoiceType) {
      const capture = !app.status || ['DRAFT', 'RETURNED'].includes(app.status);
      const inv = Number(d.invoiceAmount);
      if (!(inv > 0)) { if (capture) err('details.invoiceAmount', 'Invoice amount is required'); else warn('details.invoiceAmount', 'Invoice amount not captured'); }
      else if (Number(app.amount) > inv + 0.005) err('amount', `Amount applied cannot be more than the invoice amount (${app.currency} ${U.num(inv)})`);
      const u = inv > 0 ? this.invoiceUsage(app) : null;
      if (u && u.others.length) {
        const refs = u.others.map(o => `${o.ref} (${app.currency} ${U.num(o.used)})`).join(', ');
        if (u.remaining <= 0.005) err('details.invoiceNumber', `Invoice ${u.number} has already been applied for / paid in full on ${refs}. It cannot be paid again – reject this application.`);
        else if (Number(app.amount) > u.remaining + 0.005) err('amount', `Only ${app.currency} ${U.num(u.remaining)} of invoice ${u.number} is left (already on ${refs}). Reduce the amount applied or reject.`);
        else warn('details.invoiceNumber', `Invoice ${u.number} is also on ${refs}; ${app.currency} ${U.num(u.remaining)} of it remains.`);
      }
    }
    if ((invoiceType || app.type === 'MEDICAL') && d.invoiceDate) {
      if (d.invoiceDate > todayKey) err('details.invoiceDate', 'Invoice date cannot be in the future');
      else if (U.daysBetween(d.invoiceDate, today) > 180) warn('details.invoiceDate', `Invoice is ${U.daysBetween(d.invoiceDate, today)} days old – check it is still valid`);
    }

    // Student fees / maintenance
    if (this.isStudentCase(app)) {
      if (!d.studentName?.trim()) err('details.studentName', 'Student name is required');
      if (!d.visaExpiry) err('details.visaExpiry', 'Visa / permit expiry date is required');
      else if (d.visaExpiry < todayKey) err('details.visaExpiry', 'Visa / permit has expired');
      if (!d.studyStart) err('details.studyStart', 'Study start date is required');
      if (!d.studyEnd) err('details.studyEnd', 'Study finish date is required');
      if (d.studyStart && d.studyEnd && d.studyEnd <= d.studyStart) err('details.studyEnd', 'Study finish date must be after the start date');
      if (d.studyEnd && d.studyEnd < todayKey) err('details.studyEnd', 'Period of study has already ended');
      if (d.visaExpiry && d.studyEnd && d.visaExpiry < d.studyEnd) warn('details.visaExpiry', 'Visa / permit expires before the end of the study period');
    }

    // Travel: cash, cash passport, medical
    if (this.isTravel(app)) {
      if (!d.travellerName?.trim()) err('details.travellerName', 'Traveller name is required');
      if (!d.passportNumber?.trim()) err('details.passportNumber', 'Passport / travel document number is required');
      if (!d.travelDate) err('details.travelDate', 'Travel date is required');
      if (!d.returnDate) err('details.returnDate', 'Return date is required');
      if (d.travelDate && d.returnDate && d.returnDate < d.travelDate) err('details.returnDate', 'Return date must be on or after the travel date');
      if (d.travelDate && d.travelDate < todayKey && ['DRAFT', 'RETURNED', 'PENDING_AUTH'].includes(app.status)) err('details.travelDate', 'Travel date is in the past');
      const t = this.travel(app);
      if (t.days && Number(app.amount) > 0 && app.currency) {
        if (t.amountUSD > t.maxUSD + 0.01) {
          const msg = `Amount (≈ USD ${U.num(t.amountUSD)}) exceeds ${t.days} day(s) × USD ${s.perDiemUSD} = USD ${U.num(t.maxUSD)}`;
          if (TXN_TYPES[app.type].perDiem === 'strict') err('amount', msg);
          else warn('amount', msg + ' – confirm against the medical invoice');
        }
      }
    }

    // Documents
    const docs = this.requiredDocs(app);
    docs.filter(r => r.required && !r.present).forEach(r => err(`doc.${r.code}`, `${r.label} must be uploaded`));

    return { errors, warnings, docs };
  },
};
