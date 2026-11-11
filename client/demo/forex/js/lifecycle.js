'use strict';

/* Closing an application at the client's request, payment reversals and change of supplier.

   Close at the client's request – whenever the application is still open (pending authorisation, awaiting or partly
   allocated, allocated, funded, partly paid or reversed), as advised by the client:
     · allocations still awaiting funding are cancelled (back to Treasury);
     · funded money not yet paid out is released, to be refunded to the client's account;
     · nothing paid → "Closed – at client's request"; something paid → "Closed – paid" (closed short);
     · client, inputter and branch are told (and Treasury when allocations were cancelled or released).
   Reversal – Exchange Control marks a payment as reversed (e.g. returned by the correspondent or the supplier's bank)
   with a comment for the client, inputter, authoriser and branch. The record re-opens as "Payment reversed": the
   money is back on the allocation, so it can be paid again (to the same or a new supplier), or the application can
   be closed at the client's request and the money refunded. An advance payment's pending reconciliation is lifted
   until it is paid again; a reconciled one cannot be reversed.
   Change of supplier – after a reversal the inputter can propose a new beneficiary (and invoice); an authoriser of the
   branch (not the requester) approves or rejects it. The client is told when it is approved. */

Object.assign(STATUS, {
  REVERSED: { label: 'Payment reversed – action needed', tone: 'red' },
  CANCELLED: { label: "Closed – at client's request", tone: 'grey' },
});
ACTIVE_POST_AUTH.push('REVERSED');

ACCESS_FIXED.push(
  ['act.clientClose', 'Actions', "Close at client's request", 'Close or discard an open application as advised by the client, at any stage before full payment (own branch unless "all branches").', ['INPUTTER', 'AUTHORISER', 'EC']],
  ['act.reverse', 'Actions', 'Reverse payments', 'Mark a payment as reversed and re-open the record, with a comment to the client and staff.', ['EC']],
);

Object.assign(DEFAULT_TEMPLATES, {
  CLIENT_CLOSED_CLIENT: {
    name: "Closed at client's request", audience: 'Client', trigger: "An application is closed as advised by the client",
    subject: 'Application {{ref}} closed as requested',
    body: 'Dear {{customerName}},\n\nAs requested, your foreign currency application {{ref}} ({{type}}, {{currency}} {{amount}}) has been closed.\n\n{{comment}}\n\n{{refundText}}\n\nYours faithfully,\n{{bankName}}',
  },
  CLIENT_CLOSED_INTERNAL: {
    name: "Closed at client's request (staff)", audience: 'Staff', trigger: "An application is closed as advised by the client",
    subject: "[Forex] {{ref}} closed at the client's request",
    body: "Application {{ref}} ({{customerName}}, {{currency}} {{amount}}) was closed at the client's request by {{actor}}.\n\nReason: {{reason}}\n\n{{refundText}}\n\nForex Application System",
  },
  PAYMENT_REVERSED_CLIENT: {
    name: 'Payment reversed', audience: 'Client', trigger: 'Exchange Control reverses a payment',
    subject: 'Payment reversed – {{ref}}',
    body: 'Dear {{customerName}},\n\nThe payment of {{reversedAmount}} (reference {{reversedReference}}) on your application {{ref}} to {{beneficiaryName}} has been reversed.\n\n{{comment}}\n\nThe funds are held for this application. Please contact {{branchName}} to advise whether we should pay again (to the same or a different supplier) or close the application and refund your account.\n\nYours faithfully,\n{{bankName}}',
  },
  PAYMENT_REVERSED_INTERNAL: {
    name: 'Payment reversed (staff)', audience: 'Staff', trigger: 'Exchange Control reverses a payment (to the inputter, authoriser and branch)',
    subject: '[Forex] Payment on {{ref}} reversed',
    body: 'The payment of {{reversedAmount}} (reference {{reversedReference}}) on {{ref}} ({{customerName}}) was reversed by Exchange Control ({{actor}}).\n\n{{comment}}\n\nThe record is open again: obtain the client\'s instructions – pay again (same or new supplier, via "Change supplier") or close at the client\'s request and refund.\n\nForex Application System',
  },
  BENEFICIARY_CHANGE_INTERNAL: {
    name: 'Change of supplier – to approve', audience: 'Staff', trigger: 'Inputter requests a change of supplier after a reversal (to the branch authorisers)',
    subject: '[Forex] Change of supplier on {{ref}} to approve',
    body: '{{actor}} asks to change the supplier on {{ref}} ({{customerName}}) from {{oldBeneficiary}} to {{newBeneficiary}}.\n\nReason: {{reason}}\n\nPlease approve or reject it on the application.\n\nForex Application System',
  },
  BENEFICIARY_CHANGED_CLIENT: {
    name: 'Change of supplier – confirmed', audience: 'Client', trigger: 'Authoriser approves a change of supplier',
    subject: 'Change of supplier confirmed – {{ref}}',
    body: 'Dear {{customerName}},\n\nAs you instructed, the payment on application {{ref}} ({{currency}} {{amount}}) will now be made to {{newBeneficiary}} instead of {{oldBeneficiary}}. We will advise you once it has been processed.\n\nYours faithfully,\n{{bankName}}',
  },
  BENEFICIARY_CHANGED_INTERNAL: {
    name: 'Change of supplier – approved / rejected (staff)', audience: 'Staff', trigger: 'Authoriser decides on a change of supplier',
    subject: '[Forex] Change of supplier on {{ref}} {{decision}}',
    body: 'The change of supplier on {{ref}} ({{customerName}}) from {{oldBeneficiary}} to {{newBeneficiary}} was {{decision}} by {{actor}}.\n\n{{comment}}\n\nForex Application System',
  },
});

