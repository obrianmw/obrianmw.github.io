'use strict';

/* Advance payment reconciliation – workflow, search, list and report (all users can view; Treasury view only).

   Awaiting documents (PENDING) ─► Inputter finds the transaction (account, ID number, phone, email, payment/SWIFT
   reference or application reference), uploads the documents (customs entry / bill of entry and final invoice are
   mandatory) and submits ─► With authoriser (SUBMITTED; authoriser of the submitting branch, never the submitter)
     ├─ reject (comment mandatory) ─► Returned to inputter (RETURNED) ─► fix and resubmit
     └─ authorise ─► client told the documents were received and are being reviewed ─► With Exchange Control (REVIEW)
          ├─ reconcile ─► client told it is reconciled and closed (RECONCILED)
          └─ decline (comment mandatory) ─► inputter and authoriser told (DECLINED); either can send the client an
             alert; the inputter adds documents and resubmits.
   Client notifications are sent only at those points. Reminders to the client stop while documents are with the
   authoriser or Exchange Control.
   Any inputter at any branch can start it. The branch that owns the application is told when it is reconciled
   (always), and when another branch submits or authorises its documents. */

const RECON_STATUS = {
  PENDING: { label: 'Awaiting documents', tone: 'amber' },
  RETURNED: { label: 'Returned to inputter', tone: 'amber' },
  SUBMITTED: { label: 'With authoriser', tone: 'blue' },
  REVIEW: { label: 'With Exchange Control', tone: 'violet' },
  DECLINED: { label: 'Declined by Exchange Control', tone: 'red' },
  RECONCILED: { label: 'Reconciled', tone: 'green' },
};
const RECON_DOCS = [
  ['RECON_CUSTOMS', 'Customs entry / bill of entry', true],
  ['RECON_INVOICE', 'Final commercial invoice', true],
  ['RECON_TRANSPORT', 'Transport document (bill of lading / airway bill)', false],
  ['RECON_OTHER', 'Other supporting document', false],
];
RECON_DOCS.forEach(([code, label]) => { DOC_TYPES[code] = label; });

Object.assign(DEFAULT_TEMPLATES, {
  RECON_SUBMITTED_INTERNAL: {
    name: 'Reconciliation – documents to review', audience: 'Staff', trigger: 'Inputter submits reconciliation documents (to the branch authorisers)',
    subject: '[Forex] Reconciliation documents for {{ref}} to review',
    body: 'Dear Authoriser,\n\nReconciliation documents for advance payment {{ref}} ({{customerName}}, {{currency}} {{amount}}) were submitted by {{submittedBy}} and are waiting for your review.\n\n{{comment}}\n\nForex Applications',
  },
  RECON_RETURNED_INTERNAL: {
    name: 'Reconciliation – returned by authoriser', audience: 'Staff', trigger: 'Authoriser rejects reconciliation documents (to the inputter who submitted)',
    subject: '[Forex] Reconciliation of {{ref}} returned',
    body: 'Dear {{inputterName}},\n\nThe reconciliation documents for advance payment {{ref}} ({{customerName}}) were returned by the authoriser:\n\n{{comment}}\n\nPlease correct them and submit again.\n\nForex Applications',
  },
  RECON_RECEIVED_CLIENT: {
    name: 'Reconciliation – documents received', audience: 'Client', trigger: 'Authoriser authorises the reconciliation documents',
    subject: 'Documents received – advance payment {{ref}}',
    body: 'Dear {{customerName}},\n\nWe acknowledge receipt of the import documents for advance payment {{ref}} ({{currency}} {{amount}}). They are now being reviewed by Exchange Control, and we will confirm once the payment has been reconciled.\n\nYours faithfully,\n{{bankName}}',
  },
  RECON_REVIEW_INTERNAL: {
    name: 'Reconciliation – for Exchange Control', audience: 'Staff', trigger: 'Authoriser authorises the reconciliation documents (to Exchange Control)',
    subject: '[Forex] Reconciliation of {{ref}} for final checks',
    body: 'Dear Exchange Control,\n\nReconciliation documents for advance payment {{ref}} ({{customerName}}, {{currency}} {{amount}}, {{branchName}}) have been authorised and are ready for your final checks.\n\n{{comment}}\n\nForex Applications',
  },
  RECON_DECLINED_INTERNAL: {
    name: 'Reconciliation – declined by Exchange Control', audience: 'Staff', trigger: 'Exchange Control declines a reconciliation (to the inputter and authoriser)',
    subject: '[Forex] Reconciliation of {{ref}} declined by Exchange Control',
    body: 'Dear colleague,\n\nExchange Control declined the reconciliation of advance payment {{ref}} ({{customerName}}):\n\n{{comment}}\n\nYou can send the client an alert from the reconciliation page and resubmit when the client brings the documents.\n\nForex Applications',
  },
  RECON_BRANCH_INTERNAL: {
    name: 'Reconciliation – handled at another branch', audience: 'Staff', trigger: 'Another branch submits or authorises reconciliation documents (to the branch that owns the application)',
    subject: '[Forex] Reconciliation of {{ref}} – {{step}}',
    body: 'Dear {{branchName}},\n\nThe reconciliation of your advance payment {{ref}} ({{customerName}}, {{currency}} {{amount}}) is being handled at {{handlingBranch}}:\n\n{{step}} by {{actor}}.\n\n{{comment}}\n\nYou can follow it on the Reconciliation page.\n\nForex Applications',
  },
  RECONCILED_BRANCH_INTERNAL: {
    name: 'Reconciliation – reconciled (to branch)', audience: 'Staff', trigger: 'Exchange Control reconciles an advance payment (to the owning branch, and the branch that submitted the documents if different)',
    subject: '[Forex] {{ref}} reconciled and closed',
    body: 'Dear colleague,\n\nAdvance payment {{ref}} ({{customerName}}, {{currency}} {{amount}}) of {{branchName}} has been reconciled and closed by Exchange Control ({{actor}}).\n\nDocuments submitted at {{handlingBranch}}.\n\n{{comment}}\n\nForex Applications',
  },
  RECON_DECLINED_CLIENT: {
    name: 'Reconciliation – declined (alert to client)', audience: 'Client', trigger: 'Inputter or authoriser alerts the client after Exchange Control declines',
    subject: 'Advance payment {{ref}} – further documents required',
    body: 'Dear {{customerName}},\n\nThe documents submitted to reconcile advance payment {{ref}} ({{currency}} {{amount}}) could not be accepted:\n\n{{comment}}\n\nPlease bring the required documents to {{branchName}}. The reconciliation was due on {{reconDate}}.\n\nYours faithfully,\n{{bankName}}',
  },
});
DEFAULT_TEMPLATES.RECONCILED_CLIENT = Object.assign({}, DEFAULT_TEMPLATES.RECONCILED_CLIENT, {
  body: 'Dear {{customerName}},\n\nThank you. Advance payment {{ref}} ({{currency}} {{amount}}) has been reconciled and the matter is now closed. No further documents are required.\n\nYours faithfully,\n{{bankName}}',
});

