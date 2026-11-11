'use strict';

/* Access rights: which roles and individual users may use which views, reports and actions.
   The defaults reproduce the bank's standard set-up. Administration → Access rights changes them, per role and
   per user. Saved as Store.state.access = { roles: { ROLE: { right: bool } }, users: { userId: { right: bool } } },
   holding only the differences from the defaults (a user setting beats the role setting, which beats the default).
   Workflow safeguards stay in force whatever is granted: maker-checker, own-branch rules and status checks.
   The Administration area itself always belongs to the Administrator role. */

const ALL_ROLES = ['INPUTTER', 'AUTHORISER', 'TREASURY', 'EC', 'ADMIN'];

const ACCESS_FIXED = [
  // [key, group, label, description, default roles]
  ['view.allBranches', 'Views', 'Applications from all branches', 'View every transaction of every branch, including those from before the user joined. What a user may do with them still follows their role. Without this, users see their own branches plus anything assigned to them.', ALL_ROLES],
  ['view.unreconciled', 'Views', 'Unreconciled items page', 'The full list of advance payments awaiting reconciliation.', ALL_ROLES],
  ['view.outbox', 'Views', 'Outgoing messages log', 'Every email and SMS the system has generated.', ALL_ROLES],
  ['view.eod', 'Views', 'End-of-period reports', 'End of day, month and year reports and the backup log (all branches).', ['TREASURY', 'EC', 'ADMIN']],
  ['act.capture', 'Actions', 'Capture applications', 'Create, edit and submit drafts, reopen, and reject at input for unreconciled items (own branch).', ['INPUTTER', 'AUTHORISER']],
  ['act.authorise', 'Actions', 'Authorise applications', 'Authorise, edit, return or reject submitted applications (own branch; never one they captured).', ['AUTHORISER']],
  ['act.allocate', 'Actions', 'Allocate forex', 'Allocate with rate and cross rate, and forfeit allocations.', ['TREASURY']],
  ['act.allocateForTreasury', 'Actions', 'Allocate on Treasury\'s advice', 'Exchange Control enters an allocation on behalf of a Treasury officer working remotely, naming the officer who advised it.', ['EC', 'ADMIN']],
  ['act.recommend', 'Actions', 'Exchange Control recommendation', 'Recommend, recommend with conditions, or not recommend.', ['EC']],
  ['act.assign', 'Actions', 'Assign for processing', 'Assign non-travel transactions to a user or branch.', ['EC']],
  ['act.fundAny', 'Actions', 'Mark funded – any time', 'Confirm funding of non-travel transactions without waiting for a recommendation.', ['TREASURY', 'EC']],
  ['act.branchFunding', 'Actions', 'Mark funded – branch', 'Travel: own branch. Other types: once Exchange Control has recommended.', ['INPUTTER', 'AUTHORISER', 'TREASURY', 'EC']],
  ['act.travelPayout', 'Actions', 'Pay out travel', 'Record the pay-out of travel transactions (own branch).', ['INPUTTER', 'AUTHORISER']],
  ['act.pay', 'Actions', 'Record payments', 'Mark non-travel transactions fully or partly paid.', ['INPUTTER', 'AUTHORISER', 'EC']],
  ['act.reconcile', 'Actions', 'Reconcile advance payments', 'Mark advance payments as reconciled.', ['EC']],
  ['act.comment', 'Actions', 'Add comments', 'Comment on applications.', ['INPUTTER', 'AUTHORISER', 'TREASURY', 'EC']],
  ['act.eod', 'Actions', 'Run end of day / month / year', 'Close periods, run backups, reopen periods, restart numbering at year end.', ['ADMIN']],
  ['act.export', 'Actions', 'Export', 'Download reports and lists as Excel, Word, PDF, CSV, HTML or print them.', ALL_ROLES],
];