const CLOSABLE = ['PENDING_AUTH', 'RETURNED', 'AWAITING_ALLOCATION', 'ALLOCATED', 'FUNDED', 'PARTLY_PAID', 'REVERSED'];

const Lifecycle = {
  can(action, app, user = Store.user()) {
    // Only this module's actions are answered here; anything else (create, view, …) goes to the engine (null).
    if (!['clientClose', 'reverse', 'requestBenChange', 'approveBenChange', 'rejectBenChange'].includes(action)) return null;
    if (!user || !app) return false;
    const has = k => Access.has(user, k), st = app.status;
    const ownBranch = Engine.inBranch(user, app.branchId);
    switch (action) {
      case 'clientClose':
        return has('act.clientClose') && (CLOSABLE.includes(st) || (st === 'DRAFT' && !!app.submittedAt)) && (ownBranch || has('view.allBranches'));
      case 'reverse':
        return has('act.reverse') && (app.payments || []).some(p => !p.reversed) && app.recon?.status !== 'RECONCILED';
      case 'requestBenChange':
        return st === 'REVERSED' && app.benChange?.status !== 'PENDING' && ((has('act.capture') && ownBranch) || has('act.reverse'));
      case 'approveBenChange':
      case 'rejectBenChange':
        return app.benChange?.status === 'PENDING' && has('act.authorise') && ownBranch && app.benChange.by !== user.id;
      default: return null;
    }
  },
  need(action, app, msg) { if (!this.can(action, app)) throw new WorkflowError(msg); },
  actor() { const u = Store.user(); return `${u.name} (${ROLES[u.role]})`; },

  /* ---------- close at the client's request ---------- */
  clientClose(app, { reason, clientMessage }) {
    this.need('clientClose', app, 'This application cannot be closed in its current status.');
    if (!reason?.trim()) throw new WorkflowError("Give the client's instruction / reason for closing.");
    const now = Engine.nowISO(), prev = app.status;
    let cancelled = 0, refund = 0, refundMWK = 0;
    (app.allocations || []).forEach(a => {
      if (a.status === 'AWAITING_FUNDING') { a.status = 'CANCELLED'; a.cancelledAt = now; cancelled = U.round2(cancelled + a.amount); }
      else if (a.status === 'FUNDED' && a.amount - a.paid > 0.005) {
        const r = U.round2(a.amount - a.paid);
        refund = U.round2(refund + r); refundMWK = U.round2(refundMWK + r * a.rate);
        a.released = U.round2((a.released || 0) + r); a.amount = a.paid;
      }
    });
    const paid = Engine.totals(app).paid;
    app.closedAt = now;
    app.closedShort = paid > 0;
    app.status = paid > 0 ? 'CLOSED' : 'CANCELLED';
    if (app.type === 'ADVANCE' && paid > 0 && !app.recon) app.recon = { status: 'PENDING', dueDate: U.dayKey(U.addDays(Engine.now(), Store.state.settings.reconDays)) };
    app.cancellation = { at: now, by: Store.user().id, reason: reason.trim(), clientMessage: clientMessage || '', previousStatus: prev, cancelledAllocation: cancelled, refund, refundMWK };
    Engine.touch(app);
    Engine.addComment(app, "Closed at client's request", reason);
    const refundText = refund > 0 ? `${app.currency} ${U.num(refund)} (≈ MWK ${U.num(refundMWK)}) funded but not paid out will be refunded to account ${app.customer.account}.` : '';
    Store.audit('CLIENT_CLOSED', app, `Closed at the client's request from "${STATUS[prev]?.label || prev}"${paid > 0 ? ` – ${app.currency} ${U.num(paid)} already paid, balance cancelled` : ''}${cancelled ? `; allocation of ${app.currency} ${U.num(cancelled)} cancelled` : ''}${refund ? `; ${app.currency} ${U.num(refund)} to refund` : ''}: ${reason}`);
    const vars = { comment: clientMessage || '', reason, refundText, actor: this.actor() };
    Engine.notify('CLIENT_CLOSED_CLIENT', app, ['client'], vars);
    Engine.notify('CLIENT_CLOSED_INTERNAL', app, ['inputter', 'branch', ...(cancelled || refund ? [{ role: 'TREASURY' }] : [])], vars);
    Store.save();
  },

  /* ---------- reversal ---------- */
  reverse(app, paymentId, { reason, clientMessage }) {
    this.need('reverse', app, 'Only Exchange Control can reverse a payment, and not once the advance payment has been reconciled.');
    if (!reason?.trim()) throw new WorkflowError('Give the reason for the reversal.');
    if (!clientMessage?.trim()) throw new WorkflowError('Write the comment to be sent to the client.');
    const p = app.payments.find(x => x.id === paymentId && !x.reversed);
    if (!p) throw new WorkflowError('Choose a payment that has not been reversed.');
    const now = Engine.nowISO();
    // Put the money back on the allocation(s) it was paid from.
    const parts = p.parts || (p.allocationId ? [{ allocationId: p.allocationId, equiv: p.amount, inAlloc: p.payAmount ?? p.amount }] : null);
    if (parts) parts.forEach(pt => { const a = app.allocations.find(x => x.id === pt.allocationId); if (a) this.unpay(a, pt.equiv, pt.inAlloc); });
    else {
      let left = p.amount;
      [...app.allocations].reverse().filter(a => a.status === 'FUNDED' && a.paid > 0).forEach(a => { const take = Math.min(left, a.paid); if (take > 0) { this.unpay(a, take, null); left = U.round2(left - take); } });
    }
    p.reversed = { at: now, by: Store.user().id, reason: reason.trim(), clientMessage: clientMessage.trim() };
    app.closedAt = null;
    app.closedShort = false;
    if (app.recon) { app.reconBeforeReversal = app.recon; delete app.recon; }   // reconciliation waits for the new payment
    app.status = 'REVERSED';
    app.reversals = [...(app.reversals || []), { paymentId: p.id, amount: p.amount, reference: p.reference, at: now, by: Store.user().id, reason: reason.trim(), clientMessage: clientMessage.trim() }];
    Engine.touch(app);
    Engine.addComment(app, 'Payment reversed', `${reason}\n\nTo client: ${clientMessage}`);
    const amt = `${p.payCurrency || app.currency} ${U.num(p.payAmount ?? p.amount)}`;
    Store.audit('PAYMENT_REVERSED', app, `Payment ${p.reference} (${amt}) reversed: ${reason}`);
    const vars = { comment: clientMessage, reason, reversedAmount: amt, reversedReference: p.reference, actor: this.actor() };
    Engine.notify('PAYMENT_REVERSED_CLIENT', app, ['client'], vars);
    const staff = ['inputter', 'branch'];
    if (app.authorisedBy) staff.push({ userId: app.authorisedBy });
    if (app.assignment?.kind === 'BRANCH' && app.assignment.branchId !== app.branchId) staff.push({ branchId: app.assignment.branchId });
    if (app.assignment?.kind === 'USER' && app.assignment.userId) staff.push({ userId: app.assignment.userId });
    Engine.notify('PAYMENT_REVERSED_INTERNAL', app, staff, Object.assign({}, vars, { comment: `Reason: ${reason}\nMessage to client: ${clientMessage}` }));
    Store.save();
  },
  unpay(a, equiv, inAlloc) {
    a.status = 'FUNDED';
    a.paid = U.round2(Math.max(0, (a.paid || 0) - equiv));
    if (a.paidAlloc != null) a.paidAlloc = U.round2(Math.max(0, a.paidAlloc - (inAlloc ?? equiv * (a.crossRate || 1))));
  },

  /* ---------- change of supplier (maker-checker) ---------- */
  requestBenChange(app, { beneficiary, details, reason, documents }) {
    this.need('requestBenChange', app, 'The supplier can be changed only after a payment has been reversed.');
    if (!reason?.trim()) throw new WorkflowError("Give the client's instruction / reason for the change.");
    ['name', 'country', 'address'].forEach(k => { if (!String(beneficiary[k] || '').trim()) throw new WorkflowError(`Enter the new beneficiary ${k}.`); });
    if (beneficiary.swift && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(beneficiary.swift.toUpperCase())) throw new WorkflowError('The SWIFT / BIC code looks invalid (8 or 11 characters).');
    const u = Store.user();
    app.benChange = { status: 'PENDING', by: u.id, at: Engine.nowISO(), reason: reason.trim(), previous: U.clone(app.beneficiary), previousDetails: U.clone(app.details || {}),
      proposed: Object.assign(U.clone(app.beneficiary), beneficiary, { swift: (beneficiary.swift || '').toUpperCase() }), details: details || {}, documents: documents || [] };
    Engine.touch(app);
    Store.audit('BENEFICIARY_CHANGE_REQUESTED', app, `Change of supplier requested: ${app.beneficiary.name} → ${beneficiary.name} (${reason})`);
    Engine.notify('BENEFICIARY_CHANGE_INTERNAL', app, [{ role: 'AUTHORISER', branchId: app.branchId }], { actor: this.actor(), reason, oldBeneficiary: app.beneficiary.name, newBeneficiary: beneficiary.name });
    Store.save();
  },

  approveBenChange(app, comment) {
    this.need('approveBenChange', app, 'Only an authoriser of the branch, other than the requester, can approve the change.');
    const bc = app.benChange, before = U.clone(app);
    const trial = U.clone(app);
    trial.beneficiary = U.clone(bc.proposed);
    Object.assign(trial.details, bc.details);
    Rules.assertInvoiceRoom(trial);                       // the new invoice must not be over-used elsewhere
    app.beneficiary = trial.beneficiary;
    app.details = trial.details;
    (bc.documents || []).forEach(d => app.documents.push(d));
    Object.assign(bc, { status: 'APPROVED', decidedBy: Store.user().id, decidedAt: Engine.nowISO(), comment: comment || '' });
    app.benChanges = [...(app.benChanges || []), U.clone(bc)];
    Engine.touch(app);
    Engine.addComment(app, 'Change of supplier approved', comment || bc.reason);
    Store.audit('BENEFICIARY_CHANGED', app, `Supplier changed: ${bc.previous.name} → ${bc.proposed.name}`, Engine.diff(before, app));
    const vars = { actor: this.actor(), comment: comment || '', decision: 'approved', oldBeneficiary: bc.previous.name, newBeneficiary: bc.proposed.name };
    Engine.notify('BENEFICIARY_CHANGED_CLIENT', app, ['client'], vars);
    const staff = [{ userId: bc.by }, 'inputter', { role: 'EC' }];
    if (app.assignment?.kind === 'USER' && app.assignment.userId) staff.push({ userId: app.assignment.userId });
    Engine.notify('BENEFICIARY_CHANGED_INTERNAL', app, staff, vars);
    Store.save();
  },

  rejectBenChange(app, comment) {
    this.need('rejectBenChange', app, 'Only an authoriser of the branch, other than the requester, can reject the change.');
    if (!comment?.trim()) throw new WorkflowError('A comment is required when rejecting.');
    const bc = app.benChange;
    Object.assign(bc, { status: 'REJECTED', decidedBy: Store.user().id, decidedAt: Engine.nowISO(), comment });
    app.benChanges = [...(app.benChanges || []), U.clone(bc)];
    Engine.touch(app);
    Store.audit('BENEFICIARY_CHANGE_REJECTED', app, `Change of supplier to ${bc.proposed.name} rejected: ${comment}`);
    Engine.notify('BENEFICIARY_CHANGED_INTERNAL', app, [{ userId: bc.by }], { actor: this.actor(), comment, decision: 'rejected', oldBeneficiary: bc.previous.name, newBeneficiary: bc.proposed.name });
    Store.save();
  },

  /* ---------- page parts ---------- */
  banner(app) {
    const e = U.esc, out = [];
    if (app.status === 'REVERSED') {
      const r = (app.reversals || []).slice(-1)[0];
      out.push(`<div class="alert error"><div><b>Payment reversed</b>${r ? ` ${U.fmtDateTime(r.at)} by ${e(UI.userName(r.by))}: ${e(r.reason)}` : ''}<br><small>Next: get the client's instructions – <b>pay again</b> (same supplier, or a new one through <b>Change supplier</b>, approved by an authoriser), or <b>close at the client's request</b> and refund.</small></div></div>`);
    }
    if (app.benChange?.status === 'PENDING') {
      const bc = app.benChange;
      out.push(`<div class="alert warn"><div><b>Change of supplier waiting for approval</b> (${e(UI.userName(bc.by))}, ${U.fmtDateTime(bc.at)})<br>${e(bc.previous.name)} → <b>${e(bc.proposed.name)}</b>, ${e(bc.proposed.country || '')}${bc.proposed.bankName ? ` · ${e(bc.proposed.bankName)}` : ''}${bc.proposed.swift ? ` · ${e(bc.proposed.swift)}` : ''}${bc.proposed.accountNumber ? ` · ${e(bc.proposed.accountNumber)}` : ''}<br><small>${e(bc.reason)}</small></div></div>`);
    }
    if (app.cancellation) {
      const c = app.cancellation;
      out.push(`<div class="alert info"><div><b>Closed at the client's request</b> ${U.fmtDateTime(c.at)} by ${e(UI.userName(c.by))}: ${e(c.reason)}${c.refund ? `<br>${U.money(c.refund, app.currency)} (≈ MWK ${U.num(c.refundMWK)}) to refund to the client's account.` : ''}${c.cancelledAllocation ? `<br>Allocation of ${U.money(c.cancelledAllocation, app.currency)} cancelled.` : ''}</div></div>`);
    }
    return out.join('');
  },
};

/* ---------- action dialogs ---------- */
Object.assign(Actions, {
  clientClose(app) {
    const t = Engine.totals(app);
    const effects = [
      t.awaitingFunding > 0 ? `the allocation awaiting funding (${U.money(t.awaitingFunding, app.currency)}) is cancelled` : '',
      t.fundedUnpaid > 0 ? `${U.money(t.fundedUnpaid, app.currency)} funded but not paid out is released for refund to the client's account` : '',
      t.paid > 0 ? `${U.money(t.paid, app.currency)} already paid stays paid; the balance of ${U.money(t.balance, app.currency)} is cancelled` : 'nothing has been paid, so the application is closed without payment',
    ].filter(Boolean);
    UI.modal({
      title: `Close ${app.ref} at the client's request`,
      body: `<div class="alert warn"><div>Closing cannot be undone. ${U.esc(effects.join('; '))}.</div></div>
        <label class="f" style="margin-top:10px"><span>Client's instruction / reason (internal) <b class="req">*</b></span><textarea name="reason" rows="2" placeholder="e.g. Client advised by letter dated … that the order was cancelled"></textarea></label>
        <label class="f" style="margin-top:10px"><span>Message to the client</span><textarea name="clientMessage" rows="3">We have closed the application as you instructed.</textarea><div class="hint">Sent to every email address and phone number on the application. The inputter and branch are told${t.awaitingFunding > 0 || t.fundedUnpaid > 0 ? ', and Treasury' : ''}.</div></label>`,
      actions: [{ label: 'Close application', cls: 'btn-danger', onClick: el => { Lifecycle.clientClose(app, UI.formData(el)); Actions.done("Closed at the client's request. The client and staff have been notified."); } }],
    });
  },

  reverse(app) {
    const pays = app.payments.filter(p => !p.reversed);
    UI.modal({
      title: `Reverse a payment – ${app.ref}`,
      body: `<label class="f"><span>Payment <b class="req">*</b></span><select name="paymentId">${pays.map(p => `<option value="${p.id}">${U.fmtDate(p.valueDate)} · ${U.money(p.payAmount ?? p.amount, p.payCurrency || app.currency)} · ${U.esc(p.reference)}</option>`).join('')}</select></label>
        <label class="f" style="margin-top:10px"><span>Reason (internal) <b class="req">*</b></span><textarea name="reason" rows="2" placeholder="e.g. Returned by the beneficiary bank – account closed"></textarea></label>
        <label class="f" style="margin-top:10px"><span>Comment to the client <b class="req">*</b></span><textarea name="clientMessage" rows="4" placeholder="e.g. The beneficiary bank returned the payment because the account is closed."></textarea><div class="hint">Sent to the client; the inputter, authoriser and branch receive it with the reason.</div></label>
        <div class="alert info" style="margin-top:10px"><div>The record re-opens as <b>Payment reversed</b>. The money goes back on the allocation so it can be paid again, to the same or a new supplier, or the application can be closed at the client's request and refunded.${app.recon ? ' The pending reconciliation is lifted until it is paid again.' : ''}</div></div>`,
      actions: [{ label: 'Reverse payment', cls: 'btn-danger', onClick: el => { const d = UI.formData(el); Lifecycle.reverse(app, d.paymentId, d); Actions.done('Payment reversed. The client, inputter, authoriser and branch have been notified.'); } }],
    });
  },

  requestBenChange(app) {
    const b = app.beneficiary || {}, d = app.details || {}, e = U.esc, imp = ['ADVANCE', 'FREIGHT', 'OPEN_ACCOUNT'].includes(app.type);
    const f = (name, label, v = '', req = false, attrs = '') => `<label class="f"><span>${label}${req ? ' <b class="req">*</b>' : ''}</span><input name="${name}" value="${e(v)}" ${attrs}></label>`;
    UI.modal({
      title: `Change supplier – ${app.ref}`, wide: true,
      body: `<div class="alert info" style="margin-bottom:10px"><div>Current: <b>${e(b.name)}</b>, ${e(b.country)}. An authoriser of ${e(UI.branchName(app.branchId))} must approve the change before the payment is made again.</div></div>
        <div class="grid g2">${f('name', 'New beneficiary name', '', true)}${f('country', 'Country', b.country, true, 'list="countries"')}
        <label class="f span-all"><span>Beneficiary address <b class="req">*</b></span><textarea name="address" rows="2"></textarea></label>
        ${f('bankName', 'Beneficiary bank')}${f('swift', 'SWIFT / BIC', '', false, 'maxlength="11" style="text-transform:uppercase"')}${f('accountNumber', 'Account number / IBAN')}${f('product', 'Product / service', b.product)}
        ${imp ? `${f('invoiceNumber', 'New invoice number', d.invoiceNumber)}${f('invoiceDate', 'Invoice date', d.invoiceDate, false, `type="date" max="${U.dayKey(Store.now())}"`)}${f('invoiceAmount', `Invoice total (${app.currency})`, d.invoiceAmount, false, 'type="number" step="0.01" min="0"')}` : ''}
        <label class="f span-all"><span>New invoice / supporting documents</span><input type="file" name="files" multiple accept=".pdf,image/*,.doc,.docx"></label>
        <label class="f span-all"><span>Client's instruction / reason <b class="req">*</b></span><textarea name="reason" rows="2"></textarea></label></div>
        <datalist id="countries">${COUNTRIES.map(c => `<option value="${e(c)}">`).join('')}</datalist>`,
      actions: [{ label: 'Send for approval', onClick: async el => {
        const v = UI.formData(el), docs = [];
        for (const file of el.querySelector('[name=files]').files) docs.push(await Form.storeFile(file, imp ? 'INVOICE' : 'OTHER'));
        const details = imp ? { invoiceNumber: v.invoiceNumber, invoiceDate: v.invoiceDate, invoiceAmount: v.invoiceAmount === '' ? '' : Number(v.invoiceAmount) } : {};
        Lifecycle.requestBenChange(app, { beneficiary: { name: v.name, country: v.country, address: v.address, bankName: v.bankName, swift: v.swift, accountNumber: v.accountNumber, product: v.product }, details, reason: v.reason, documents: docs });
        Actions.done('Change of supplier sent to the authorisers for approval.');
      } }],
    });
  },

  approveBenChange(app) {
    const bc = app.benChange;
    UI.modal({
      title: `Approve change of supplier – ${app.ref}`,
      body: `<p>${U.esc(bc.previous.name)} → <b>${U.esc(bc.proposed.name)}</b> (${U.esc(bc.proposed.country)})${bc.details?.invoiceNumber ? `, invoice ${U.esc(bc.details.invoiceNumber)}` : ''}.</p><p class="muted">${U.esc(bc.reason)}</p>
        <label class="f"><span>Comment (optional)</span><textarea name="comment"></textarea></label><div class="hint">The client is told the payment will go to the new supplier; Exchange Control is told it can be paid.</div>`,
      actions: [{ label: 'Approve change', cls: 'btn-success', onClick: el => { Lifecycle.approveBenChange(app, UI.formData(el).comment); Actions.done('Change of supplier approved. The client and Exchange Control have been notified.'); } }],
    });
  },

  rejectBenChange(app) {
    UI.modal({
      title: `Reject change of supplier – ${app.ref}`,
      body: '<label class="f"><span>Reason <b class="req">*</b></span><textarea name="comment"></textarea></label>',
      actions: [{ label: 'Reject change', cls: 'btn-danger', onClick: el => { Lifecycle.rejectBenChange(app, UI.formData(el).comment); Actions.done('Change of supplier rejected. The requester has been told.'); } }],
    });
  },
});

/* ---------- hooks ---------- */
(() => {
  const baseCan = Engine.can.bind(Engine);
  Engine.can = function (action, app, user) {
    const r = Lifecycle.can(action, app, user || Store.user());
    if (r === null) return baseCan(action, app, user);
    return r && !(typeof Periods !== 'undefined' && Periods.blocked());
  };

  const baseButtons = Views.actionButtons.bind(Views);
  Views.actionButtons = function (app) {
    const html = baseButtons(app), can = a => Engine.can(a, app);
    const btn = (action, label, cls = '') => `<button class="${cls}" data-action="${action}" style="width:100%;justify-content:center">${label}</button>`;
    const top = [Lifecycle.banner(app),
      can('approveBenChange') ? btn('approveBenChange', '✓ Approve change of supplier', 'btn-success') + btn('rejectBenChange', '✕ Reject change of supplier', 'btn-danger') : '',
      can('requestBenChange') ? btn('requestBenChange', '⇄ Change supplier (client instruction)') : ''].join('');
    const bottom = [can('reverse') ? btn('reverse', '↶ Reverse a payment…', 'btn-danger') : '',
      can('clientClose') ? btn('clientClose', "✕ Close at client's request…", 'btn-danger') : ''].join('');
    const open = '<div style="display:flex;flex-direction:column;gap:8px">';
    const i = html.indexOf(open), j = html.lastIndexOf('</div>');
    if (i < 0 || j < 0) return html + top + bottom;
    return html.slice(0, i + open.length) + top + html.slice(i + open.length, j) + bottom + html.slice(j);
  };

  const baseLabel = Views.actionLabel.bind(Views);
  Views.actionLabel = x => ({ CLIENT_CLOSED: "Closed at client's request", PAYMENT_REVERSED: 'Payment reversed', BENEFICIARY_CHANGE_REQUESTED: 'Change of supplier requested', BENEFICIARY_CHANGED: 'Supplier changed', BENEFICIARY_CHANGE_REJECTED: 'Change of supplier rejected' })[x] || baseLabel(x);

  // Processed transactions: closed at the client's request is its own outcome.
  Reports.OUTCOMES.CANCELLED = { label: "Closed – at client's request", tone: 'grey' };
  const baseOutcome = Reports.outcomeOf.bind(Reports);
  Reports.outcomeOf = a => (a.status === 'CANCELLED' ? 'CANCELLED' : baseOutcome(a));
  const baseBy = Reports.finishedBy.bind(Reports);
  Reports.finishedBy = a => (a.cancellation ? UI.userName(a.cancellation.by) : baseBy(a));

  // Work queue: reversed payments waiting for the client's instructions / a new payment.
  Queues.defs.reversed = { label: 'Payment reversed', roles: ['INPUTTER', 'AUTHORISER', 'EC'], filter: a => a.status === 'REVERSED' || a.benChange?.status === 'PENDING', alert: true };
})();