/* Advance payments not yet due for reconciliation belong to their branch: other branches see them only once they are
   overdue. Treasury, Exchange Control and Administrators (this right) see every branch's, at any stage. */
ACCESS_FIXED.push(
  ['view.reconAllBranches', 'Views', 'Reconciliation – all branches before the due date', 'See every branch\'s advance payments awaiting reconciliation, including those not yet due, in every view (reconciliation, reports, dashboard, application pages). Without this, a user sees another branch\'s items only once they are overdue.', ['TREASURY', 'EC', 'ADMIN']],
);

const Recon = {
  items(u = Store.user()) { return Store.state.apps.filter(a => a.type === 'ADVANCE' && a.recon && this.visible(a, u)); },

  /* May this user see this advance payment? Open (not yet reconciled) items that are not yet due: only users of the
     branch that made it or holds its documents, users it is assigned to, and users with the all-branches right. */
  visible(a, u = Store.user()) {
    if (!u || !a || a.type !== 'ADVANCE' || !a.recon || this.status(a) === 'RECONCILED') return true;
    if (Access.has(u, 'view.reconAllBranches')) return true;
    if ((a.recon.dueDate || '') < U.dayKey(Store.now())) return true;
    return Engine.inBranch(u, a.branchId) || Engine.inBranch(u, this.branchOf(a)) || Engine.isAssignedTo(a, u);
  },

  /* Filters beyond branch and status: application type, currency, account currency and account type. */
  extraFilters: [['type', 'Type', 'All types'], ['ccy', 'Currency', 'All currencies'], ['acct', 'Account currency', 'All account currencies'], ['acctType', 'Account type', 'Local & foreign accounts']],
  acctCcy(a) { return a.balanceCurrency || 'MWK'; },
  extraOptions(key) {
    const items = this.items();
    if (key === 'type') return Object.entries(TXN_TYPES).filter(([k, t]) => t.reconciliation || items.some(a => a.type === k)).map(([k, t]) => [k, t.label]);
    if (key === 'ccy') return [...new Set([...CURRENCIES, ...items.map(a => a.currency)])].filter(Boolean).map(c => [c, c]);
    if (key === 'acct') return [...new Set([...ACCOUNT_CURRENCIES, ...items.map(a => this.acctCcy(a))])].filter(Boolean).map(c => [c, c]);
    return Object.entries(ACCOUNT_TYPES);
  },
  extraMatch(f, a) {
    return (!f.type || a.type === f.type) && (!f.ccy || a.currency === f.ccy) && (!f.acct || this.acctCcy(a) === f.acct) && (!f.acctType || a.customer?.accountType === f.acctType);
  },
  extraHtml(f) {
    return this.extraFilters.map(([k, l, all]) => `<select data-xf="${k}" aria-label="${l}"><option value="">${all}</option>${this.extraOptions(k).map(([v, t]) => `<option value="${U.esc(v)}" ${f[k] === v ? 'selected' : ''}>${U.esc(t)}</option>`).join('')}</select>`).join('');
  },
  bindExtra(root, f, redraw) { root.querySelectorAll('[data-xf]').forEach(sel => sel.addEventListener('change', e => { f[sel.dataset.xf] = e.target.value; redraw(); })); },
  extraLabel(f) {
    return [f.type ? UI.typeLabel(f.type) : '', f.ccy ? `in ${f.ccy}` : '', f.acct ? `account currency ${f.acct}` : '', f.acctType ? ACCOUNT_TYPES[f.acctType] : ''].filter(Boolean).map(x => ` · ${x}`).join('');
  },
  /* Treasury, Exchange Control and Administrators start on the whole bank; branch staff on their own branch. */
  defaultBranch(u = Store.user()) { return Access.has(u, 'view.reconAllBranches') ? '' : 'mine'; },

  status(a) { return a.recon?.status || 'PENDING'; },
  branchOf(a) { return a.recon?.branchId || a.branchId; },
  overdue(a) { return this.status(a) !== 'RECONCILED' && a.recon.dueDate < U.dayKey(Store.now()); },

  can(action, app, user = Store.user()) {
    if (!user || !app?.recon || (typeof Periods !== 'undefined' && Periods.blocked())) return false;
    const st = this.status(app), r = app.recon, has = k => Access.has(user, k);
    switch (action) {
      case 'docs':
      case 'submit': return has('act.capture') && ['PENDING', 'RETURNED', 'DECLINED'].includes(st);
      case 'authorise':
      case 'reject': return has('act.authorise') && st === 'SUBMITTED' && Engine.inBranch(user, r.branchId) && r.submittedBy !== user.id;
      case 'reconcile':
      case 'decline': return has('act.reconcile') && st === 'REVIEW';
      case 'alert': return (has('act.capture') || has('act.authorise')) && st === 'DECLINED';
      default: return false;
    }
  },

  /* Items waiting for this user. */
  myActions(user = Store.user()) {
    return this.items().filter(a => {
      const st = this.status(a);
      if (st === 'SUBMITTED') return this.can('authorise', a, user);
      if (st === 'REVIEW') return this.can('reconcile', a, user);
      if (['RETURNED', 'DECLINED'].includes(st)) return this.can('submit', a, user) && Engine.inBranch(user, this.branchOf(a));
      return false;
    });
  },

  missingDocs(app) {
    const docs = app.recon.documents || [];
    return RECON_DOCS.filter(([code, , req]) => req && !docs.some(d => d.code === code)).map(([, label]) => label);
  },

  log(app, action, comment = '') {
    const u = Store.user();
    app.recon.history = app.recon.history || [];
    app.recon.history.push({ at: Store.now().toISOString(), by: u.id, name: u.name, role: u.role, action, comment });
  },

  /* Tell the branch that owns the application when another branch submits or authorises its documents. */
  tellOwner(app, step, comment) {
    const u = Store.user();
    if (!app.recon.branchId || app.recon.branchId === app.branchId) return;
    Engine.notify('RECON_BRANCH_INTERNAL', app, [{ branchId: app.branchId }], { step, actor: `${u.name} (${ROLES[u.role]}, ${UI.branchName(u.branchId)})`, handlingBranch: UI.branchName(app.recon.branchId), comment: comment || '' });
  },

  need(ok, msg) { if (!ok) throw new WorkflowError(typeof Periods !== 'undefined' && Periods.blocked() ? 'End of day has been run, so changes are blocked until the next business day.' : msg); },

  submit(app, comment) {
    this.need(this.can('submit', app), 'You cannot submit this reconciliation in its current status.');
    const missing = this.missingDocs(app);
    this.need(!missing.length, `Upload the mandatory document(s) first: ${missing.join(', ')}.`);
    const u = Store.user(), r = app.recon, at = Engine.inBranch(u, app.branchId) ? app.branchId : u.branchId;
    Object.assign(r, { status: 'SUBMITTED', branchId: at, submittedAt: Store.now().toISOString(), submittedBy: u.id });
    this.log(app, 'Submitted for review', comment);
    Engine.touch(app);
    Store.audit('RECON_SUBMITTED', app, `Reconciliation documents submitted (${r.documents.length} document(s)) to the authorisers of ${UI.branchName(at)}`);
    Engine.notify('RECON_SUBMITTED_INTERNAL', app, [{ role: 'AUTHORISER', branchId: at }], { comment: comment || '', submittedBy: u.name });
    this.tellOwner(app, 'Documents submitted for review', comment);
    Store.save();
  },

  authorise(app, comment) {
    this.need(this.can('authorise', app), 'You cannot authorise this reconciliation (own branch only, and not your own submission).');
    const u = Store.user(), r = app.recon;
    Object.assign(r, { status: 'REVIEW', reviewedAt: Store.now().toISOString(), reviewedBy: u.id });
    this.log(app, 'Authorised – sent to Exchange Control', comment);
    Engine.touch(app);
    Store.audit('RECON_AUTHORISED', app, 'Reconciliation documents authorised and sent to Exchange Control');
    Engine.notify('RECON_RECEIVED_CLIENT', app, ['client']);
    Engine.notify('RECON_REVIEW_INTERNAL', app, [{ role: 'EC' }], { comment: comment || '' });
    this.tellOwner(app, 'Documents authorised and sent to Exchange Control', comment);
    Store.save();
  },

  reject(app, comment) {
    this.need(this.can('reject', app), 'You cannot reject this reconciliation.');
    this.need(comment?.trim(), 'A comment is required when rejecting.');
    const r = app.recon;
    r.status = 'RETURNED';
    this.log(app, 'Rejected by authoriser – returned to inputter', comment);
    Engine.touch(app);
    Store.audit('RECON_RETURNED', app, `Reconciliation returned to inputter: ${comment}`);
    Engine.notify('RECON_RETURNED_INTERNAL', app, [{ userId: r.submittedBy }], { comment, inputterName: UI.userName(r.submittedBy) });
    Store.save();
  },

  reconcile(app, comment) {
    this.need(this.can('reconcile', app), 'Only Exchange Control can reconcile, after the authoriser has authorised.');
    const u = Store.user(), r = app.recon;
    Object.assign(r, { status: 'RECONCILED', reconciledAt: Store.now().toISOString(), by: u.id });
    (r.documents || []).forEach(d => { if (!app.documents.some(x => x.id === d.id)) app.documents.push(d); });
    this.log(app, 'Reconciled and closed', comment);
    Engine.touch(app);
    Engine.addComment(app, 'Reconciled', comment);
    Store.audit('RECONCILED', app, 'Advance payment reconciled and closed by Exchange Control');
    Engine.notify('RECONCILED_CLIENT', app, ['client']);
    // The owning branch is always told; so is the branch that submitted the documents, if different.
    const branches = [...new Set([app.branchId, r.branchId].filter(Boolean))].map(branchId => ({ branchId }));
    Engine.notify('RECONCILED_BRANCH_INTERNAL', app, branches, { comment: comment || '', actor: u.name, handlingBranch: UI.branchName(r.branchId || app.branchId) });
    Store.save();
  },

  decline(app, comment) {
    this.need(this.can('decline', app), 'Only Exchange Control can decline at this stage.');
    this.need(comment?.trim(), 'A comment is required when declining.');
    const u = Store.user(), r = app.recon;
    Object.assign(r, { status: 'DECLINED', declinedAt: Store.now().toISOString(), declinedBy: u.id, declineReason: comment });
    this.log(app, 'Declined by Exchange Control', comment);
    Engine.touch(app);
    Store.audit('RECON_DECLINED', app, `Reconciliation declined by Exchange Control: ${comment}`);
    const to = [...new Set([r.submittedBy, r.reviewedBy].filter(Boolean))].map(userId => ({ userId }));
    Engine.notify('RECON_DECLINED_INTERNAL', app, to.length ? to : [{ branchId: this.branchOf(app) }], { comment });
    Store.save();
  },

  alertClient(app, message) {
    this.need(this.can('alert', app), 'An alert can be sent only after Exchange Control has declined.');
    this.need(message?.trim(), 'Write the message to the client.');
    this.log(app, 'Client alerted of the decline', message);
    app.recon.alertedAt = Store.now().toISOString();
    Engine.touch(app);
    Store.audit('RECON_CLIENT_ALERTED', app, 'Client alerted that the reconciliation was declined');
    Engine.notify('RECON_DECLINED_CLIENT', app, ['client'], { comment: message });
    Store.save();
  },

  async addDocs(app, files, code) {
    this.need(this.can('docs', app), 'Documents can be added only while the reconciliation is with the inputter.');
    app.recon.documents = app.recon.documents || [];
    for (const f of files) app.recon.documents.push(await Form.storeFile(f, code));
    this.log(app, `Document(s) added: ${[...files].map(f => f.name).join(', ')}`);
    Engine.touch(app);
    Store.save();
  },

  removeDoc(app, id) {
    this.need(this.can('docs', app), 'Documents can be removed only while the reconciliation is with the inputter.');
    const d = app.recon.documents.find(x => x.id === id);
    app.recon.documents = app.recon.documents.filter(x => x.id !== id);
    this.log(app, `Document removed: ${d?.name || id}`);
    Engine.touch(app);
    Store.save();
  },

  /* ---------- search: account, ID number, phone, email, payment (SWIFT) reference, application reference ---------- */
  search(term) {
    const raw = String(term || '').trim();
    if (raw.length < 3) return [];
    return this.items().filter(a => this.matches(a, raw)).sort((x, y) => (x.recon.dueDate || '').localeCompare(y.recon.dueDate || ''));
  },

  matches(a, raw) {
    const q = raw.toLowerCase(), digits = raw.replace(/\D/g, ''), id = Engine.normId(raw), up = raw.toUpperCase().replace(/\s+/g, '');
    const c = a.customer || {};
    return (digits.length >= 6 && (Engine.normAccount(c.account).includes(digits) || Engine.customerNo(c) === digits ||String(c.phone || '').replace(/\D/g, '').endsWith(digits.slice(-9))))
      || (id.length >= 4 && Engine.normId(c.idNumber) === id)
      || (q.includes('@') && String(c.email || '').toLowerCase() === q)
      || String(a.ref || '').toUpperCase().includes(up) || String(a.formerRef || '').toUpperCase().includes(up)
      || (a.payments || []).some(p => String(p.reference || '').toUpperCase().replace(/\s+/g, '').includes(up))
      || String(c.name || '').toLowerCase().includes(q);
  },

  /* ---------- list (page and report) ---------- */
  filter: null,
  filterState() {
    const u = Store.user();
    if (!this.filter || this.filter.user !== u.id) this.filter = { user: u.id, branch: this.defaultBranch(u), status: this.myActions(u).length ? 'action' : 'open', when: '', q: '' };
    return this.filter;
  },

  rows(f) {
    const u = Store.user(), today = U.dayKey(Store.now());
    const mine = new Set(this.myActions(u).map(a => a.id));
    return this.items().filter(a => {
      const st = this.status(a);
      if (!this.extraMatch(f, a)) return false;
      if (f.status === 'action') return mine.has(a.id);   // my actions ignore the branch filter
      if (f.branch === 'mine' && !Engine.inBranch(u, a.branchId) && !Engine.inBranch(u, this.branchOf(a))) return false;
      if (f.branch && f.branch !== 'mine' && a.branchId !== f.branch && this.branchOf(a) !== f.branch) return false;
      if (f.status === 'open' && st === 'RECONCILED') return false;
      if (f.status && !['open', 'all', 'action'].includes(f.status) && st !== f.status) return false;
      if (f.when === 'overdue' && !(st !== 'RECONCILED' && a.recon.dueDate < today)) return false;
      if (f.when === 'soon' && !(st !== 'RECONCILED' && a.recon.dueDate >= today && U.daysBetween(today, a.recon.dueDate) <= 14)) return false;
      return true;
    }).sort((x, y) => (x.recon.dueDate || '').localeCompare(y.recon.dueDate || ''));
  },

  counts(f) {
    const base = Object.assign({}, f, { status: 'all', when: '' });
    const all = this.rows(base);
    const c = { action: this.myActions().length, all: all.length, open: all.filter(a => this.status(a) !== 'RECONCILED').length };
    Object.keys(RECON_STATUS).forEach(k => { c[k] = all.filter(a => this.status(a) === k).length; });
    return c;
  },

  /* Reconciled items have their own page / report tab (reconciledView); this list covers the open ones. */
  listHtml(f, rows, reconciledHref = '#/reconciled') {
    const c = this.counts(f), u = Store.user();
    const tabs = [['action', 'Needs my action'], ['open', 'Not reconciled'], ['PENDING', 'Awaiting documents'], ['RETURNED', 'Returned'], ['SUBMITTED', 'With authoriser'], ['REVIEW', 'With Exchange Control'], ['DECLINED', 'Declined']];
    const today = U.dayKey(Store.now());
    return `
      <div class="toolbar">
        <div class="pill-group" style="flex-wrap:wrap">${tabs.map(([k, l]) => `<button data-rs="${k}" class="${f.status === k ? 'on' : ''}">${l} (${c[k] ?? 0})</button>`).join('')}</div>
        <span class="grow"></span><a class="btn btn-sm" href="${reconciledHref}">Reconciled (${c.RECONCILED}) →</a>
      </div>
      <div class="toolbar">
        <select id="rc-branch" aria-label="Branch"><option value="mine" ${f.branch === 'mine' ? 'selected' : ''}>${U.esc(Engine.branchesLabel(u))}</option><option value="" ${!f.branch ? 'selected' : ''}>All branches</option>
          ${Store.state.branches.map(b => `<option value="${b.id}" ${f.branch === b.id ? 'selected' : ''}>${U.esc(b.code)} · ${U.esc(b.name)}</option>`).join('')}</select>
        <select id="rc-when" aria-label="Due"><option value="">Any due date</option><option value="overdue" ${f.when === 'overdue' ? 'selected' : ''}>Overdue</option><option value="soon" ${f.when === 'soon' ? 'selected' : ''}>Due within 14 days</option></select>
        ${this.extraHtml(f)}
        <span class="grow"></span><span class="muted">${rows.length} item(s)${f.status === 'action' ? ' · all branches' : ''}</span>${Export.button()}
      </div>
      <div class="card"><div class="card-b tight"><div class="table-wrap"><table>
        <thead><tr><th>Reference</th><th>Client</th><th>Branch</th><th class="num">Amount</th><th>Paid</th><th>Due</th><th>Status</th><th>Last step</th><th></th></tr></thead>
        <tbody>${rows.map(a => {
          const st = this.status(a), last = (a.recon.history || []).slice(-1)[0], od = st !== 'RECONCILED' && a.recon.dueDate < today;
          return `<tr><td class="mono">${U.esc(a.ref)}</td><td>${U.esc(a.customer.name)}<br><small class="mono">${U.esc(a.customer.account)}${Engine.customerNo(a.customer) ? ` · customer ${U.esc(Engine.customerNo(a.customer))}` : ''}</small></td><td>${U.esc(UI.branchName(a.branchId))}${a.recon.branchId && a.recon.branchId !== a.branchId ? `<br><small>docs at ${U.esc(UI.branchName(a.recon.branchId))}</small>` : ''}</td>
            <td class="num">${U.money(a.amount, a.currency)}</td><td class="nowrap">${U.fmtDate(a.closedAt)}</td>
            <td class="nowrap">${U.fmtDate(a.recon.dueDate)}${od ? `<br>${UI.tag(`${U.daysBetween(a.recon.dueDate, today)} days overdue`, 'red')}` : ''}</td>
            <td>${UI.tag(RECON_STATUS[st].label, RECON_STATUS[st].tone)}</td>
            <td><small>${last ? `${U.esc(last.action)}<br>${U.esc(last.name)} · ${U.fmtDate(last.at)}` : '—'}</small></td>
            <td><a class="btn btn-sm" href="#/recon/${a.id}">Open</a></td></tr>`;
        }).join('') || '<tr><td colspan="9" class="empty">Nothing here.</td></tr>'}</tbody>
      </table></div></div></div>`;
  },

  bindList(root, f, redraw) {
    root.querySelectorAll('[data-rs]').forEach(b => b.addEventListener('click', () => { f.status = b.dataset.rs; redraw(); }));
    root.querySelector('#rc-branch').addEventListener('change', e => { f.branch = e.target.value; redraw(); });
    root.querySelector('#rc-when').addEventListener('change', e => { f.when = e.target.value; redraw(); });
    this.bindExtra(root, f, redraw);
  },

  model(f, rows) {
    return {
      title: 'Advance payment reconciliation', subtitle: `${f.branch === 'mine' ? UI.branchName(Engine.workingBranch(Store.user())) : f.branch ? UI.branchName(f.branch) : 'All branches'} · ${f.status === 'action' ? 'needs my action' : f.status === 'open' ? 'not reconciled' : f.status === 'all' ? 'all' : RECON_STATUS[f.status]?.label || f.status}${f.when ? ` · ${f.when === 'overdue' ? 'overdue' : 'due within 14 days'}` : ''}${this.extraLabel(f)}`,
      filename: 'reconciliation',
      sections: [{ heading: 'Advance payments', columns: [{ label: 'Reference' }, { label: 'Client' }, { label: 'Account' }, { label: 'Branch' }, { label: 'Currency' }, { label: 'Amount', num: 2 }, { label: 'Paid' }, { label: 'Due' }, { label: 'Days overdue', num: 0 }, { label: 'Status' }, { label: 'Submitted' }, { label: 'Reconciled' }, { label: 'Documents', num: 0 }],
        rows: rows.map(a => { const st = this.status(a), od = st !== 'RECONCILED' ? Math.max(0, U.daysBetween(a.recon.dueDate, Store.now())) : 0;
          return [a.ref, a.customer.name, a.customer.account, UI.branchName(a.branchId), a.currency, a.amount, U.fmtDate(a.closedAt), U.fmtDate(a.recon.dueDate), od, RECON_STATUS[st].label, a.recon.submittedAt ? U.fmtDate(a.recon.submittedAt) : '', a.recon.reconciledAt ? U.fmtDate(a.recon.reconciledAt) : '', (a.recon.documents || []).length]; }) }],
    };
  },

  /* #/unreconciled – the Reconciliation page */
  page() {
    if (!Access.has(Store.user(), 'view.unreconciled')) { location.hash = '#/dashboard'; return; }
    const f = this.filterState();
    UI.setTitle('Reconciliation', 'Advance payments');
    const view = document.getElementById('view');
    const draw = () => {
      const results = this.search(f.q);
      const rows = this.rows(f);
      view.innerHTML = `
        <div class="card" style="margin-bottom:16px"><div class="card-h"><h2>Find a transaction</h2><small>All branches</small></div><div class="card-b">
          <input type="search" id="rc-q" value="${U.esc(f.q)}" placeholder="Customer account or customer number, ID number, phone, email, payment (SWIFT) reference or application reference" style="width:100%">
          ${f.q.trim().length >= 3 ? `<div class="table-wrap" style="margin-top:10px"><table><tbody>${results.map(a => `<tr><td class="mono">${U.esc(a.ref)}</td><td>${U.esc(a.customer.name)}<br><small class="mono">${U.esc(a.customer.account)} · ${U.esc(a.customer.phone || '')}</small></td><td>${U.money(a.amount, a.currency)}<br><small>${(a.payments || []).map(p => U.esc(p.reference)).join(', ')}</small></td><td>${U.esc(UI.branchName(a.branchId))}</td><td>${UI.tag(RECON_STATUS[this.status(a)].label, RECON_STATUS[this.status(a)].tone)}</td><td><a class="btn btn-sm btn-primary" href="#/recon/${a.id}">Open</a></td></tr>`).join('') || '<tr><td class="empty">No advance payment found. Only fully paid advance payments need reconciliation.</td></tr>'}</tbody></table></div>` : ''}
        </div></div>
        <div id="rc-list">${this.listHtml(f, rows)}</div>`;
      const q = view.querySelector('#rc-q');
      q.addEventListener('input', e => { f.q = e.target.value; draw(); const n = view.querySelector('#rc-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
      this.bindList(view, f, draw);
      Export.attach(view.querySelector('#rc-list'), () => this.model(f, rows));
    };
    draw();
  },

  /* Reports → Reconciliation */
  report() {
    const f = this.repFilter = this.repFilter || { user: Store.user().id, branch: this.defaultBranch(), status: 'open', when: '', q: '' };
    const root = U.$('#rep');
    const draw = () => {
      const rows = this.rows(f), c = this.counts(f);
      root.innerHTML = `<div class="kpis">
          <div class="kpi amber"><div class="v">${c.open}</div><div class="l">Not reconciled</div></div>
          <div class="kpi red"><div class="v">${this.rows(Object.assign({}, f, { status: 'open', when: 'overdue' })).length}</div><div class="l">Overdue</div></div>
          <div class="kpi violet"><div class="v">${c.SUBMITTED + c.REVIEW}</div><div class="l">Under review</div></div>
          <div class="kpi green"><div class="v">${c.RECONCILED}</div><div class="l">Reconciled</div></div></div>` + this.listHtml(f, rows);
      root.querySelector('a[href="#/reconciled"]')?.setAttribute('href', '#/reports/reconciled');
      this.bindList(root, f, draw);
      Export.attach(root, () => this.model(f, rows));
    };
    draw();
  },

  /* ---------- Reconciled advance payments: own page (#/reconciled) and Reports → Reconciled ---------- */
  recFilter: null,
  reconciledRows(f) {
    const u = Store.user(), q = f.q.trim();
    return this.items().filter(a => {
      if (this.status(a) !== 'RECONCILED' || !this.extraMatch(f, a)) return false;
      if (f.branch === 'mine' ? !Engine.inBranch(u, a.branchId) && !Engine.inBranch(u, this.branchOf(a)) : f.branch && a.branchId !== f.branch && this.branchOf(a) !== f.branch) return false;
      const on = U.dayKey(a.recon.reconciledAt);
      if (f.from && on < f.from) return false;
      if (f.to && on > f.to) return false;
      return q.length < 3 || this.matches(a, q);
    }).sort((x, y) => (y.recon.reconciledAt || '').localeCompare(x.recon.reconciledAt || ''));
  },

  reconciledView(root, backHref) {
    const u = Store.user();
    const f = this.recFilter = this.recFilter && this.recFilter.user === u.id ? this.recFilter : { user: u.id, branch: this.defaultBranch(u), from: '', to: '', q: '' };
    const e = U.esc;
    const draw = () => {
      const rows = this.reconciledRows(f);
      const late = rows.filter(a => U.dayKey(a.recon.reconciledAt) > a.recon.dueDate).length;
      const usd = U.sum(rows, a => Rules.toUSD(a.amount, a.currency));
      root.innerHTML = `
        <div class="kpis">
          <div class="kpi green"><div class="v">${rows.length}</div><div class="l">Reconciled</div></div>
          <div class="kpi"><div class="v">${U.num(usd, 0)}</div><div class="l">≈ USD reconciled</div></div>
          <div class="kpi amber"><div class="v">${late}</div><div class="l">Reconciled after the due date</div></div>
          <div class="kpi violet"><div class="v">${rows.filter(a => a.recon.branchId && a.recon.branchId !== a.branchId).length}</div><div class="l">Documents from another branch</div></div>
        </div>
        <div class="toolbar">
          <input type="search" id="rd-q" value="${e(f.q)}" placeholder="Account, ID, phone, email, SWIFT or application reference" style="min-width:300px">
          <select id="rd-branch" aria-label="Branch"><option value="mine" ${f.branch === 'mine' ? 'selected' : ''}>${e(Engine.branchesLabel(u))}</option><option value="" ${!f.branch ? 'selected' : ''}>All branches</option>
            ${Store.state.branches.map(b => `<option value="${b.id}" ${f.branch === b.id ? 'selected' : ''}>${e(b.code)} · ${e(b.name)}</option>`).join('')}</select>
          ${this.extraHtml(f)}
          <label>Reconciled from <input type="date" id="rd-from" value="${f.from}"></label><label>to <input type="date" id="rd-to" value="${f.to}"></label>
          <span class="grow"></span>${backHref ? `<a class="btn btn-sm" href="${backHref}">← Not yet reconciled</a>` : ''}${Export.button()}
        </div>
        <div class="card"><div class="card-b tight"><div class="table-wrap"><table>
          <thead><tr><th>Reference</th><th>Client</th><th>Branch</th><th class="num">Amount</th><th>Payment ref</th><th>Paid</th><th>Due</th><th>Reconciled</th><th>Submitted by</th><th>Authorised by</th><th>Exchange Control</th><th class="num">Docs</th><th></th></tr></thead>
          <tbody>${rows.map(a => { const r = a.recon, lateBy = U.daysBetween(r.dueDate, U.dayKey(r.reconciledAt));
            return `<tr><td class="mono">${e(a.ref)}</td><td>${e(a.customer.name)}<br><small class="mono">${e(a.customer.account)}</small></td>
              <td>${e(UI.branchName(a.branchId))}${r.branchId && r.branchId !== a.branchId ? `<br><small>docs at ${e(UI.branchName(r.branchId))}</small>` : ''}</td>
              <td class="num">${U.money(a.amount, a.currency)}</td><td class="mono">${(a.payments || []).map(p => e(p.reference)).join('<br>')}</td>
              <td class="nowrap">${U.fmtDate(a.closedAt)}</td><td class="nowrap">${U.fmtDate(r.dueDate)}</td>
              <td class="nowrap">${U.fmtDate(r.reconciledAt)}${lateBy > 0 ? `<br>${UI.tag(`${lateBy} days late`, 'amber')}` : ''}</td>
              <td>${e(r.submittedBy ? UI.userName(r.submittedBy) : '—')}</td><td>${e(r.reviewedBy ? UI.userName(r.reviewedBy) : '—')}</td><td>${e(UI.userName(r.by))}</td>
              <td class="num">${(r.documents || []).length}</td><td><a class="btn btn-sm" href="#/recon/${a.id}">Open</a></td></tr>`; }).join('') || '<tr><td colspan="13" class="empty">No reconciled advance payments for these filters.</td></tr>'}</tbody>
        </table></div></div></div>`;
      const q = root.querySelector('#rd-q');
      q.addEventListener('input', ev => { f.q = ev.target.value; draw(); const n = root.querySelector('#rd-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
      root.querySelector('#rd-branch').addEventListener('change', ev => { f.branch = ev.target.value; draw(); });
      root.querySelector('#rd-from').addEventListener('change', ev => { f.from = ev.target.value; draw(); });
      root.querySelector('#rd-to').addEventListener('change', ev => { f.to = ev.target.value; draw(); });
      this.bindExtra(root, f, draw);
      Export.attach(root, () => ({
        title: 'Reconciled advance payments',
        subtitle: `${f.branch === 'mine' ? UI.branchName(Engine.workingBranch(u)) : f.branch ? UI.branchName(f.branch) : 'All branches'}${f.from || f.to ? ` · reconciled ${f.from ? U.fmtDate(f.from) : '…'} – ${f.to ? U.fmtDate(f.to) : '…'}` : ''}${this.extraLabel(f)}`,
        filename: 'reconciled',
        sections: [{ heading: 'Reconciled', columns: [{ label: 'Reference' }, { label: 'Client' }, { label: 'Account' }, { label: 'Branch' }, { label: 'Documents at' }, { label: 'Currency' }, { label: 'Amount', num: 2 }, { label: 'Payment ref' }, { label: 'Paid' }, { label: 'Due' }, { label: 'Reconciled' }, { label: 'Days late', num: 0 }, { label: 'Submitted by' }, { label: 'Authorised by' }, { label: 'Exchange Control' }, { label: 'Documents', num: 0 }],
          rows: rows.map(a => { const r = a.recon; return [a.ref, a.customer.name, a.customer.account, UI.branchName(a.branchId), UI.branchName(r.branchId || a.branchId), a.currency, a.amount, (a.payments || []).map(p => p.reference).join(', '), U.fmtDate(a.closedAt), U.fmtDate(r.dueDate), U.fmtDate(r.reconciledAt), Math.max(0, U.daysBetween(r.dueDate, U.dayKey(r.reconciledAt))), r.submittedBy ? UI.userName(r.submittedBy) : '', r.reviewedBy ? UI.userName(r.reviewedBy) : '', UI.userName(r.by), (r.documents || []).length]; }) }],
      }));
    };
    draw();
  },

  reconciledPage() {
    if (!Access.has(Store.user(), 'view.unreconciled')) { location.hash = '#/dashboard'; return; }
    UI.setTitle('Reconciled', 'Advance payments');
    document.getElementById('view').innerHTML = '<div id="rd"></div>';
    this.reconciledView(U.$('#rd'), '#/unreconciled');
  },

  /* #/recon/<id> – one transaction */
  detail(id) {
    const app = Store.app(id);
    if (!app?.recon || !Access.has(Store.user(), 'view.unreconciled') || !this.visible(app)) { location.hash = '#/unreconciled'; return; }
    const r = app.recon, st = this.status(app), u = Store.user(), e = U.esc;
    r.documents = r.documents || [];
    UI.setTitle(`${app.ref} – reconciliation`, 'Reconciliation');
    const can = a => this.can(a, app);
    const canAny = ['docs', 'submit', 'authorise', 'reject', 'reconcile', 'decline', 'alert'].some(can);
    const today = U.dayKey(Store.now()), od = st !== 'RECONCILED' && r.dueDate < today;
    const box = (label, value) => `<div><small class="muted">${label}</small><div>${value}</div></div>`;
    const viewApp = Engine.can('view', app);
    document.getElementById('view').innerHTML = `
      <div class="cols">
        <div class="stack">
          <div class="card"><div class="card-h"><h2>${e(app.customer.name)}</h2>${UI.tag(RECON_STATUS[st].label, RECON_STATUS[st].tone)}</div><div class="card-b grid g3">
            ${box('Application', `<span class="mono">${e(app.ref)}</span>${viewApp ? ` · <a href="#/app/${app.id}">open</a>` : ''}`)}
            ${box('Account', `<span class="mono">${e(app.customer.account)}</span>`)}
            ${box('Branch', e(UI.branchName(app.branchId)))}
            ${box('Advance paid', `${U.money(Engine.totals(app).paid, app.currency)} on ${U.fmtDate(app.closedAt)}`)}
            ${box('Payment reference(s)', (app.payments || []).map(p => `<span class="mono">${e(p.reference)}</span>`).join(', ') || '—')}
            ${box('Beneficiary', `${e(app.beneficiary?.name || '')} · ${e(app.beneficiary?.country || '')}`)}
            ${box('Reconciliation due', `${U.fmtDate(r.dueDate)} ${od ? UI.tag(`${U.daysBetween(r.dueDate, today)} days overdue`, 'red') : ''}`)}
            ${box('Contact', `${e(app.customer.phone || '')}${app.customer.email ? ` · ${e(app.customer.email)}` : ''}`)}
            ${box('ID', `${e(ID_TYPE_LABELS[app.customer.idType] || '')} <span class="mono">${e(app.customer.idNumber || '')}</span>`)}
          </div></div>
          ${st === 'DECLINED' ? `<div class="alert error"><div><b>Declined by Exchange Control</b> (${e(UI.userName(r.declinedBy))}, ${U.fmtDateTime(r.declinedAt)}): ${e(r.declineReason || '')}${r.alertedAt ? `<br><small>Client alerted ${U.fmtDateTime(r.alertedAt)}</small>` : ''}</div></div>` : ''}
          <div class="card"><div class="card-h"><h2>Reconciliation documents</h2><small>${can('docs') ? 'Customs entry and final invoice are mandatory' : ''}</small></div><div class="card-b">
            ${RECON_DOCS.map(([code, label, req]) => {
              const files = r.documents.filter(d => d.code === code);
              return `<div class="doc-slot ${req && !files.length && can('docs') ? 'missing' : ''}"><div class="head"><b>${e(label)}</b><span class="btn-row">${UI.tag(req ? 'Required' : 'Optional', req ? 'red' : 'grey')}${can('docs') ? `<label class="btn btn-sm upload-btn">⇪ Upload<input type="file" data-up="${code}" multiple accept=".pdf,image/*,.doc,.docx,.xls,.xlsx"></label>` : ''}</span></div>
                <div class="files">${files.map(f => `<div class="file"><span>📄</span><span class="name">${e(f.name)}</span><small>${U.fileSize(f.size)}</small>${DocView.buttons(f)}${can('docs') ? `<button type="button" class="btn-sm btn-danger" data-rm="${f.id}" aria-label="Remove ${e(f.name)}">✕</button>` : ''}</div>`).join('') || '<small class="muted">None</small>'}</div></div>`;
            }).join('')}
          </div></div>
          <div class="card"><div class="card-h"><h2>History</h2></div><div class="card-b"><ul class="timeline">${[...(r.history || [])].reverse().map(h => `<li><div class="what">${e(h.action)}</div><div class="meta">${e(h.name)} · ${e(ROLES[h.role] || '')} · ${U.fmtDateTime(h.at)}</div>${h.comment ? `<div class="txt">${e(h.comment)}</div>` : ''}</li>`).join('') || '<li class="muted">No steps yet.</li>'}</ul></div></div>
        </div>
        <div class="side">
          <div class="card"><div class="card-h"><h2>Actions</h2><small>${e(ROLES[u.role])}</small></div><div class="card-b">
            ${canAny ? `<label class="f" style="margin-bottom:10px"><span>Comment ${can('reject') || can('decline') ? '(required to reject / decline)' : '(optional)'}</span><textarea id="rc-comment" rows="3"></textarea></label>` : ''}
            <div style="display:flex;flex-direction:column;gap:8px">
              ${can('submit') ? `<button class="btn-primary" data-do="submit" style="justify-content:center">Submit to authoriser</button>${this.missingDocs(app).length ? `<div class="alert warn">Upload first: ${e(this.missingDocs(app).join(', '))}</div>` : ''}` : ''}
              ${can('authorise') ? '<button class="btn-success" data-do="authorise" style="justify-content:center">✓ Authorise – send to Exchange Control</button><button class="btn-danger" data-do="reject" style="justify-content:center">✕ Reject – return to inputter</button>' : ''}
              ${can('reconcile') ? '<button class="btn-success" data-do="reconcile" style="justify-content:center">✓ Mark reconciled & close</button><button class="btn-danger" data-do="decline" style="justify-content:center">✕ Decline</button>' : ''}
              ${can('alert') ? '<button data-do="alert" style="justify-content:center">✉ Send alert to client</button>' : ''}
              ${!canAny ? `<div class="muted">${u.role === 'TREASURY' ? 'View only.' : st === 'SUBMITTED' && r.submittedBy === u.id ? 'You submitted this, so another authoriser must review it.' : st === 'SUBMITTED' ? `Waiting for an authoriser at ${e(UI.branchName(r.branchId))}.` : st === 'REVIEW' ? 'Waiting for Exchange Control.' : st === 'RECONCILED' ? 'Reconciled and closed.' : 'No action for your role at this stage.'}</div>` : ''}
            </div>
            <div class="alert info" style="margin-top:12px"><div><small>The client is notified only when the authoriser authorises (documents received) and when Exchange Control reconciles (closed). After a decline, the inputter or authoriser can alert the client. Any branch can handle it; the owning branch is told when another branch submits or authorises, and always when it is reconciled.</small></div></div>
          </div></div>
          <a class="btn" href="#/unreconciled" style="justify-content:center">← Back to Reconciliation</a>
        </div>
      </div>`;
    const refresh = () => this.detail(id);
    U.$$('#view [data-up]').forEach(inp => inp.addEventListener('change', async () => { try { await this.addDocs(app, inp.files, inp.dataset.up); } catch (err) { UI.error(err); } refresh(); }));
    U.$$('#view [data-rm]').forEach(b => b.addEventListener('click', () => { try { this.removeDoc(app, b.dataset.rm); } catch (err) { UI.error(err); } refresh(); }));
    DocView.bind(U.$('#view'), r.documents);
    U.$$('#view [data-do]').forEach(b => b.addEventListener('click', async () => {
      const comment = U.$('#rc-comment')?.value || '';
      try {
        if (b.dataset.do === 'alert') return this.alertModal(app);
        const msg = { submit: 'Submitted to the authoriser.', authorise: 'Authorised. The client has been told the documents are under review; Exchange Control notified.', reject: 'Returned to the inputter.', reconcile: 'Reconciled and closed. The client has been notified.', decline: 'Declined. The inputter and authoriser have been notified.' }[b.dataset.do];
        if (b.dataset.do === 'reconcile' && !await UI.confirm('Mark as reconciled?', `<p>Advance payment <b>${e(app.ref)}</b> will be closed as reconciled and the client notified.</p>`, 'Reconcile', 'btn-success')) return;
        this[b.dataset.do](app, comment);
        UI.toast(msg, 'ok');
        App.renderChrome();
        refresh();
      } catch (err) { UI.error(err); }
    }));
  },

  alertModal(app) {
    const r = app.recon;
    UI.modal({
      title: `Alert client – ${app.ref}`,
      body: `<p>${U.esc(app.customer.name)} will receive this by ${app.customer.email ? 'email' : 'SMS'}, using the template "Reconciliation – declined".</p>
        <label class="f"><span>Message to the client</span><textarea name="message" rows="5">The documents are not sufficient to reconcile this payment: ${U.esc(r.declineReason || '')}</textarea></label>`,
      actions: [{ label: 'Send alert', onClick: el => {
        try { this.alertClient(app, UI.formData(el).message); } catch (err) { UI.error(err); return false; }
        UI.toast('Alert sent to the client.', 'ok');
        this.detail(app.id);
      } }],
    });
  },
};

/* ---------- hooks ---------- */
(() => {
  Views.unreconciledPage = () => Recon.page();
  // The branch rule above applies everywhere an application can be seen: lists, reports, search and its own page.
  const baseCan = Engine.can.bind(Engine);
  Engine.can = function (action, app, user = Store.user()) {
    if (action === 'view' && app && !Recon.visible(app, user)) return false;
    return baseCan(action, app, user);
  };
  // Classic dashboard card: only the items this user may see.
  Views.unreconciledCard = function (limit = 10) {
    const items = Engine.unreconciled().filter(a => Recon.visible(a)), today = U.dayKey(Store.now());
    const overdue = items.filter(a => a.recon.dueDate < today), usd = U.sum(items, a => Rules.toUSD(a.amount, a.currency));
    const scope = Access.has(Store.user(), 'view.reconAllBranches') ? 'all branches' : 'my branch · overdue from all branches';
    return `<div class="card">
      <div class="card-h"><h2>Unreconciled items <small class="muted">· ${scope}</small></h2><a href="#/unreconciled">View all →</a></div>
      <div class="card-b" style="padding-bottom:0"><div class="kpis" style="margin-bottom:12px">
        <a class="kpi ${items.length ? 'amber' : ''}" href="#/unreconciled"><div class="v">${items.length}</div><div class="l">Unreconciled advance payments</div></a>
        <a class="kpi ${overdue.length ? 'red' : ''}" href="#/unreconciled/overdue"><div class="v">${overdue.length}</div><div class="l">Overdue</div></a>
        <div class="kpi"><div class="v">${U.num(usd, 0)}</div><div class="l">Value ≈ USD</div></div>
      </div></div>
      <div class="card-b tight">${Views.reconTable(items.slice(0, limit))}</div>
    </div>`;
  };
  App.routes.push([/^#\/recon\/(\w+)$/, id => Recon.detail(id)]);
  App.routes.push([/^#\/reconciled$/, () => Recon.reconciledPage()]);
  Reports.tabs.push(['reconciliation', 'Reconciliation'], ['reconciled', 'Reconciled']);
  Reports.reconciliation = () => Recon.report();
  Reports.reconciled = () => Recon.reconciledView(U.$('#rep'), '#/reports/reconciliation');
  // The application page's reconciliation button opens the workflow page.
  Actions.reconcile = app => { location.hash = `#/recon/${app.id}`; };
  const baseButtons = Views.actionButtons.bind(Views);
  Views.actionButtons = function (app) {
    let html = baseButtons(app);
    if (app.recon && !Engine.can('reconcile', app)) html = html.replace('<div style="display:flex;flex-direction:column;gap:8px">', `<div style="display:flex;flex-direction:column;gap:8px"><a class="btn" href="#/recon/${app.id}" style="width:100%;justify-content:center">Reconciliation – ${U.esc(RECON_STATUS[Recon.status(app)].label)}</a>`);
    return html;
  };
  // Menu: "Reconciliation", with the number of items waiting for this user.
  const baseChrome = App.renderChrome.bind(App);
  App.renderChrome = function () {
    baseChrome();
    const a = document.querySelector('#nav a[href="#/unreconciled"]');
    if (!a) return;
    a.classList.toggle('active', location.hash.startsWith('#/unreconciled') || location.hash.startsWith('#/recon/'));
    const mine = Recon.myActions().length;
    a.querySelector('span').textContent = 'Reconciliation';
    const count = a.querySelector('.count');
    if (count && mine) { count.textContent = mine; count.style.background = 'var(--red)'; count.title = 'Waiting for you'; }
    else if (count) {   // the number of items this user may see
      const vis = Engine.unreconciled().filter(x => Recon.visible(x));
      count.textContent = vis.length;
      count.style.background = vis.some(x => x.recon.dueDate < U.dayKey(Store.now())) ? 'var(--red)' : '';
    }
    // "Reconciled" – its own menu item, under Reconciliation.
    const done = Recon.items().filter(x => Recon.status(x) === 'RECONCILED').length;
    a.insertAdjacentHTML('afterend', `<a href="#/reconciled" class="${location.hash === '#/reconciled' ? 'active' : ''}"><span>Reconciled</span><span class="count">${done}</span></a>`);
  };
  const baseLabel = Views.actionLabel.bind(Views);
  Views.actionLabel = x => ({ RECON_SUBMITTED: 'Reconciliation submitted', RECON_AUTHORISED: 'Reconciliation authorised', RECON_RETURNED: 'Reconciliation returned', RECON_DECLINED: 'Reconciliation declined', RECON_CLIENT_ALERTED: 'Client alerted (reconciliation)' })[x] || baseLabel(x);
})();
