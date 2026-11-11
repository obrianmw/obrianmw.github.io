'use strict';

/* Users not used for 30 days are disabled until an administrator activates them (the servers do this at sign-in and
   start-up; the browser-only prototype does it here, at sign-in). The Users list shows why and offers "Activate".

   Four-eyes approval of new users. While there are two or more active administrators, a new user is saved as
   awaiting approval and cannot sign in; another administrator – never the one who created the user – approves or
   rejects them (Administration → Users). With a single administrator new users are active at once. The servers
   enforce the same rule (server\db.py / Db.java).

   Four eyes on amendments: with two or more administrators, a change to an existing user's name, email, username,
   role or branches, and any change to access rights, is saved as a change awaiting approval and applied only when
   another administrator approves it. Nobody approves their own request. An administrator cannot ask for a change to
   their own details or rights, nor approve one – unless there are only two administrators, when the other one asks
   and they approve. Unlocking, setting or resetting a password, activating and deactivating users need no approval. */

const Approvals = {
  admins(S = Store.state) { return S.users.filter(u => u.role === 'ADMIN' && u.active !== false && u.pendingApproval !== true); },
  needed(S = Store.state) { return this.admins(S).length >= 2; },
  pendingUsers(S = Store.state) { return S.users.filter(u => u.pendingApproval === true && u.active !== false && !u.rejected); },

  INACTIVE_DAYS: 30,

  /* The prototype (no server): users with no sign-in, creation, approval or reactivation in the last 30 days are
     disabled. The last active administrator never is. Live and Universal leave this to the server. */
  sweepInactive(S = Store.state) {
    if (typeof Live !== 'undefined') return 0;
    const cutoff = Store.now().getTime() - this.INACTIVE_DAYS * 86400000;
    let admins = this.admins(S).length, n = 0;
    S.users.forEach(u => {
      if (u.active === false || u.pendingApproval === true) return;
      const marks = [u.lastLoginAt, u.reactivatedAt, u.approvedAt, u.createdAt].filter(Boolean).map(x => new Date(x).getTime()).filter(x => !isNaN(x));
      if (!marks.length || Math.max(...marks) >= cutoff) return;
      if (u.role === 'ADMIN') { if (admins <= 1) return; admins--; }
      Object.assign(u, { active: false, disabledReason: 'INACTIVE', disabledAt: Store.now().toISOString() });
      Store.audit('USER_DISABLED_INACTIVE', null, `${u.name} (${u.username}) disabled after ${this.INACTIVE_DAYS} days without signing in; an administrator must activate the account`, null, typeof AUTH_ACTOR !== 'undefined' ? AUTH_ACTOR : null);
      n++;
    });
    if (n) Store.save();
    return n;
  },

  /* An administrator activates a user disabled for not signing in; the 30 days count again from now. */
  activate(u) {
    Object.assign(u, { active: true, reactivatedAt: Store.now().toISOString() });
    delete u.disabledReason; delete u.disabledAt;
    Store.audit('USER_REACTIVATED', null, `${u.name} (${u.username}) activated again`);
    Store.save();
  },

  /* ---------- four eyes on amendments ---------- */
  CONTROLLED: ['name', 'email', 'username', 'role', 'branchId', 'extraBranchIds'],
  FIELD_LABEL: { name: 'Name', email: 'Email', username: 'Username', role: 'Role', branchId: 'Branch', extraBranchIds: 'Further branches' },
  fieldKey(k, v) { return k === 'extraBranchIds' ? JSON.stringify((Array.isArray(v) ? v.filter(Boolean).map(String) : []).sort()) : String(v ?? ''); },
  fieldText(k, v) {
    if (k === 'role') return ROLES[v] || v || '–';
    if (k === 'branchId') return UI.branchName(v) || '–';
    if (k === 'extraBranchIds') return (v || []).map(b => UI.branchName(b)).join(', ') || 'none';
    return String(v ?? '') || '–';
  },
  pendingChanges(S = Store.state) { return S.users.filter(u => u.pendingChange && u.pendingApproval !== true && !u.rejected); },
  accessPending(S = Store.state) { return S.access?.pending || null; },
  waiting(S = Store.state) { return this.pendingUsers(S).length + this.pendingChanges(S).length + (this.accessPending(S) ? 1 : 0); },

  // Why this administrator may not approve: they asked for it, or it is about them (allowed with only two administrators).
  approveBlock(me, byId, targetIds) {
    if (byId === me.id) return 'You asked for this change, so another administrator must approve it.';
    if (targetIds.includes(me.id) && this.admins().length > 2) return 'This change is to your own details or rights, so another administrator must approve it.';
    return '';
  },

  /* Saving a user: the controlled fields wait for approval; status and the rest apply at once. True when a change was
     saved as awaiting approval. */
  proposeUserChange(u, d) {
    if (!this.needed() || u.pendingApproval === true) return false;
    const keys = this.CONTROLLED.filter(k => k in d && this.fieldKey(k, u[k]) !== this.fieldKey(k, d[k]));
    if (!keys.length) return false;
    const me = Store.user();
    if (u.id === me.id) throw new WorkflowError('Another administrator must change your own details, role or branches.');
    if (u.pendingChange && u.pendingChange.by !== me.id) throw new WorkflowError(`A change to ${u.name} asked for by ${u.pendingChange.byName} is awaiting approval. It must be approved or rejected first.`);
    const fields = {}, lines = keys.map(k => ({ field: this.FIELD_LABEL[k], from: this.fieldText(k, u[k]), to: this.fieldText(k, d[k]) }));
    keys.forEach(k => { fields[k] = U.clone(d[k]); });
    const rest = Object.assign({}, d);
    this.CONTROLLED.forEach(k => delete rest[k]);
    Object.assign(u, rest);
    u.pendingChange = { by: me.id, byName: me.name, at: Store.now().toISOString(), fields, lines };
    Store.audit('USER_CHANGE_REQUESTED', null, `Change to ${u.name} (${u.username}) asked for: ${lines.map(l => `${l.field} ${l.from} → ${l.to}`).join('; ')}`, lines);
    return true;
  },

  approveUserChange(u) {
    const me = Store.user(), p = u.pendingChange, why = this.approveBlock(me, p.by, [u.id]);
    if (why) throw new WorkflowError(why);
    Object.assign(u, U.clone(p.fields), { changeApprovedBy: me.id, changeApprovedAt: Store.now().toISOString() });
    delete u.pendingChange;
    Store.audit('USER_CHANGE_APPROVED', null, `Change to ${u.name} (${u.username}) approved; asked for by ${p.byName}: ${(p.lines || []).map(l => `${l.field} ${l.from} → ${l.to}`).join('; ')}`, p.lines);
    Store.save();
  },

  rejectUserChange(u, reason) {
    const me = Store.user(), p = u.pendingChange, own = p.by === me.id;
    if (!own) { const why = this.approveBlock(me, p.by, [u.id]); if (why) throw new WorkflowError(why.replace('approve', 'decide on')); }
    if (!own && !reason?.trim()) throw new WorkflowError('Give the reason for rejecting.');
    delete u.pendingChange;
    Store.audit('USER_CHANGE_REJECTED', null, `Change to ${u.name} (${u.username}) asked for by ${p.byName} ${own ? 'withdrawn' : `rejected: ${reason}`}`, p.lines);
    Store.save();
  },

  // Access rights: whose own rights a change touches.
  rightsAffect(before, after) {
    const a = before.users || {}, b = after.users || {};
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(id => JSON.stringify(a[id] || {}) !== JSON.stringify(b[id] || {}));
  },

  proposeAccess(after, changes) {
    const me = Store.user(), cur = Store.state.access || { roles: {}, users: {} };
    const affects = this.rightsAffect(cur, after);
    if (affects.includes(me.id)) throw new WorkflowError('Another administrator must change your own rights.');
    if (cur.pending && cur.pending.by !== me.id) throw new WorkflowError(`An access-rights change asked for by ${cur.pending.byName} is awaiting approval. It must be approved or rejected first.`);
    Store.state.access = Object.assign(U.clone(cur), { pending: { by: me.id, byName: me.name, at: Store.now().toISOString(), data: U.clone(after), changes, affects } });
    Store.audit('ACCESS_CHANGE_REQUESTED', null, `Access rights change asked for (${changes.length} change${changes.length === 1 ? '' : 's'})`, changes);
  },

  approveAccess() {
    const me = Store.user(), p = this.accessPending(), why = this.approveBlock(me, p.by, p.affects || []);
    if (why) throw new WorkflowError(why);
    Store.state.access = { roles: U.clone(p.data.roles || {}), users: U.clone(p.data.users || {}) };
    Store.audit('ACCESS_UPDATED', null, `Access rights changed (${(p.changes || []).length} change${(p.changes || []).length === 1 ? '' : 's'}); asked for by ${p.byName}, approved by ${me.name}`, p.changes);
    Store.save();
  },

  rejectAccess(reason) {
    const me = Store.user(), p = this.accessPending(), own = p.by === me.id;
    if (!own) { const why = this.approveBlock(me, p.by, p.affects || []); if (why) throw new WorkflowError(why.replace('approve', 'decide on')); }
    if (!own && !reason?.trim()) throw new WorkflowError('Give the reason for rejecting.');
    const a = U.clone(Store.state.access); delete a.pending;
    Store.state.access = a;
    Store.audit('ACCESS_CHANGE_REJECTED', null, `Access rights change asked for by ${p.byName} ${own ? 'withdrawn' : `rejected: ${reason}`}`, p.changes);
    Store.save();
  },

  // Approve / reject / withdraw buttons for a change, or why this administrator cannot decide on it.
  decideButtons(me, p, targetIds, attr) {
    if (p.by === me.id) return `<button class="btn-sm btn-danger" ${attr}-no>Withdraw</button>`;
    const why = this.approveBlock(me, p.by, targetIds);
    return why ? `<small class="muted">${U.esc(why)}</small>` : `<button class="btn-sm btn-success" ${attr}-ok>Approve</button><button class="btn-sm btn-danger" ${attr}-no>Reject</button>`;
  },

  reasonModal(title, own, run) {
    UI.modal({ title, body: `<label class="f"><span>Reason ${own ? '(optional)' : '<b class="req">*</b>'}</span><input name="reason"></label>`,
      actions: [{ label: own ? 'Withdraw' : 'Reject', cls: 'btn-danger', onClick: el => { try { run(UI.formData(el).reason); } catch (e) { UI.error(e); return false; } App.render(); } }] });
  },

  approveUser(u) {
    const me = Store.user();
    if (u.createdBy === me.id && this.needed()) throw new WorkflowError('You created this user, so another administrator must approve them.');
    Object.assign(u, { pendingApproval: false, approvedBy: me.id, approvedByName: me.name, approvedAt: Store.now().toISOString() });
    Store.audit('USER_APPROVED', null, `${u.name} (${u.username}) – ${ROLES[u.role]}, ${UI.branchName(u.branchId)} approved; created by ${u.createdByName || UI.userName(u.createdBy)}`);
    Store.save();
  },

  rejectUser(u, reason) {
    const me = Store.user(), own = u.createdBy === me.id;
    if (!own && !reason?.trim()) throw new WorkflowError('Give the reason for rejecting.');
    Object.assign(u, { active: false, rejected: true, rejectedBy: me.id, rejectedAt: Store.now().toISOString(), rejectReason: reason || 'Withdrawn by the administrator who created the user' });
    Store.audit('USER_REJECTED', null, `${u.name} (${u.username}) ${own ? 'withdrawn by the administrator who created the user' : `rejected: ${reason}`}`);
    Store.save();
  },
};

