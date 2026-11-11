'use strict';

/* Workflow engine: permissions, state transitions, notifications and the time-based scheduler.
   Every action: check permission → mutate → audit → notify → save. */

class WorkflowError extends Error {}

const FIELD_LABELS = {
  'customer.name': 'Customer name', 'customer.account': 'Account number', 'customer.accountType': 'Account type',
  'customer.address': 'Customer address', 'customer.email': 'Customer email', 'customer.phone': 'Contact number',
  'customer.idType': 'ID type', 'customer.idNumber': 'ID number',
  type: 'Transaction type', balance: 'Account balance', balanceCurrency: 'Account currency',
  amount: 'Amount applied', currency: 'Currency applied',
  'beneficiary.name': 'Beneficiary name', 'beneficiary.address': 'Beneficiary address',
  'beneficiary.country': 'Country of remittance', 'beneficiary.product': 'Product / service',
  'beneficiary.relationship': 'Relationship to beneficiary', 'beneficiary.bankName': 'Beneficiary bank',
  'beneficiary.accountNumber': 'Beneficiary account / IBAN', 'beneficiary.swift': 'Beneficiary SWIFT / BIC', 'details.invoiceDate': 'Invoice date', 'details.invoiceAmount': 'Invoice amount',
  'details.maintenanceFor': 'Maintenance for', 'details.studentName': 'Student name',
  'details.visaExpiry': 'Visa / permit expiry', 'details.studyStart': 'Study start', 'details.studyEnd': 'Study finish',
  'details.travellerName': 'Traveller name', 'details.passportNumber': 'Passport number',
  'details.travelDate': 'Travel date', 'details.returnDate': 'Return date', 'details.invoiceNumber': 'Invoice number',
};
const EDITABLE_FIELDS = ['customer', 'type', 'balance', 'balanceCurrency', 'amount', 'currency', 'beneficiary', 'details', 'documents', 'cbm'];   // cbm: central bank list check (js/cbmlist.js)