const Access = {
  map: null,

  /* Full catalogue: fixed rights, one per work queue, one per report (every report defaults to every role). */
  catalogue() {
    if (this.list) return this.list;
    const queues = Object.entries(Queues.defs).map(([id, q]) => [`view.queue.${id}`, 'Work queues', q.label, 'Shown in the menu and on the dashboard.', q.roles]);
    const reports = Reports.tabs.map(([k, l]) => [`report.${k}`, 'Reports', l, 'Branch staff see their own branch\'s data unless they also have "Applications from all branches".', ALL_ROLES]);
    this.list = [...ACCESS_FIXED.filter(r => r[1] === 'Views'), ...queues, ...reports, ...ACCESS_FIXED.filter(r => r[1] === 'Actions')]
      .map(([key, group, label, desc, roles]) => ({ key, group, label, desc, roles }));
    this.map = Object.fromEntries(this.list.map(r => [r.key, r]));
    return this.list;
  },

  def(key) { if (!this.map) this.catalogue(); return this.map[key]; },
  label(key) { const d = this.def(key); return d ? (d.group === 'Work queues' ? `Queue: ${Queues.defs[key.slice(11)]?.label || d.label}` : d.label) : key; },

  state(S = Store.state) { return (S && S.access) || { roles: {}, users: {} }; },

  roleHas(role, key, A = this.state()) {
    const r = A.roles?.[role];
    if (r && key in r) return !!r[key];
    const d = this.def(key);
    return !!d && d.roles.includes(role);
  },

  has(user, key, A = this.state()) {
    if (!user) return false;
    const o = A.users?.[user.id];
    if (o && key in o) return !!o[key];
    return this.roleHas(user.role, key, A);
  },

  /* ---------- Administration → Access rights ---------- */
  draft: null,
  selUser: '',

  render() {
    const S = Store.state;
    if (!this.draft) this.draft = U.clone(this.state());
    const D = this.draft;
    D.roles = D.roles || {}; D.users = D.users || {};
    const list = this.catalogue();
    const groups = [...new Set(list.map(r => r.group))];
    const users = S.users.filter(u => u.active !== false).sort((a, b) => a.name.localeCompare(b.name));
    const su = users.find(u => u.id === this.selUser) || null;
    const nobody = list.filter(r => r.group === 'Actions' && !ALL_ROLES.some(role => this.roleHas(role, r.key, D)) && !users.some(u => this.has(u, r.key, D)));
    const changed = JSON.stringify(this.clean(D)) !== JSON.stringify(this.clean(this.state()));
    const roleCols = ALL_ROLES.map(r => `<th class="c">${U.esc(ROLES[r])}</th>`).join('');

    U.$('#adm').innerHTML = `
      <div class="alert info" style="margin-bottom:12px"><div>Choose what each role can see and do, and fine-tune it for individual users. Ticked boxes show the current setting; a <b>•</b> marks a change from the standard set-up.
        Workflow safeguards always apply: no one can authorise their own capture, branch rules and status checks stay in force, and the Administration area stays with Administrators.</div></div>
      ${nobody.length ? `<div class="alert warn" style="margin-bottom:12px"><div><b>No one can:</b> ${nobody.map(r => U.esc(r.label)).join(', ')}. Transactions will stop at that step.</div></div>` : ''}
      <div class="toolbar"><button class="btn-primary" id="ac-save" ${changed ? '' : 'disabled'}>Save access rights</button><button id="ac-discard" ${changed ? '' : 'disabled'}>Discard changes</button>
        <span class="grow"></span><button id="ac-defaults">Restore standard set-up…</button></div>
      <div class="card freeze" style="margin-bottom:16px"><div class="card-h"><h2>Rights by role</h2><small>Applies to everyone with that role unless set for the user below</small></div>
        <div class="card-b tight"><div class="table-wrap"><table class="access">
          <thead><tr><th>Right</th>${roleCols}</tr></thead>
          <tbody>${groups.map(g => `<tr class="grp"><td colspan="${ALL_ROLES.length + 1}"><b>${U.esc(g)}</b></td></tr>` + list.filter(r => r.group === g).map(r => `<tr>
            <td><b>${U.esc(this.label(r.key).replace(/^Queue: /, ''))}</b><br><small class="muted">${U.esc(r.desc)}</small></td>
            ${ALL_ROLES.map(role => { const on = this.roleHas(role, r.key, D); const diff = on !== r.roles.includes(role);
              return `<td class="c"><label class="chk"><input type="checkbox" data-role="${role}" data-key="${r.key}" ${on ? 'checked' : ''} aria-label="${U.esc(ROLES[role])}: ${U.esc(r.label)}">${diff ? '<b class="diff" title="Changed from the standard set-up">•</b>' : ''}</label></td>`; }).join('')}
          </tr>`).join('')).join('')}</tbody>
        </table></div></div></div>
      <div class="card"><div class="card-h"><h2>Rights for an individual user</h2>
          <select id="ac-user" aria-label="User"><option value="">Choose a user…</option>${users.map(u => `<option value="${u.id}" ${u.id === this.selUser ? 'selected' : ''}>${U.esc(u.name)} – ${U.esc(ROLES[u.role])}, ${U.esc(UI.branchName(u.branchId))}${Object.keys(D.users[u.id] || {}).length ? ' (custom)' : ''}</option>`).join('')}</select></div>
        <div class="card-b tight">${su ? `<div class="table-wrap"><table class="access">
          <thead><tr><th>Right</th><th>From role (${U.esc(ROLES[su.role])})</th><th>Setting for ${U.esc(su.name)}</th><th>Result</th></tr></thead>
          <tbody>${groups.map(g => `<tr class="grp"><td colspan="4"><b>${U.esc(g)}</b></td></tr>` + list.filter(r => r.group === g).map(r => {
            const o = D.users[su.id] || {}; const v = r.key in o ? (o[r.key] ? 'allow' : 'deny') : '';
            const fromRole = this.roleHas(su.role, r.key, D), eff = this.has(su, r.key, D);
            return `<tr><td>${U.esc(this.label(r.key).replace(/^Queue: /, ''))}</td><td>${fromRole ? UI.tag('Yes', 'green') : UI.tag('No', 'grey')}</td>
              <td><select data-user-key="${r.key}" aria-label="${U.esc(r.label)}"><option value="" ${v === '' ? 'selected' : ''}>Same as role</option><option value="allow" ${v === 'allow' ? 'selected' : ''}>Allow</option><option value="deny" ${v === 'deny' ? 'selected' : ''}>Deny</option></select></td>
              <td>${eff ? UI.tag('Allowed', 'green') : UI.tag('Not allowed', 'red')}</td></tr>`; }).join('')).join('')}</tbody>
        </table></div>
        <div class="btn-row" style="padding:12px"><button id="ac-user-clear" ${Object.keys(D.users[su.id] || {}).length ? '' : 'disabled'}>Clear all settings for ${U.esc(su.name)}</button></div>` : '<div class="empty">Choose a user to give or take away individual rights.</div>'}</div></div>`;

    U.$$('#adm [data-role]').forEach(cb => cb.addEventListener('change', () => {
      const { role, key } = cb.dataset, def = this.def(key).roles.includes(role);
      D.roles[role] = D.roles[role] || {};
      if (cb.checked === def) delete D.roles[role][key]; else D.roles[role][key] = cb.checked;
      this.render();
    }));
    U.$('#ac-user').addEventListener('change', e => { this.selUser = e.target.value; this.render(); });
    U.$$('#adm [data-user-key]').forEach(sel => sel.addEventListener('change', () => {
      const o = D.users[su.id] = D.users[su.id] || {};
      if (sel.value === '') delete o[sel.dataset.userKey]; else o[sel.dataset.userKey] = sel.value === 'allow';
      this.render();
    }));
    U.$('#ac-user-clear')?.addEventListener('click', () => { delete D.users[su.id]; this.render(); });
    U.$('#ac-discard').addEventListener('click', () => { this.draft = null; this.render(); });
    U.$('#ac-defaults').addEventListener('click', async () => {
      if (!await UI.confirm('Restore the standard set-up?', '<p>All role and individual user settings go back to the standard rights. Nothing is saved until you click <b>Save access rights</b>.</p>', 'Restore')) return;
      this.draft = { roles: {}, users: {} };
      this.render();
    });
    U.$('#ac-save').addEventListener('click', () => this.save());
  },

  /* Only differences from the defaults; drops empty entries and users that no longer exist. */
  clean(A) {
    const out = { roles: {}, users: {} };
    Object.entries(A.roles || {}).forEach(([role, m]) => {
      const x = {};
      Object.entries(m || {}).forEach(([k, v]) => { const d = this.def(k); if (d && v !== d.roles.includes(role)) x[k] = v; });
      if (Object.keys(x).length) out.roles[role] = x;
    });
    Object.entries(A.users || {}).forEach(([id, m]) => {
      if (!Store.userById(id)) return;
      const x = {};
      Object.entries(m || {}).forEach(([k, v]) => { if (this.def(k)) x[k] = !!v; });
      if (Object.keys(x).length) out.users[id] = x;
    });
    return out;
  },

  describe(before, after) {
    const lines = [];
    ALL_ROLES.forEach(role => this.catalogue().forEach(r => {
      const a = this.roleHas(role, r.key, before), b = this.roleHas(role, r.key, after);
      if (a !== b) lines.push({ field: `${ROLES[role]} – ${this.label(r.key)}`, from: a ? 'Yes' : 'No', to: b ? 'Yes' : 'No' });
    }));
    const ids = new Set([...Object.keys(before.users || {}), ...Object.keys(after.users || {})]);
    ids.forEach(id => {
      const u = Store.userById(id);
      if (!u) return;
      this.catalogue().forEach(r => {
        const show = m => (m && r.key in m ? (m[r.key] ? 'Allow' : 'Deny') : 'Same as role');
        const a = show(before.users?.[id]), b = show(after.users?.[id]);
        if (a !== b) lines.push({ field: `${u.name} – ${this.label(r.key)}`, from: a, to: b });
      });
    });
    return lines;
  },

  save() {
    const before = this.clean(this.state()), after = this.clean(this.draft);
    const changes = this.describe(before, after);
    Store.state.access = after;
    Store.audit('ACCESS_UPDATED', null, `Access rights changed (${changes.length} change${changes.length === 1 ? '' : 's'})`, changes);
    Store.save();
    this.draft = null;
    UI.toast('Access rights saved.', 'ok');
    App.renderChrome();
    this.render();
  },
};

/* Hook the rights into shared screens without changing them. */
(() => {
  const baseButton = Export.button.bind(Export);
  Export.button = (label) => (Access.has(Store.user(), 'act.export') ? baseButton(label) : '');
  const baseRun = Export.run.bind(Export);
  Export.run = (fmt, model) => {
    if (!Access.has(Store.user(), 'act.export')) throw new WorkflowError('You do not have the right to export.');
    return baseRun(fmt, model);
  };
  Admin.tabs.splice(Math.max(0, Admin.tabs.findIndex(t => t[0] === 'users') + 1), 0, ['access', 'Access rights']);
  Admin.access = () => Access.render();
})();