(() => {
  // Users: "awaiting approval" and the approve / reject buttons (not for the administrator who created the user).
  const baseUsers = Admin.users.bind(Admin);
  Admin.users = function () {
    baseUsers();
    const S = Store.state, me = Store.user(), pend = Approvals.pendingUsers();
    if (pend.length) U.$('#adm').insertAdjacentHTML('afterbegin', `<div class="alert warn" style="margin-bottom:12px"><div><b>${pend.length} new user(s) awaiting approval.</b> They cannot sign in until another administrator approves them.</div></div>`);
    S.users.forEach(u => {
      const tr = U.$(`#adm [data-u="${u.id}"]`)?.closest('tr');
      if (!tr) return;
      const cell = tr.children[4];
      if (u.rejected) { cell.innerHTML = `${UI.tag('Rejected', 'red')}<br><small>${U.esc(u.rejectReason || '')}</small>`; return; }
      if (u.active === false && u.disabledReason === 'INACTIVE') {
        cell.innerHTML = `${UI.tag(`Disabled – not used for ${Approvals.INACTIVE_DAYS} days`, 'amber')}<br><small>since ${U.fmtDate(u.disabledAt)}</small>`;
        tr.lastElementChild.querySelector('.btn-row')?.insertAdjacentHTML('afterbegin', `<button class="btn-sm btn-success" data-uact="${u.id}">Activate</button>`);
        return;
      }
      if (u.pendingApproval !== true) return;
      const own = u.createdBy === me.id && Approvals.needed();
      cell.innerHTML = `${UI.tag('Awaiting approval', 'amber')}<br><small>created by ${U.esc(u.createdByName || UI.userName(u.createdBy) || '')}</small>`;
      tr.lastElementChild.querySelector('.btn-row')?.insertAdjacentHTML('afterbegin', own ? `<button class="btn-sm btn-danger" data-ur="${u.id}">Withdraw</button>` : `<button class="btn-sm btn-success" data-ua="${u.id}">Approve</button><button class="btn-sm btn-danger" data-ur="${u.id}">Reject</button>`);
    });
    Approvals.pendingChanges().forEach(u => {
      const tr = U.$(`#adm [data-u="${u.id}"]`)?.closest('tr');
      if (!tr) return;
      const p = u.pendingChange;
      tr.children[4].insertAdjacentHTML('beforeend', `<div style="margin-top:4px">${UI.tag('Change awaiting approval', 'amber')}<br><small>${(p.lines || []).map(l => `${U.esc(l.field)}: ${U.esc(l.from)} → <b>${U.esc(l.to)}</b>`).join('<br>')}<br>asked for by ${U.esc(p.byName)}, ${U.fmtDateTime(p.at)}</small></div>`);
      tr.lastElementChild.querySelector('.btn-row')?.insertAdjacentHTML('afterbegin', Approvals.decideButtons(me, p, [u.id], `data-uc="${u.id}" data-uc`));
    });
    const nCh = Approvals.pendingChanges().length, acc = Approvals.accessPending();
    if (nCh || acc) U.$('#adm').insertAdjacentHTML('afterbegin', `<div class="alert warn" style="margin-bottom:12px"><div>${nCh ? `<b>${nCh} change(s) to users awaiting approval</b> by another administrator. They apply only once approved.` : ''}${acc ? `${nCh ? '<br>' : ''}<b>An access-rights change is awaiting approval</b> (asked for by ${U.esc(acc.byName)}) – <a href="#/admin/access">Administration → Access rights</a>.` : ''}</div></div>`);
    U.$$('#adm [data-uc-ok]').forEach(b => b.addEventListener('click', () => {
      try { Approvals.approveUserChange(S.users.find(x => x.id === b.getAttribute('data-uc'))); UI.toast('Change approved and applied.', 'ok'); } catch (e) { UI.error(e); }
      App.render();
    }));
    U.$$('#adm [data-uc-no]').forEach(b => b.addEventListener('click', () => {
      const u = S.users.find(x => x.id === b.getAttribute('data-uc')), own = u.pendingChange.by === me.id;
      Approvals.reasonModal(`${own ? 'Withdraw' : 'Reject'} the change to ${u.name}`, own, reason => Approvals.rejectUserChange(u, reason));
    }));
    const dormant = S.users.filter(u => u.active === false && u.disabledReason === 'INACTIVE').length;
    if (dormant) U.$('#adm').insertAdjacentHTML('afterbegin', `<div class="alert info" style="margin-bottom:12px"><div><b>${dormant} user(s) disabled</b> after ${Approvals.INACTIVE_DAYS} days without signing in. They cannot sign in until an administrator activates them.</div></div>`);
    U.$$('#adm [data-uact]').forEach(b => b.addEventListener('click', () => {
      Approvals.activate(S.users.find(x => x.id === b.dataset.uact));
      UI.toast('Activated. The user can sign in again.', 'ok');
      App.render();
    }));
    U.$$('#adm [data-ua]').forEach(b => b.addEventListener('click', () => {
      try { Approvals.approveUser(S.users.find(x => x.id === b.dataset.ua)); UI.toast('Approved. The user can now sign in with the temporary password.', 'ok'); } catch (e) { UI.error(e); }
      App.render();
    }));
    U.$$('#adm [data-ur]').forEach(b => b.addEventListener('click', () => {
      const u = S.users.find(x => x.id === b.dataset.ur), own = u.createdBy === me.id;
      UI.modal({ title: `${own ? 'Withdraw' : 'Reject'} ${u.name}`, body: `<p>${U.esc(u.name)} will not be able to sign in. The record is kept, inactive, for the audit trail.</p><label class="f"><span>Reason ${own ? '(optional)' : '<b class="req">*</b>'}</span><input name="reason"></label>`,
        actions: [{ label: own ? 'Withdraw' : 'Reject', cls: 'btn-danger', onClick: el => { try { Approvals.rejectUser(u, UI.formData(el).reason); } catch (e) { UI.error(e); return false; } App.render(); } }] });
    }));
  };

  // Menu: new users waiting for an administrator's approval.
  const baseChrome = App.renderChrome.bind(App);
  App.renderChrome = function () {
    baseChrome();
    if (Store.user()?.role !== 'ADMIN') return;
    const n = Approvals.waiting(), a = document.querySelector('#nav a[href="#/admin/users"]');
    if (a && n) a.insertAdjacentHTML('beforeend', `<span class="count" style="background:var(--red)" title="Waiting for approval">${n}</span>`);
  };

  const baseAccessSave = Access.save.bind(Access);
  Access.save = function () {
    if (!Approvals.needed()) return baseAccessSave();
    const before = this.clean(this.state()), after = this.clean(this.draft), changes = this.describe(before, after);
    try { Approvals.proposeAccess(after, changes); } catch (e) { UI.error(e); return; }
    Store.save();
    this.draft = null;
    UI.toast(`Saved as a change awaiting another administrator's approval (${changes.length} change${changes.length === 1 ? '' : 's'}).`, 'ok');
    App.renderChrome();
    this.render();
  };
  const baseAccessRender = Access.render.bind(Access);
  Access.render = function () {
    baseAccessRender();
    const p = Approvals.accessPending(), me = Store.user(), box = U.$('#adm');
    if (!p || !box) return;
    const lines = p.changes || [];
    box.insertAdjacentHTML('afterbegin', `<div class="card" style="margin-bottom:12px;border-color:var(--amber, #d97706)"><div class="card-h"><h2>Change awaiting approval</h2>
        <span class="btn-row">${Approvals.decideButtons(me, p, p.affects || [], 'data-acc')}</span></div>
      <div class="card-b"><p style="margin:0 0 8px">Asked for by <b>${U.esc(p.byName)}</b>, ${U.fmtDateTime(p.at)}. It applies only when another administrator approves it; the rights below are the ones in force now.</p>
        <div class="table-wrap"><table><thead><tr><th>Right</th><th>Now</th><th>After approval</th></tr></thead><tbody>${lines.map(l => `<tr><td>${U.esc(l.field)}</td><td>${U.esc(l.from)}</td><td><b>${U.esc(l.to)}</b></td></tr>`).join('') || '<tr><td colspan="3" class="muted">No differences.</td></tr>'}</tbody></table></div></div></div>`);
    box.querySelector('[data-acc-ok]')?.addEventListener('click', () => {
      try { Approvals.approveAccess(); this.draft = null; UI.toast('Access rights change approved and applied.', 'ok'); } catch (e) { UI.error(e); }
      App.renderChrome(); this.render();
    });
    box.querySelector('[data-acc-no]')?.addEventListener('click', () => Approvals.reasonModal(p.by === me.id ? 'Withdraw the access-rights change' : 'Reject the access-rights change', p.by === me.id, reason => { Approvals.rejectAccess(reason); this.draft = null; }));
  };

  const baseLabel = Views.actionLabel.bind(Views);
  Views.actionLabel = x => ({ USER_APPROVED: 'User approved', USER_REJECTED: 'User rejected', USER_CHANGE_REQUESTED: 'User change asked for', USER_CHANGE_APPROVED: 'User change approved',
    USER_CHANGE_REJECTED: 'User change rejected', ACCESS_CHANGE_REQUESTED: 'Access rights change asked for', ACCESS_CHANGE_REJECTED: 'Access rights change rejected', USER_DISABLED_INACTIVE: 'User disabled – not used for 30 days', USER_REACTIVATED: 'User activated again' })[x] || baseLabel(x);
})();