const Engine = {
  S() { return Store.state; },
  now() { return Store.now(); },
  nowISO() { return Store.now().toISOString(); },

  /* ---------- amounts & status ---------- */
  totals(app) {
    // Forfeited and cancelled allocations no longer count; reversed payments are no longer paid (js/lifecycle.js).
    const live = (app.allocations || []).filter(a => !['FORFEITED', 'CANCELLED'].includes(a.status));
    const allocated = U.sum(live, a => a.amount);
    const paid = U.sum((app.payments || []).filter(p => !p.reversed), p => p.amount);
    const fundedUnpaid = U.sum(live.filter(a => a.status === 'FUNDED'), a => a.amount - (a.paid || 0));
    const awaitingFunding = U.sum(live.filter(a => a.status === 'AWAITING_FUNDING'), a => a.amount);
    return {
      allocated: U.round2(allocated), paid: U.round2(paid),
      fundedUnpaid: U.round2(fundedUnpaid), awaitingFunding: U.round2(awaitingFunding),
      unallocated: U.round2(Math.max(0, app.amount - allocated)),
      balance: U.round2(Math.max(0, app.amount - paid)),
    };
  },

  deriveStatus(app) {
    const t = this.totals(app);
    if (app.closedAt || t.paid >= app.amount - 0.005) return 'CLOSED';
    if (t.awaitingFunding > 0) return 'ALLOCATED';
    if (t.fundedUnpaid > 0) return 'FUNDED';
    if (t.paid > 0) return 'PARTLY_PAID';
    return 'AWAITING_ALLOCATION';
  },

  /* ---------- permissions ---------- */
  /* Who may do what comes from access rights (js/access.js: role defaults, changed in Administration → Access rights);
     the status, own-branch and maker-checker conditions below always apply on top. */
  can(action, app, user = Store.user()) {
    if (!user) return false;
    const has = k => Access.has(user, k);
    const st = app?.status;
    const t = app ? this.totals(app) : null;
    const postAuth = app && ACTIVE_POST_AUTH.includes(st);
    const ownBranch = app && this.inBranch(user, app.branchId);
    const travel = app && Rules.isTravel(app);
    switch (action) {
      case 'create': return has('act.capture');
      case 'view':
        // Without "all branches", users see their own branch plus anything assigned to them.
        if (!has('view.allBranches')) return ownBranch || this.isAssignedTo(app, user);
        return true;
      case 'edit':
        return ownBranch && ((has('act.capture') && ['DRAFT', 'RETURNED'].includes(st)) || (has('act.authorise') && st === 'PENDING_AUTH' && app.createdBy !== user.id));
      case 'submit': return has('act.capture') && ownBranch && ['DRAFT', 'RETURNED'].includes(st);
      // Once submitted, an application is part of the client's permanent history and cannot be discarded.
      case 'discard': return has('act.capture') && app.createdBy === user.id && st === 'DRAFT' && !app.submittedAt;
      case 'reopen': return has('act.capture') && ownBranch && ['PENDING_AUTH', 'REJECTED'].includes(st);
      case 'inputReject': return has('act.capture') && ownBranch && ['DRAFT', 'RETURNED'].includes(st) && this.unreconciledFor(app).length > 0;
      case 'authorise':
      case 'reject': return has('act.authorise') && ownBranch && st === 'PENDING_AUTH' && app.createdBy !== user.id;
      case 'allocate': return (has('act.allocate') || has('act.allocateForTreasury')) && postAuth && t.unallocated > 0 && t.awaitingFunding === 0;
      case 'confirmFunding':
        if (!(t.awaitingFunding > 0)) return false;
        // Travel: handled by the originating branch only.
        if (travel) return has('act.branchFunding') && ownBranch;
        // Other types: "any time" holders always; branch staff once EC has recommended it.
        return has('act.fundAny') || (has('act.branchFunding') && this.can('view', app, user) && this.ecRecommended(app));
      case 'forfeit': return has('act.allocate') && t.awaitingFunding > 0;
      case 'editAllocation': return (has('act.allocate') || has('act.allocateForTreasury')) && t.awaitingFunding > 0;
      case 'recommend': return has('act.recommend') && postAuth;
      case 'assign': return has('act.assign') && postAuth && !travel;
      case 'pay':
        if (!(t.fundedUnpaid > 0)) return false;
        if (travel) return has('act.travelPayout') && ownBranch;
        return has('act.pay') || this.isAssignedTo(app, user);
      case 'reconcile': return has('act.reconcile') && app.type === 'ADVANCE' && app.recon?.status === 'REVIEW';
      case 'comment': return has('act.comment');
      default: return false;
    }
  },

  ecRecommended(app) {
    return !!app.ec && app.ec.recommendation !== 'Not recommended';
  },

  /* Why the current user cannot confirm funding / pay out (null when they can or nothing is pending). */
  fundingBlockReason(app, user = Store.user()) {
    const t = this.totals(app);
    if (!(t.awaitingFunding > 0) || this.can('confirmFunding', app, user)) return null;
    if (Rules.isTravel(app)) return `Travel transactions are funded and paid out by the originating branch (${UI.branchName(app.branchId)}) only.`;
    if (Access.has(user, 'act.fundAny') || user.role === 'ADMIN') return null;
    if (app.ec?.recommendation === 'Not recommended') return 'Exchange Control has not recommended this transaction, so only Treasury or Exchange Control can mark it as funded.';
    return 'Branch staff can mark this as funded once Exchange Control has reviewed and recommended it.';
  },

  travelPayoutNote(app, user = Store.user()) {
    if (!Rules.isTravel(app) || !(this.totals(app).fundedUnpaid > 0) || this.can('pay', app, user)) return null;
    return `Travel transactions are paid out by the originating branch (${UI.branchName(app.branchId)}) only.`;
  },

  /* The branches a user works for: their branch plus any further branches the administrator assigned
     (Administration → Users; inputters and authorisers). "Own branch" rules accept any of them. */
  /* A user assigned to several branches works in one branch at a time: the home branch (user.branchId) after signing
     in, or another assigned branch chosen with "Switch branch" in the top bar. Queues, new applications, references and
     reports follow the working branch. Kept for this browser tab until sign-out. */
  WB_KEY: 'fx-working-branch',
  assignedBranches(user) { return user ? [...new Set([user.branchId, ...(user.extraBranchIds || [])].filter(Boolean))] : []; },
  workingBranch(user) {
    if (!user) return null;
    const all = this.assignedBranches(user);
    if (all.length < 2 || user.id !== Store.user()?.id) return user.branchId;
    let id = null;
    try { const r = JSON.parse(sessionStorage.getItem(this.WB_KEY) || 'null'); if (r && r.u === user.id) id = r.b; } catch (e) { /* no storage */ }
    return all.includes(id) ? id : user.branchId;
  },
  setWorkingBranch(id) {
    const u = Store.user();
    if (!u || !this.assignedBranches(u).includes(id) || id === this.workingBranch(u)) return;
    const from = this.workingBranch(u);
    try { sessionStorage.setItem(this.WB_KEY, JSON.stringify({ u: u.id, b: id })); } catch (e) { /* no storage */ }
    Store.audit('BRANCH_SWITCHED', null, `${u.name} switched from ${UI.branchName(from)} to ${UI.branchName(id)}${id === u.branchId ? ' (home branch)' : ''}`);
    Store.save();
  },
  // The signed-in user's branch is the working branch; other users show all the branches they are assigned to.
  branchesOf(user) { return user && user.id === Store.user()?.id ? [this.workingBranch(user)].filter(Boolean) : this.assignedBranches(user); },
  branchesLabel(user) { const b = this.branchesOf(user); return b.length > 1 ? `My branches – ${b.map(x => UI.branchName(x)).join(', ')}` : `My branch – ${UI.branchName(user?.branchId)}`; },
  inBranch(user, branchId) { return !!branchId && this.branchesOf(user).includes(branchId); },

  /* An application joins the client's permanent history once submitted (or rejected at input). */
  inHistory(app) { return !!(app.submittedAt || app.rejectedAt); },

  normAccount(v) { return String(v || '').replace(/\s+/g, ''); },
  normId(v) { return String(v || '').replace(/[\s\-/]+/g, '').toUpperCase(); },

  /* Every application ever made for this account number, across all branches (newest first). */
  clientHistory(account, excludeId = null) {
    const key = this.normAccount(account);
    if (!key) return [];
    return this.S().apps
      .filter(a => this.inHistory(a) && a.id !== excludeId && this.normAccount(a.customer?.account) === key)
      .sort((a, b) => this.appliedAt(b).localeCompare(this.appliedAt(a)));
  },

  /* All advance payments awaiting reconciliation, across all branches (soonest due first). */
  unreconciled() {
    return this.S().apps.filter(a => a.type === 'ADVANCE' && a.recon && a.recon.status !== 'RECONCILED')
      .sort((a, b) => a.recon.dueDate.localeCompare(b.recon.dueDate));
  },

  /* The CBS customer number (CIF) the account was fetched under, while the application is still on that account. */
  customerNo(c) {
    const k = c?.cbs;
    return k && k.account === this.normAccount(c.account) ? String(k.customerNumber || '').trim() : '';
  },
  /* Every account the CBS lists under that customer number (a business's branch, project and fund accounts). */
  customerAccounts(c) {
    return this.customerNo(c) ? (c.cbs.related || []).map(x => this.normAccount(x.accountNumber)).filter(Boolean) : [];
  },

  /* Every account number, ID number and customer number known to belong to this client: those on the application and
     every account the CBS lists under its customer number, plus – from every earlier application at any branch – the
     ID and customer numbers used on those accounts and the accounts those were used on, followed until nothing new
     turns up. So an identity or customer number that appears on another account links that account. */
  clientKeys(app) {
    const accts = new Set(), ids = new Set(), cns = new Set();
    const a0 = this.normAccount(app.customer?.account), i0 = this.normId(app.customer?.idNumber), n0 = this.customerNo(app.customer);
    if (a0) accts.add(a0);
    if (i0.length >= 4) ids.add(i0);
    if (n0) { cns.add(n0); this.customerAccounts(app.customer).forEach(x => accts.add(x)); }
    if (!accts.size && !ids.size) return { accts, ids, cns };
    const known = this.S().apps.filter(a => a.id !== app.id && a.customer && (this.inHistory(a) || a.recon));
    for (let grew = true, rounds = 0; grew && rounds < 6; rounds++) {
      grew = false;
      known.forEach(a => {
        const ac = this.normAccount(a.customer.account), id = this.normId(a.customer.idNumber), cn = this.customerNo(a.customer);
        if (!((ac && accts.has(ac)) || (id && ids.has(id)) || (cn && cns.has(cn)))) return;
        if (ac && !accts.has(ac)) { accts.add(ac); grew = true; }
        if (id.length >= 4 && !ids.has(id)) { ids.add(id); grew = true; }
        if (cn && !cns.has(cn)) { cns.add(cn); this.customerAccounts(a.customer).forEach(x => accts.add(x)); grew = true; }
      });
    }
    return { accts, ids, cns };
  },

  /* Unreconciled advance payments for this client (any branch): matched on any of its account, ID or customer numbers.
     One unreconciled item on any account of a customer number counts against every account of that customer. */
  unreconciledFor(app) {
    const { accts, ids, cns } = this.clientKeys(app);
    if (!accts.size && !ids.size) return [];
    return this.unreconciled().filter(a => a.id !== app.id
      && (accts.has(this.normAccount(a.customer?.account)) || ids.has(this.normId(a.customer?.idNumber)) || cns.has(this.customerNo(a.customer))));
  },

  /* Why an unreconciled item belongs to this client (shown to the inputter). */
  unreconciledMatch(app, item) {
    const a0 = this.normAccount(app.customer?.account), i0 = this.normId(app.customer?.idNumber), n0 = this.customerNo(app.customer);
    const ac = this.normAccount(item.customer?.account), id = this.normId(item.customer?.idNumber);
    if (a0 && ac === a0) return 'same account number';
    if (n0 && (this.customerNo(item.customer) === n0 || this.customerAccounts(app.customer).includes(ac))) return `same customer number ${n0} – account ${item.customer.account}${item.customer.name ? ` (${item.customer.name})` : ''}`;
    if (i0 && id === i0) return `same ID number, on account ${item.customer.account}`;
    return `linked through earlier applications – account ${item.customer.account}, ID ${item.customer.idNumber || '—'}`;
  },

  unreconciledMessage(items) {
    const list = items.map(a => `- ${a.ref}: ${a.currency} ${U.num(a.amount)} paid to ${a.beneficiary?.name || 'beneficiary'}, reconciliation due ${U.fmtDate(a.recon.dueDate)}`).join('\n');
    return `Our records show that the following advance payment(s) have not yet been reconciled:\n${list}\n\nPlease submit the import documents (customs entry/bill of entry, final invoice and transport documents) for these payments before applying for further foreign currency.`;
  },

  /* Inputter rejects at capture because the client has unreconciled items; client is advised. */
  inputReject(app, { reason, clientMessage }) {
    this.guard('inputReject', app);
    if (!reason?.trim()) throw new WorkflowError('Give the reason for rejecting.');
    const c = app.customer || {};
    if (!c.name?.trim() || !(c.phone?.trim() || c.email?.trim())) throw new WorkflowError('Capture the customer name and a contact number or email so the client can be advised.');
    const msg = clientMessage?.trim() || reason.trim();
    app.status = 'REJECTED';
    app.rejectedAt = this.nowISO();
    app.rejectedAtInput = true;
    this.touch(app);
    this.addComment(app, 'Rejected at input', reason);
    if (msg !== reason.trim()) this.addComment(app, 'Message to client', msg);
    Store.audit('REJECTED_AT_INPUT', app, `Rejected at input – ${this.unreconciledFor(app).map(a => a.ref).join(', ') || 'unreconciled items'}`);
    this.notify('REJECTED_CLIENT', app, ['client'], { comment: msg });
    Store.save();
  },

  /* ---------- age & expiry ---------- */
  appliedAt(app) { return app.submittedAt || app.createdAt; },
  isOpen(app) { return !['CLOSED', 'REJECTED', 'EXPIRED', 'CANCELLED'].includes(app.status); },
  ageDays(app, on = this.now()) { return U.daysBetween(this.appliedAt(app), on); },

  /* Dated deadlines that can expire on a transaction (day precision). */
  deadlines(app) {
    const d = app.details || {};
    const out = [];
    if (Rules.isTravel(app) && app.status === 'AWAITING_ALLOCATION' && d.travelDate) {
      out.push({ kind: 'travel', item: 'Travel date – forex not yet allocated', date: d.travelDate, action: 'Advise the client not to rely on the allocation unless the bank confirms it. The application closes automatically the day after the travel date if not allocated.' });
    }
    if (Rules.isStudentCase(app) && this.isOpen(app) && d.visaExpiry) {
      out.push({ kind: 'visa', item: 'Student visa / permit expiry', date: d.visaExpiry, action: 'Obtain a renewed visa or permit from the client before the transaction proceeds.' });
    }
    if (app.type === 'ADVANCE' && app.recon && app.recon.status !== 'RECONCILED') {
      out.push({ kind: 'recon', item: 'Advance payment reconciliation due', date: app.recon.dueDate, action: 'Collect the import documents (customs entry/bill of entry, final invoice, transport documents) from the client.' });
    }
    return out;
  },

  timeLeftText(daysLeft) {
    if (daysLeft < 0) return `${-daysLeft} day${daysLeft === -1 ? '' : 's'} overdue`;
    if (daysLeft === 0) return 'today';
    return `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;
  },
  hoursLeftText(ms) {
    const h = Math.floor(ms / 3600000), m = Math.round((ms % 3600000) / 60000);
    return h ? `${h}h ${m}m left` : `${m} min left`;
  },
  fundingAlert(app, alloc, ms) {
    return { kind: 'funding', item: 'Funding deadline for allocated forex', when: U.fmtDateTime(alloc.deadline), timeLeft: this.hoursLeftText(ms), action: `Make sure the client funds account ${app.customer?.account} with MWK ${U.num(alloc.amount * alloc.rate)}, or the allocation of ${app.currency} ${U.num(alloc.amount)} is forfeited.` };
  },

  /* Items reaching expiry right now (used by the "Reaching expiry" queue). */
  expiries(app, now = this.now()) {
    const win = Math.max(...this.S().settings.expiryAlertDays);
    const out = [];
    (app.allocations || []).filter(a => a.status === 'AWAITING_FUNDING').forEach(a => {
      const ms = new Date(a.deadline) - now;
      if (ms > 0) out.push(this.fundingAlert(app, a, ms));
    });
    this.deadlines(app).forEach(x => {
      const left = U.daysBetween(now, x.date);
      if (left <= win && (left >= 0 || x.kind !== 'travel')) out.push(Object.assign({}, x, { when: U.fmtDate(x.date), timeLeft: this.timeLeftText(left) }));
    });
    return out;
  },

  /* Branch personnel: the originating branch, plus the branch it is assigned to if different. */
  branchRecipients(app) {
    const r = [{ branchId: app.branchId }];
    if (app.assignment?.kind === 'BRANCH' && app.assignment.branchId !== app.branchId) r.push({ branchId: app.assignment.branchId });
    return r;
  },

  isAssignedTo(app, user) {
    const a = app.assignment;
    if (!a) return false;
    if (a.kind === 'BRANCH') return this.inBranch(user, a.branchId) && ['INPUTTER', 'AUTHORISER'].includes(user.role);
    return a.userId === user.id;
  },

  guard(action, app) {
    if (!this.can(action, app)) throw new WorkflowError(`You are not allowed to ${action} this application in its current status.`);
  },

  /* ---------- helpers ---------- */
  nextRef() {
    const S = this.S(), year = this.now().getFullYear();
    // End of year can set numbering to restart at 00001 from 1 January of the next year.
    if (S.seqRestartYear && year >= S.seqRestartYear && S.seqYear !== year) { S.seq = 0; S.seqYear = year; }
    S.seq += 1;
    return `FX${this.now().getFullYear()}-${String(S.seq).padStart(5, '0')}`;
  },

  touch(app) {
    app.updatedAt = this.nowISO();
    app.updatedBy = Store.user().id;
  },

  addComment(app, kind, text, actor = Store.user()) {
    if (!text?.trim()) return;
    app.comments.push({ id: U.uid('cm'), at: this.nowISO(), userId: actor.id, userName: actor.name, role: actor.role, kind, text: text.trim() });
  },

  flatten(app) {
    const out = {};
    Object.keys(FIELD_LABELS).forEach(k => { out[k] = U.getPath(app, k) ?? ''; });
    return out;
  },

  diff(before, after) {
    const a = this.flatten(before), b = this.flatten(after);
    const changes = Object.keys(FIELD_LABELS)
      .filter(k => String(a[k]) !== String(b[k]))
      .map(k => ({ field: FIELD_LABELS[k], from: a[k], to: b[k] }));
    const beforeDocs = new Map((before.documents || []).map(d => [d.id, d]));
    const afterDocs = new Map((after.documents || []).map(d => [d.id, d]));
    afterDocs.forEach((d, id) => { if (!beforeDocs.has(id)) changes.push({ field: 'Document added', from: '', to: `${DOC_TYPES[d.code]}: ${d.name}` }); });
    beforeDocs.forEach((d, id) => { if (!afterDocs.has(id)) changes.push({ field: 'Document removed', from: `${DOC_TYPES[d.code]}: ${d.name}`, to: '' }); });
    const contacts = x => (x.customer?.contacts || []).map(k => `${k.value}${k.name ? ` (${k.name})` : ''}`).join(', ');
    if (contacts(before) !== contacts(after)) changes.push({ field: 'Additional phone numbers / emails', from: contacts(before), to: contacts(after) });
    const cbsAt = x => (x.customer?.cbs ? `${x.customer.cbs.source} ${U.fmtDateTime(x.customer.cbs.at)}` : '');
    if (cbsAt(before) !== cbsAt(after)) changes.push({ field: 'Fetched from core banking (CBS)', from: cbsAt(before), to: cbsAt(after) });
    const cbm = x => Object.values(x.cbm?.resolutions || {}).map(r => `${r.label}: ${r.kind === 'CLEARED' ? 'cleared by the other bank' : 'ID differs'}`).join('; ');
    if (cbm(before) !== cbm(after)) changes.push({ field: 'Central bank list check', from: cbm(before), to: cbm(after) });
    return changes;
  },

  blank(user) {
    return {
      id: U.uid('app'), ref: null, status: 'DRAFT', branchId: this.workingBranch(user), createdBy: user.id,
      customer: { accountType: 'LCY' }, type: '', balance: '', balanceCurrency: 'MWK', amount: '', currency: 'USD',
      beneficiary: {}, details: {}, documents: [], comments: [], allocations: [], payments: [],
      ec: null, assignment: null, recon: null, sent: {},
    };
  },

  /* ---------- inputter / authoriser ---------- */
  save(data, { submit = false, comment = '' } = {}) {
    const S = this.S(), user = Store.user();
    let app = Store.app(data.id);
    const isNew = !app;
    if (isNew) {
      if (!this.can('create')) throw new WorkflowError('Only inputters can capture applications.');
      app = Object.assign(this.blank(user), { id: data.id, createdAt: this.nowISO() });
      if (data.branchId && this.inBranch(user, data.branchId)) app.branchId = data.branchId;   // users with several branches choose one
      app.ref = this.nextRef({ branchId: app.branchId, type: data.type, currency: data.currency });   // format: js/refs.js
      S.apps.push(app);
    } else {
      this.guard('edit', app);
    }
    const before = U.clone(app);
    EDITABLE_FIELDS.forEach(k => { if (data[k] !== undefined) app[k] = U.clone(data[k]); else if (k === 'cbm') delete app.cbm; });   // an application saved without the check has none
    app.amount = Number(app.amount) || 0;
    app.balance = app.balance === '' ? '' : Number(app.balance);
    this.touch(app);

    if (isNew) Store.audit('CREATED', app, 'Application captured');
    else {
      const changes = this.diff(before, app);
      if (changes.length) Store.audit('EDITED', app, `${changes.length} change(s) by ${ROLES[user.role]}`, changes);
    }

    if (submit) {
      const v = Rules.validate(app);
      if (v.errors.length) {
        Store.save();
        return { ok: false, app, validation: v };
      }
      this.submit(app, comment);
    } else if (comment && !isNew) {
      this.addComment(app, 'Comment', comment);
    }
    Store.save();
    return { ok: true, app };
  },

  submit(app, comment = '') {
    this.guard('submit', app);
    const v = Rules.validate(app);
    if (v.errors.length) throw new WorkflowError(`Cannot submit: ${v.errors.length} issue(s) to fix.`);
    const wasReturned = app.status === 'RETURNED';
    app.status = 'PENDING_AUTH';
    app.submittedAt = this.nowISO();
    this.touch(app);
    this.addComment(app, wasReturned ? 'Resubmitted' : 'Submitted', comment);
    Store.audit('SUBMITTED', app, wasReturned ? 'Resubmitted for authorisation' : 'Submitted for authorisation');
    this.notify('SUBMITTED_INTERNAL', app, [{ role: 'AUTHORISER', branchId: app.branchId }]);   // only the branch's own authorisers can act
    Store.save();
  },

  reopen(app, reason) {
    this.guard('reopen', app);
    const from = app.status;
    app.status = 'DRAFT';
    this.touch(app);
    this.addComment(app, 'Reopened', reason);
    Store.audit('REOPENED', app, `Reopened from ${STATUS[from].label}`);
    Store.save();
  },

  discard(app) {
    this.guard('discard', app);
    Store.audit('DISCARDED', app, 'Draft discarded');
    this.S().apps = this.S().apps.filter(a => a.id !== app.id);
    Store.save();
  },

  authorise(app, comment) {
    this.guard('authorise', app);
    const v = Rules.validate(app);
    if (v.errors.length) throw new WorkflowError(`Cannot authorise: ${v.errors.length} validation issue(s). Edit the record or return it to the inputter.`);
    app.status = 'AWAITING_ALLOCATION';
    app.authorisedAt = this.nowISO();
    app.authorisedBy = Store.user().id;
    this.touch(app);
    this.addComment(app, 'Authorised', comment);
    Store.audit('AUTHORISED', app, 'Authorised – sent to Treasury & Exchange Control');
    this.notify('AUTHORISED_CLIENT', app, ['client']);
    this.notify('AUTHORISED_INTERNAL', app, [{ role: 'TREASURY' }, { role: 'EC' }]);
    Store.save();
  },

  reject(app, { mode, comment, clientMessage }) {
    this.guard('reject', app);
    if (!comment?.trim()) throw new WorkflowError('A comment is required when rejecting.');
    this.touch(app);
    if (mode === 'RETURN') {
      app.status = 'RETURNED';
      this.addComment(app, 'Returned', comment);
      Store.audit('RETURNED', app, 'Returned to inputter');
      this.notify('RETURNED_INTERNAL', app, ['inputter'], { comment });
    } else {
      const msg = clientMessage?.trim() || comment;
      app.status = 'REJECTED';
      app.rejectedAt = this.nowISO();
      this.addComment(app, 'Rejected', comment);
      if (msg !== comment.trim()) this.addComment(app, 'Message to client', msg);
      Store.audit('REJECTED', app, 'Rejected – client advised');
      this.notify('REJECTED_CLIENT', app, ['client'], { comment: msg });
      this.notify('REJECTED_INTERNAL', app, ['inputter'], { comment: msg });
    }
    Store.save();
  },

  /* ---------- treasury ---------- */
  fundingDeadline(from = this.now()) {
    const [h, m] = this.S().settings.fundingCutoff.split(':').map(Number);
    let d = new Date(from);
    d.setHours(h, m, 0, 0);
    if (d <= from) d = U.addDays(d, 1);
    while (U.isWeekend(d)) d = U.addDays(d, 1);
    return d;
  },

  /* Allocation currency. Treasury may allocate a different currency from the one applied for.
     - allocCurrency / allocAmount: what is actually allocated (e.g. USD 10,800 for an application in EUR);
     - crossRate: units of the allocated currency per 1 unit of the applied currency (mandatory when they differ);
     - rate: MWK per 1 unit of the applied currency (the rate against the applied currency);
     - amount: the applied-currency equivalent. All balances (allocated, funded, paid, outstanding) use it.
     Older allocations have no allocCurrency: they are in the applied currency. */
  allocInfo(app, a) {
    const ccy = a.allocCurrency || app.currency, same = ccy === app.currency;
    return { ccy, same, amt: a.allocAmount ?? a.amount, paid: a.paidAlloc ?? a.paid ?? 0, cross: same ? 1 : Number(a.crossRate) };
  },

  allocCalc(app, { allocCurrency, amount, rate, crossRate }) {
    const ccy = allocCurrency || app.currency, same = ccy === app.currency;
    if (ccy === 'MWK') throw new WorkflowError('Choose a foreign currency to allocate.');
    const allocAmount = U.round2(amount), r = Number(rate), cross = same ? 1 : Number(crossRate);
    if (!(allocAmount > 0)) throw new WorkflowError('Allocation amount must be greater than zero.');
    if (!(r > 0)) throw new WorkflowError(`Enter the rate (MWK per 1 ${app.currency}).`);
    if (!same && !(cross > 0)) throw new WorkflowError(`A cross rate is required when allocating ${ccy} for an application in ${app.currency}: enter how many ${ccy} equal 1 ${app.currency}.`);
    const equiv = same ? allocAmount : U.round2(allocAmount / cross);
    return { ccy, same, allocAmount, rate: r, cross, equiv, mwk: U.round2(equiv * r) };
  },

  /* Exchange Control may enter an allocation on the advice of a Treasury officer working remotely (js/allocation.js).
     A user who is not a Treasury allocator (no act.allocate) but holds act.allocateForTreasury must name the officer. */
  requiresAdvisedBy(user = Store.user()) { return !Access.has(user, 'act.allocate') && Access.has(user, 'act.allocateForTreasury'); },
  advisedByFrom(data) {
    const u = data && data.advisedBy ? Store.userById(data.advisedBy) : null;
    const valid = u && u.role === 'TREASURY' && u.active !== false;
    if (this.requiresAdvisedBy() && !valid) throw new WorkflowError('Choose the Treasury officer who advised this allocation.');
    return valid ? { advisedBy: u.id, advisedByName: u.name } : {};
  },
  advisedNote(adv) {
    if (!adv || !adv.advisedBy) return '';
    const me = Store.user();
    return ` – entered by ${me.name} (${ROLES[me.role]}) on the advice of Treasury officer ${adv.advisedByName}`;
  },

  allocate(app, data) {
    this.guard('allocate', app);
    const t = this.totals(app);
    const c = this.allocCalc(app, data);
    const adv = this.advisedByFrom(data);
    // One cent of the allocated currency is the rounding tolerance; within it the allocation covers the balance exactly.
    const tol = 0.005 + (c.same ? 0 : 0.01 / c.cross);
    if (c.equiv > t.unallocated + tol) throw new WorkflowError(`The allocation (≈ ${app.currency} ${U.num(c.equiv)}) cannot exceed the balance still to allocate: ${app.currency} ${U.num(t.unallocated)}${c.same ? '' : ` (≈ ${c.ccy} ${U.num(t.unallocated * c.cross)})`}.`);
    Rules.assertInvoiceRoom(app);
    const equiv = Math.abs(c.equiv - t.unallocated) <= tol ? t.unallocated : c.equiv;
    const deadline = this.fundingDeadline();
    const alloc = {
      id: U.uid('al'), amount: equiv, allocCurrency: c.ccy, allocAmount: c.allocAmount, rate: c.rate, crossRate: c.same ? null : c.cross,
      valueDate: data.valueDate || U.dayKey(this.now()), note: data.note || '', at: this.nowISO(), by: Store.user().id,
      advisedBy: adv.advisedBy || null, advisedByName: adv.advisedByName || null,
      deadline: deadline.toISOString(), status: 'AWAITING_FUNDING', paid: 0, paidAlloc: 0,
    };
    app.allocations.push(alloc);
    app.status = this.deriveStatus(app);
    this.touch(app);
    this.addComment(app, 'Allocated', data.note);
    const left = U.round2(t.unallocated - equiv);
    Store.audit('ALLOCATED', app, `${c.ccy} ${U.num(c.allocAmount)}${c.same ? '' : ` (≈ ${app.currency} ${U.num(equiv)}, cross rate ${U.num(c.cross, 6)} ${c.ccy} per ${app.currency})`} at ${U.num(c.rate, 4)} MWK per ${app.currency} = MWK ${U.num(equiv * c.rate)}; still to allocate ${app.currency} ${U.num(left)}; fund by ${U.fmtDateTime(deadline)}${this.advisedNote(adv)}`);
    // Enough funds on the account (balance just refreshed from the CBS)? Then the funding stage is skipped (js/funding.js).
    if (typeof Funding !== 'undefined' && Funding.autoFund(app, alloc)) { this.touch(app); Store.save(); return alloc; }
    this.notify('ALLOCATED_CLIENT', app, ['client'], this.allocVars(app, alloc));
    Store.save();
    return alloc;
  },

  /* Treasury corrects an allocation before it is funded (rate, cross rate, currency or amount); the client is re-advised. */
  editAllocation(app, id, data) {
    this.guard('editAllocation', app);
    const a = app.allocations.find(x => x.id === id && x.status === 'AWAITING_FUNDING');
    if (!a) throw new WorkflowError('Only an allocation that is still awaiting funding can be changed.');
    const t = this.totals(app);
    const room = U.round2(t.unallocated + a.amount);
    const c = this.allocCalc(app, Object.assign({ allocCurrency: a.allocCurrency }, data));
    const adv = this.advisedByFrom(data);
    const tol = 0.005 + (c.same ? 0 : 0.01 / c.cross);
    if (Math.abs(c.equiv - room) <= tol) c.equiv = room;
    if (c.equiv > room + 0.005) throw new WorkflowError(`The allocation (≈ ${app.currency} ${U.num(c.equiv)}) cannot exceed ${app.currency} ${U.num(room)} (the balance still to allocate including this allocation).`);
    const before = this.allocInfo(app, a), oldRate = a.rate, oldEquiv = a.amount;
    const changes = [];
    const ch = (field, from, to) => { if (String(from) !== String(to)) changes.push({ field, from: String(from), to: String(to) }); };
    ch('Allocated currency', before.ccy, c.ccy);
    ch('Allocated amount', U.num(before.amt), U.num(c.allocAmount));
    ch(`Rate (MWK per ${app.currency})`, U.num(oldRate, 4), U.num(c.rate, 4));
    ch(`Cross rate (${c.ccy} per ${app.currency})`, before.same ? '—' : U.num(before.cross, 6), c.same ? '—' : U.num(c.cross, 6));
    ch(`Equivalent (${app.currency})`, U.num(oldEquiv), U.num(Math.min(c.equiv, room)));
    if (!changes.length) throw new WorkflowError('Nothing was changed.');
    Object.assign(a, { amount: Math.min(c.equiv, room), allocCurrency: c.ccy, allocAmount: c.allocAmount, rate: c.rate, crossRate: c.same ? null : c.cross, editedAt: this.nowISO(), editedBy: Store.user().id });
    if (adv.advisedBy) Object.assign(a, { advisedBy: adv.advisedBy, advisedByName: adv.advisedByName });
    if (data.note) a.note = data.note;
    app.status = this.deriveStatus(app);
    this.touch(app);
    this.addComment(app, 'Allocation changed', data.note || changes.map(x => `${x.field}: ${x.from} → ${x.to}`).join('; '));
    Store.audit('ALLOCATION_EDITED', app, `Allocation changed before funding – now ${c.ccy} ${U.num(c.allocAmount)}, MWK ${U.num(a.amount * a.rate)} to fund${this.advisedNote(adv)}`, changes);
    this.notify('ALLOCATED_CLIENT', app, ['client'], this.allocVars(app, a));
    Store.save();
    return a;
  },

  allocVars(app, alloc) {
    const deadline = new Date(alloc.deadline);
    const i = this.allocInfo(app, alloc);
    return {
      currency: i.ccy, allocatedAmount: U.num(i.amt), rate: U.num(alloc.rate, 4) + (i.same ? '' : ` MWK per ${app.currency}`),
      crossRate: i.same ? 'n/a' : `${U.num(i.cross, 6)} ${i.ccy} per ${app.currency}`,
      appliedEquivalent: `${app.currency} ${U.num(alloc.amount)}`,
      mwkEquivalent: U.num(alloc.amount * alloc.rate),
      deadline: `${U.fmtTime(deadline)} on ${U.fmtDate(deadline)}`,
    };
  },

  confirmFunding(app, comment = '') {
    this.guard('confirmFunding', app);
    app.allocations.filter(a => a.status === 'AWAITING_FUNDING').forEach(a => { a.status = 'FUNDED'; a.fundedAt = this.nowISO(); a.fundedBy = Store.user().id; });
    app.status = this.deriveStatus(app);
    this.touch(app);
    this.addComment(app, 'Funding confirmed', comment);
    const u = Store.user();
    Store.audit('FUNDING_CONFIRMED', app, `Client account funded before cut-off – confirmed by ${ROLES[u.role]}`);
    const recipients = [{ role: 'EC' }];
    if (app.assignment?.kind === 'USER' && Store.userById(app.assignment.userId)?.role !== 'EC') recipients.push({ userId: app.assignment.userId });
    if (app.assignment?.kind === 'BRANCH') recipients.push({ branchId: app.assignment.branchId });
    this.notify('FUNDED_INTERNAL', app, recipients, { comment: comment || '', confirmedBy: `${u.name} (${ROLES[u.role]}, ${Store.branch(u.branchId)?.name || ''})` });
    Store.save();
  },

  forfeit(app, reason, actor = null) {
    if (!actor) this.guard('forfeit', app);
    const at = this.nowISO();
    app.allocations.filter(a => a.status === 'AWAITING_FUNDING').forEach(a => {
      a.status = 'FORFEITED'; a.forfeitedAt = at;
      this.notify('FORFEITED_CLIENT', app, ['client'], this.allocVars(app, a));
    });
    app.status = this.deriveStatus(app);
    app.updatedAt = at;
    this.addComment(app, 'Allocation forfeited', reason, actor || Store.user());
    Store.audit('ALLOCATION_FORFEITED', app, reason, null, actor);
    Store.save();
  },

  /* ---------- exchange control ---------- */
  recommend(app, { recommendation, note }) {
    this.guard('recommend', app);
    app.ec = { recommendation, note: note || '', by: Store.user().id, at: this.nowISO() };
    this.touch(app);
    this.addComment(app, `EC: ${recommendation}`, note);
    Store.audit('EC_RECOMMENDATION', app, recommendation);
    Store.save();
  },

  assign(app, { kind, userId, branchId, note }) {
    this.guard('assign', app);
    const me = Store.user();
    if (kind === 'SELF') { kind = 'USER'; userId = me.id; }
    if (kind === 'USER' && !Store.userById(userId)) throw new WorkflowError('Select a user.');
    if (kind === 'BRANCH' && !Store.branch(branchId)) throw new WorkflowError('Select a branch.');
    app.assignment = { kind, userId: kind === 'USER' ? userId : null, branchId: kind === 'BRANCH' ? branchId : null, by: me.id, at: this.nowISO(), note: note || '' };
    this.touch(app);
    const name = this.assigneeName(app);
    this.addComment(app, `Assigned to ${name}`, note);
    Store.audit('ASSIGNED', app, `Assigned to ${name}`);
    this.notify('ASSIGNED_INTERNAL', app, [kind === 'USER' ? { userId } : { branchId }], { assigneeName: name, comment: note || '' });
    Store.save();
  },

  assigneeName(app) {
    const a = app.assignment;
    if (!a) return '—';
    return a.kind === 'BRANCH' ? Store.branch(a.branchId)?.name : Store.userById(a.userId)?.name;
  },

  /* A payment is made against funded allocations and reduces the outstanding balance. With allocationId the amount is
     in that allocation's currency (e.g. USD for a EUR application allocated in USD); without it, the amount is in the
     applied currency and is applied oldest allocation first. A payment can never exceed what is left on the
     allocation, the application's outstanding balance, or (for invoices) what is left of the invoice. */
  recordPayment(app, { outcome, amount, allocationId, reference, correspondentId, valueDate, comment }) {
    this.guard('pay', app);
    const t = this.totals(app);
    if (!reference?.trim()) throw new WorkflowError('Enter the payment reference (e.g. SWIFT MT103 reference).');
    const funded = app.allocations.filter(a => a.status === 'FUNDED' && a.amount - a.paid > 0.005);
    const parts = [];
    let payCurrency = app.currency, payAmount;
    if (allocationId) {
      const a = funded.find(x => x.id === allocationId);
      if (!a) throw new WorkflowError('That allocation is not funded or has already been paid in full.');
      const i = this.allocInfo(app, a);
      payCurrency = i.ccy; payAmount = U.round2(amount);
      if (!(payAmount > 0)) throw new WorkflowError('Enter the amount paid.');
      const leftAlloc = U.round2(i.amt - i.paid);
      if (payAmount > leftAlloc + 0.005) throw new WorkflowError(`Amount paid cannot exceed what is left on this allocation: ${i.ccy} ${U.num(leftAlloc)}.`);
      const equiv = payAmount >= leftAlloc - 0.005 ? U.round2(a.amount - a.paid) : Math.min(U.round2(payAmount / i.cross), U.round2(a.amount - a.paid));
      parts.push({ a, i, equiv, inAlloc: Math.min(payAmount, leftAlloc) });
    } else {
      payAmount = U.round2(amount);
      if (!(payAmount > 0)) throw new WorkflowError('Enter the amount paid.');
      if (payAmount > t.fundedUnpaid + 0.005) throw new WorkflowError(`Amount paid cannot exceed the funded allocation (${app.currency} ${U.num(t.fundedUnpaid)}).`);
      let left = payAmount;
      funded.forEach(a => {
        const take = Math.min(left, U.round2(a.amount - a.paid));
        if (!(take > 0)) return;
        const i = this.allocInfo(app, a);
        parts.push({ a, i, equiv: take, inAlloc: i.same ? take : U.round2(take * i.cross) });
        left = U.round2(left - take);
      });
    }
    const amountApplied = U.round2(U.sum(parts, p => p.equiv));
    if (amountApplied > t.balance + 0.005) throw new WorkflowError(`The payment (≈ ${app.currency} ${U.num(amountApplied)}) would exceed the outstanding balance of ${app.currency} ${U.num(t.balance)}.`);
    Rules.assertInvoicePayment(app, amountApplied);

    let mwk = 0;
    parts.forEach(p => {
      p.a.paidAlloc = U.round2(p.i.paid + p.inAlloc);
      p.a.paid = U.round2(p.a.paid + p.equiv);
      mwk += p.equiv * p.a.rate;
    });
    amount = amountApplied;
    const pay = { id: U.uid('pay'), amount, payCurrency, payAmount, allocationId: allocationId || null, rate: mwk / amount, mwk, reference: reference.trim(), correspondentId: correspondentId || null, valueDate: valueDate || U.dayKey(this.now()), at: this.nowISO(), by: Store.user().id, outcome, comment: comment || '',
      parts: parts.map(p => ({ allocationId: p.a.id, equiv: p.equiv, inAlloc: p.inAlloc })) };   // so a reversal can restore each allocation
    app.payments.push(pay);
    const after = this.totals(app);
    if (outcome === 'FULL' || after.balance <= 0.005) {
      app.closedAt = this.nowISO();
      app.closedShort = after.balance > 0.005;
      // Any allocation still funded but unused is released.
      app.allocations.filter(a => a.status === 'FUNDED' && a.amount - a.paid > 0.005).forEach(a => { a.released = U.round2(a.amount - a.paid); a.amount = a.paid; });
    }
    app.status = this.deriveStatus(app);
    this.touch(app);

    let processingStatus;
    if (app.status === 'CLOSED') {
      processingStatus = app.closedShort
        ? `Fully paid at ${app.currency} ${U.num(after.paid)} (the remaining ${app.currency} ${U.num(after.balance)} was cancelled). This application is now closed.`
        : 'Fully paid. This application is now closed.';
      if (app.type === 'ADVANCE') {
        const due = U.addDays(this.now(), this.S().settings.reconDays);
        app.recon = { status: 'PENDING', dueDate: U.dayKey(due) };
        processingStatus += ` As this is an advance payment, it must be reconciled by ${U.fmtDate(due)}.`;
      }
    } else {
      processingStatus = `Partly paid. Balance of ${app.currency} ${U.num(after.balance)} is still required.`;
    }
    this.addComment(app, app.status === 'CLOSED' ? 'Paid – closed' : 'Partly paid', comment);
    Store.audit('PAYMENT_RECORDED', app, `${payCurrency} ${U.num(payAmount)}${payCurrency !== app.currency ? ` (≈ ${app.currency} ${U.num(amount)})` : ''} ref ${pay.reference} – ${app.status === 'CLOSED' ? 'fully paid, closed' : `partly paid, balance ${app.currency} ${U.num(after.balance)}`}`);

    const vars = { paidAmount: U.num(amount), balance: U.num(after.balance), processingStatus };
    this.notify('PROCESSED_CLIENT', app, ['client'], vars);
    const internal = ['inputter', 'branch'];
    if (app.assignment?.kind === 'BRANCH' && app.assignment.branchId !== app.branchId) internal.push({ branchId: app.assignment.branchId });
    this.notify('PROCESSED_INTERNAL', app, internal, vars);
    Store.save();
    return pay;
  },

  /* Final step of the reconciliation workflow (js/recon.js): Exchange Control closes an item that the authoriser sent for review. */
  reconcile(app, { comment, documents }) {
    if (typeof Recon !== 'undefined') { (documents || []).forEach(d => { app.recon.documents = app.recon.documents || []; app.recon.documents.push(d); }); return Recon.reconcile(app, comment); }
    this.guard('reconcile', app);
    app.recon.status = 'RECONCILED';
    app.recon.reconciledAt = this.nowISO();
    app.recon.by = Store.user().id;
    (documents || []).forEach(d => app.documents.push(d));
    this.touch(app);
    this.addComment(app, 'Reconciled', comment);
    Store.audit('RECONCILED', app, 'Advance payment reconciled');
    this.notify('RECONCILED_CLIENT', app, ['client']);
    Store.save();
  },

  comment(app, text) {
    this.guard('comment', app);
    this.addComment(app, 'Comment', text);
    this.touch(app);
    Store.audit('COMMENTED', app, text.length > 80 ? text.slice(0, 77) + '…' : text);
    Store.save();
  },

  /* ---------- notifications ---------- */
  vars(app, extra = {}) {
    const S = this.S();
    const br = Store.branch(app.branchId) || {};
    const inputter = Store.userById(app.createdBy) || {};
    const d = app.details || {};
    const due = app.recon?.dueDate;
    const today = this.now();
    return Object.assign({
      customerName: app.customer?.name, account: app.customer?.account, ref: app.ref,
      type: TXN_TYPES[app.type]?.label || '', currency: app.currency, amount: U.num(app.amount),
      beneficiaryName: app.beneficiary?.name, country: app.beneficiary?.country,
      branchName: br.name, branchPhone: br.phone, branchEmail: br.email,
      bankName: S.bank.name, bankPhone: S.bank.phone, bankEmail: S.bank.email,
      inputterName: inputter.name,
      travelDate: d.travelDate ? U.fmtDate(d.travelDate) : '', returnDate: d.returnDate ? U.fmtDate(d.returnDate) : '',
      daysToTravel: d.travelDate ? U.daysBetween(today, d.travelDate) : '',
      reconDate: due ? U.fmtDate(due) : '', daysToRecon: due ? U.daysBetween(today, due) : '',
      balance: U.num(this.totals(app).balance), assigneeName: this.assigneeName(app), comment: '',
      statusLabel: STATUS[app.status]?.label || '', appliedDate: U.fmtDate(this.appliedAt(app)), ageDays: this.ageDays(app, today),
    }, extra);
  },

  /* All the client's phone numbers / email addresses: the main one first, then the additional contacts. */
  clientPhones(c = {}) { return [...new Set([c.phone, ...(c.contacts || []).filter(x => x.kind === 'phone').map(x => x.value)].map(v => String(v || '').trim()).filter(Boolean))]; },
  clientEmails(c = {}) { return [...new Set([c.email, ...(c.contacts || []).filter(x => x.kind === 'email').map(x => x.value)].map(v => String(v || '').trim().toLowerCase()).filter(Boolean))]; },

  render(text, vars) {
    return String(text || '').replace(/{{\s*(\w+)\s*}}/g, (_, k) => (vars[k] ?? ''));
  },

  /* recipients: 'client' | 'inputter' | 'branch' | {role} | {userId} | {branchId} */
  notify(code, app, recipients, extra = {}, at = null) {
    const S = this.S();
    const tpl = S.templates[code];
    if (!tpl || tpl.enabled === false) return;
    const vars = this.vars(app, extra);
    const subject = this.render(tpl.subject, vars);
    const body = this.render(tpl.body, vars);
    const when = at || this.nowISO();
    const push = (m) => S.outbox.push(Object.assign({ id: U.uid('msg'), at: when, code, template: tpl.name, appId: app.id, ref: app.ref, subject, body, userIds: [], readBy: [] }, m));

    recipients.forEach(r => {
      if (r === 'client') {
        // Every email address and phone number on the application gets the alert (e.g. company signatories), and
        // each alert names the customer and the account it concerns.
        const c = app.customer || {};
        const emails = this.clientEmails(c), phones = this.clientPhones(c);
        const who = `${c.name || 'Customer'}${c.account ? ` (account ending ${String(c.account).replace(/\D/g, '').slice(-4)})` : ''}`;
        const subj = !c.name || subject.includes(c.name) ? subject : `${c.name} – ${subject}`;
        const head = `Customer: ${who}\n\n`;
        const many = (n, what) => (n > 1 ? ` – ${n} ${what}` : '');
        if (emails.length) {
          const footer = this.render(S.bank.noReplyFooter, vars).trim();
          push({ audience: 'Client', channel: 'Email', to: emails.join('; '), toLabel: `${c.name}${many(emails.length, 'addresses')}`, from: `${S.bank.senderName} <${S.bank.noReplyEmail}>`, subject: subj, body: head + (footer ? `${body}\n\n${footer}` : body) });
        }
        if (phones.length) push({ audience: 'Client', channel: 'SMS', to: phones.join('; '), toLabel: `${c.name}${many(phones.length, 'numbers')}`, subject: subj, body: head + body });
      } else if (r === 'inputter') {
        const u = Store.userById(app.createdBy);
        if (u) push({ audience: 'Staff', channel: 'Email + in-app', to: u.email, toLabel: `${u.name} (inputter)`, userIds: [u.id] });
      } else if (r === 'branch') {
        const b = Store.branch(app.branchId);
        if (b) push({ audience: 'Staff', channel: 'Email', to: b.email, toLabel: b.name });
      } else if (r.role) {
        const users = S.users.filter(u => u.role === r.role && u.active !== false && (!r.branchId || this.inBranch(u, r.branchId)));
        if (users.length) push({ audience: 'Staff', channel: 'Email + in-app', to: users.map(u => u.email).join('; '), toLabel: r.branchId ? `${ROLES[r.role]}s – ${UI.branchName(r.branchId)}` : ROLES[r.role], userIds: users.map(u => u.id) });
      } else if (r.userId) {
        const u = Store.userById(r.userId);
        if (u) push({ audience: 'Staff', channel: 'Email + in-app', to: u.email, toLabel: u.name, userIds: [u.id] });
      } else if (r.branchId) {
        const b = Store.branch(r.branchId);
        const users = S.users.filter(u => this.inBranch(u, r.branchId) && ['INPUTTER', 'AUTHORISER'].includes(u.role));
        if (b) push({ audience: 'Staff', channel: 'Email + in-app', to: b.email, toLabel: b.name, userIds: users.map(u => u.id) });
      }
    });
  },

  inbox(user = Store.user()) {
    return this.S().outbox.filter(m => m.userIds?.includes(user.id)).sort((a, b) => b.at.localeCompare(a.at));
  },
  unreadCount(user = Store.user()) {
    return this.inbox(user).filter(m => !m.readBy.includes(user.id)).length;
  },

  /* ---------- simulated clock & scheduler ---------- */
  setClock(date) {
    const S = this.S();
    if (date < this.now()) throw new WorkflowError('The clock can only move forward.');
    S.clock = date.toISOString();
    const n = this.runScheduler();
    Store.save();
    return n;
  },

  /* Idempotent: each reminder has a key in app.sent, so re-running never duplicates messages.
     Walks every day since the last run so jumping the clock forward a week still sends each day's notices. */
  runScheduler() {
    const S = this.S();
    const now = this.now();
    const st = S.settings;
    const from = U.startOfDay(S.schedulerLastRun ? new Date(S.schedulerLastRun) : now);
    const before = S.outbox.length;
    const once = (app, key, fn) => { app.sent = app.sent || {}; if (app.sent[key]) return; app.sent[key] = true; fn(); };
    const at8 = (day) => { const d = new Date(day); d.setHours(8, 0, 0, 0); return (d > now ? now : d).toISOString(); };

    // 1. Forfeit allocations not funded by the deadline (time-of-day precision).
    S.apps.forEach(app => {
      (app.allocations || []).filter(a => a.status === 'AWAITING_FUNDING' && new Date(a.deadline) <= now).forEach(a => {
        const saved = S.clock;
        S.clock = a.deadline;          // stamp the forfeiture at the deadline itself
        this.forfeit(app, `Account not funded by ${U.fmtDateTime(a.deadline)} – allocation forfeited automatically.`, SYSTEM_ACTOR);
        S.clock = saved;
      });
    });

    // 2. Branch alert: funding deadline approaching (hour precision).
    S.apps.forEach(app => {
      (app.allocations || []).filter(a => a.status === 'AWAITING_FUNDING').forEach(a => {
        const ms = new Date(a.deadline) - now;
        if (ms > 0 && ms <= st.fundingReminderHours * 3600000) {
          once(app, `branch-fund-${a.id}`, () => {
            const x = this.fundingAlert(app, a, ms);
            this.notify('BRANCH_EXPIRY_ALERT', app, this.branchRecipients(app), { expiryItem: x.item, expiryDate: x.when, timeLeft: x.timeLeft, actionNeeded: x.action });
          });
        }
      });
    });

    // 3. Day-based reminders.
    for (let day = from; day <= now; day = U.addDays(day, 1)) {
      const dk = U.dayKey(day);
      S.apps.forEach(app => {
        app.sent = app.sent || {};
        // Branch alerts: deadlines reaching expiry (e.g. 7, 3 and 1 days before).
        this.deadlines(app).forEach(x => {
          const left = U.daysBetween(day, x.date);
          if (st.expiryAlertDays.includes(left)) {
            once(app, `branch-exp-${x.kind}-${x.date}-${left}`, () => this.notify('BRANCH_EXPIRY_ALERT', app, this.branchRecipients(app),
              { expiryItem: x.item, expiryDate: U.fmtDate(x.date), timeLeft: this.timeLeftText(left), actionNeeded: x.action }, at8(day)));
          }
        });
        // Branch alerts: open for more than N days – first time it crosses, then every few days until closed.
        if (this.isOpen(app)) {
          const age = U.daysBetween(this.appliedAt(app), day);
          if (age > st.agingDays && (!app.sent['aging-first'] || (age - st.agingDays - 1) % st.agingRepeatDays === 0)) {
            once(app, `branch-age-${dk}`, () => {
              app.sent['aging-first'] = true;
              this.notify('BRANCH_AGING_ALERT', app, this.branchRecipients(app), { ageDays: age }, at8(day));
            });
          }
        }
        // Travel allowances not yet allocated.
        if (Rules.isTravel(app) && app.status === 'AWAITING_ALLOCATION' && app.details?.travelDate && app.authorisedAt) {
          const toTravel = U.daysBetween(day, app.details.travelDate);
          const sinceAuth = U.daysBetween(app.authorisedAt, day);
          if (toTravel < 0) {
            once(app, 'travel-apology', () => {
              const saved = S.clock;
              S.clock = at8(day);
              this.notify('TRAVEL_APOLOGY_CLIENT', app, ['client'], {}, S.clock);
              app.status = 'EXPIRED';
              app.closedAt = S.clock;
              app.updatedAt = S.clock;
              this.addComment(app, 'Closed – not allocated', 'Travel date passed without allocation. Apology sent to client.', SYSTEM_ACTOR);
              Store.audit('EXPIRED', app, 'Travel date passed without allocation – apology sent, record closed', null, SYSTEM_ACTOR);
              S.clock = saved;
            });
          } else if (toTravel >= 1 && toTravel <= st.travelDailyLastDays) {
            once(app, `travel-daily-${dk}`, () => this.notify('TRAVEL_NOT_ALLOCATED_CLIENT', app, ['client'], { daysToTravel: toTravel }, at8(day)));
          } else if (toTravel > st.travelDailyLastDays && sinceAuth > 0 && sinceAuth % st.travelWeeklyEveryDays === 0) {
            once(app, `travel-weekly-${dk}`, () => this.notify('TRAVEL_NOT_ALLOCATED_CLIENT', app, ['client'], { daysToTravel: toTravel }, at8(day)));
          }
        }
        // Advance payment reconciliation (no reminders while documents are with the authoriser or Exchange Control).
        if (app.type === 'ADVANCE' && ['PENDING', 'RETURNED', 'DECLINED'].includes(app.recon?.status)) {
          const toDue = U.daysBetween(day, app.recon.dueDate);
          if (st.reconPreDueOffsets.includes(toDue)) {
            once(app, `recon-pre-${toDue}`, () => this.notify('RECON_REMINDER_CLIENT', app, ['client', 'inputter'], { daysToRecon: toDue }, at8(day)));
          } else if (toDue < 0 && (-toDue - 1) % st.reconOverdueEveryDays === 0) {
            once(app, `recon-overdue-${dk}`, () => this.notify('RECON_OVERDUE_CLIENT', app, ['client', 'inputter'], { daysToRecon: toDue }, at8(day)));
          }
        }
      });
    }
    S.schedulerLastRun = now.toISOString();
    S.outbox.sort((a, b) => a.at.localeCompare(b.at));
    return S.outbox.length - before;
  },
};

// Signing out forgets the working branch: the next sign-in starts in the home branch.
document.addEventListener('DOMContentLoaded', () => {
  if (typeof Auth === 'undefined' || Auth.__wbWrapped) return;
  const out = Auth.signOut;
  Auth.signOut = function (...args) { try { sessionStorage.removeItem(Engine.WB_KEY); } catch (e) { /* no storage */ } return out.apply(this, args); };
  Auth.__wbWrapped = true;
});
