'use strict';

/* Dashboard, queues, application detail + workflow actions, messages. */
const Views = {
  /* ---------------- dashboard ---------------- */
  dashboard() {
    const u = Store.user();
    UI.setTitle('Dashboard', `${ROLES[u.role]} · ${UI.branchName(Engine.workingBranch(u))}`);
    if (u.role === 'ADMIN') {
      document.getElementById('view').innerHTML = `<div class="alert info" style="margin-bottom:16px"><div>Administration: templates, branches, users and rules are under <a href="#/admin/templates">Administration</a>.</div></div>${Views.unreconciledCard()}`;
      return;
    }
    const queues = Queues.forUser(u);
    const tones = ['', 'amber', 'violet', 'green', 'red'];
    const kpis = queues.map((q, i) => {
      const n = Queues.list(q.id).length;
      return `<a class="kpi ${q.alert && n ? tones[(i % 4) + 1] : ''}" href="#/apps/${q.id}"><div class="v">${n}</div><div class="l">${U.esc(q.label)}</div></a>`;
    }).join('');

    const first = queues.find(q => q.alert && Queues.list(q.id).length) || queues[0];
    const rows = first ? Queues.list(first.id).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 8) : [];
    const recent = Reports.visibleAudit(u)   // same rule as the Audit trail report: own, branch (authoriser) or all (admin)
      .filter(e => { const a = e.appId && Store.app(e.appId); return a && Engine.can('view', a); })
      .slice(-10).reverse();

    const intro = {
      INPUTTER: 'Capture forex applications, upload the supporting documents and submit them for authorisation. Returned applications need your attention.',
      AUTHORISER: 'Review applications submitted by inputters. Authorise them, or reject them back to the inputter or with advice to the client.',
      TREASURY: 'Allocate foreign currency to authorised applications and give the rate and cross rate. Clients must fund their accounts by the cut-off or the allocation is forfeited.',
      EC: 'Review authorised transactions and give your recommendation, assign them for processing, record payments and track advance payment reconciliations.',
    }[u.role];

    document.getElementById('view').innerHTML = `
      <div class="alert info" style="margin-bottom:16px">${U.esc(intro)}
        ${Access.has(u, 'act.capture') ? '<a class="btn btn-primary btn-sm" href="#/new" style="margin-left:auto">+ New application</a>' : ''}</div>
      <div class="kpis">${kpis}</div>
      ${Views.unreconciledCard(6)}
      <div class="cols" style="margin-top:16px">
        <div class="card">
          <div class="card-h"><h2>${first ? U.esc(first.label) : 'Applications'}</h2>${first ? `<a href="#/apps/${first.id}">View all →</a>` : ''}</div>
          <div class="card-b tight">${Views.appTable(rows, first?.id)}</div>
        </div>
        <div class="side">
          <div class="card">
            <div class="card-h"><h2>Recent activity</h2></div>
            <div class="card-b">${recent.length ? `<ul class="timeline">${recent.map(e => `
              <li class="${e.role === 'SYSTEM' ? 'sys' : ''}">
                <div class="what">${U.esc(Views.actionLabel(e.action))} ${e.ref ? `<a href="#/app/${e.appId}">${U.esc(e.ref)}</a>` : ''}</div>
                <div class="meta">${U.esc(e.userName)} · ${U.fmtDateTime(e.at)}</div>
              </li>`).join('')}</ul>` : '<div class="muted">No activity yet.</div>'}</div>
          </div>
        </div>
      </div>`;
  },

  /* ---------------- unreconciled items (all users, all branches) ---------------- */
  reconTable(items) {
    if (!items.length) return '<div class="empty">No unreconciled items.</div>';
    const now = Store.now();
    return `<div class="table-wrap"><table>
      <thead><tr><th>Reference</th><th>Client</th><th>ID</th><th>Branch</th><th class="num">Amount</th><th>Beneficiary</th><th>Paid</th><th>Reconcile by</th></tr></thead>
      <tbody>${items.map(a => {
        const link = Engine.can('view', a);
        const d = U.daysBetween(now, a.recon.dueDate);
        const paid = (a.payments || []).map(p => p.valueDate).sort().pop();
        return `<tr ${link ? `class="click" data-href="#/app/${a.id}"` : ''}>
          <td class="mono">${link ? `<a href="#/app/${a.id}">${U.esc(a.ref)}</a>` : U.esc(a.ref)}</td>
          <td>${U.esc(a.customer?.name)}<br><small class="mono">${U.esc(a.customer?.account)}</small></td>
          <td>${a.customer?.idNumber ? `<span class="mono">${U.esc(a.customer.idNumber)}</span><br><small>${U.esc(ID_TYPE_LABELS[a.customer.idType] || '')}</small>` : '<span class="muted">—</span>'}</td>
          <td>${U.esc(UI.branchName(a.branchId))}</td>
          <td class="num">${U.money(a.amount, a.currency)}</td>
          <td>${U.esc(a.beneficiary?.name || '')}<br><small>${U.esc(a.beneficiary?.country || '')}</small></td>
          <td class="nowrap">${U.fmtDate(paid)}</td>
          <td class="nowrap">${U.fmtDate(a.recon.dueDate)}<br>${d < 0 ? UI.tag(`${-d} days overdue`, 'red') : UI.tag(`${d} days left`, d <= 14 ? 'amber' : 'grey')}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  },

  unreconciledCard(limit = 10) {
    const items = Engine.unreconciled();
    const today = U.dayKey(Store.now());
    const overdue = items.filter(a => a.recon.dueDate < today);
    const usd = U.sum(items, a => Rules.toUSD(a.amount, a.currency));
    return `<div class="card">
      <div class="card-h"><h2>Unreconciled items <small class="muted">· all branches</small></h2><a href="#/unreconciled">View all →</a></div>
      <div class="card-b" style="padding-bottom:0"><div class="kpis" style="margin-bottom:12px">
        <a class="kpi ${items.length ? 'amber' : ''}" href="#/unreconciled"><div class="v">${items.length}</div><div class="l">Unreconciled advance payments</div></a>
        <a class="kpi ${overdue.length ? 'red' : ''}" href="#/unreconciled/overdue"><div class="v">${overdue.length}</div><div class="l">Overdue</div></a>
        <div class="kpi"><div class="v">${U.num(usd, 0)}</div><div class="l">Value ≈ USD</div></div>
      </div></div>
      <div class="card-b tight">${Views.reconTable(items.slice(0, limit))}</div>
    </div>`;
  },

  unreconciledPage(mode) {
    if (!Access.has(Store.user(), 'view.unreconciled')) { location.hash = '#/dashboard'; return; }
    UI.setTitle('Unreconciled items', 'All branches · visible to all users');
    const f = Views.unrecFilter = Views.unrecFilter || { q: '', branch: '', when: '' };
    if (mode === 'overdue') f.when = 'overdue';
    const all = Engine.unreconciled();
    document.getElementById('view').innerHTML = `
      <div class="alert info" style="margin-bottom:12px"><div>Advance payments that have been paid but not yet reconciled. Inputters should check this list (by account or ID number) and may reject new applications from clients with unreconciled items.</div></div>
      <div class="toolbar">
        <input type="search" id="ur-q" placeholder="Search client, account, ID number, reference…" value="${U.esc(f.q)}" style="flex:1;min-width:240px">
        <select id="ur-branch"><option value="">All branches</option>${Store.state.branches.map(b => `<option value="${b.id}" ${f.branch === b.id ? 'selected' : ''}>${U.esc(b.code)} · ${U.esc(b.name)}</option>`).join('')}</select>
        <select id="ur-when"><option value="">All</option><option value="overdue" ${f.when === 'overdue' ? 'selected' : ''}>Overdue</option><option value="14" ${f.when === '14' ? 'selected' : ''}>Due within 14 days</option></select>
        <span class="muted" id="ur-count"></span>${Export.button()}
      </div>
      <div class="card"><div class="card-b tight" id="ur-table"></div></div>`;
    let rows = [];
    const draw = () => {
      const term = f.q.trim().toLowerCase(), today = Store.now();
      rows = all.filter(a => (!f.branch || a.branchId === f.branch)
        && (!f.when || (f.when === 'overdue' ? U.daysBetween(today, a.recon.dueDate) < 0 : U.daysBetween(today, a.recon.dueDate) <= Number(f.when)))
        && (!term || [a.ref, a.formerRef, a.customer?.name, a.customer?.account, a.customer?.idNumber, a.beneficiary?.name].some(x => String(x || '').toLowerCase().includes(term))));
      U.$('#ur-table').innerHTML = Views.reconTable(rows);
      U.$('#ur-count').textContent = `${rows.length} of ${all.length}`;
    };
    U.$('#ur-q').addEventListener('input', e => { f.q = e.target.value; draw(); });
    U.$('#ur-branch').addEventListener('change', e => { f.branch = e.target.value; draw(); });
    U.$('#ur-when').addEventListener('change', e => { f.when = e.target.value; draw(); });
    Export.attach(document.getElementById('view'), () => ({
      title: 'Unreconciled advance payments',
      subtitle: `${f.branch ? UI.branchName(f.branch) : 'All branches'}${f.when === 'overdue' ? ' · overdue only' : f.when ? ` · due within ${f.when} days` : ''} · as at ${U.fmtDate(Store.now())}`,
      filename: `unreconciled_${U.dayKey(Store.now())}`,
      sections: [{ heading: 'Unreconciled items',
        columns: [{ label: 'Reference' }, { label: 'Client' }, { label: 'Account' }, { label: 'ID type' }, { label: 'ID number' }, { label: 'Branch' }, { label: 'Currency' }, { label: 'Amount', num: 2 }, { label: 'Beneficiary' }, { label: 'Country' }, { label: 'Reconcile by' }, { label: 'Days left', num: 0 }],
        rows: rows.map(a => [a.ref, a.formerRef, a.customer?.name, a.customer?.account, ID_TYPE_LABELS[a.customer?.idType] || '', a.customer?.idNumber || '', UI.branchName(a.branchId), a.currency, a.amount, a.beneficiary?.name, a.beneficiary?.country, U.fmtDate(a.recon.dueDate), U.daysBetween(Store.now(), a.recon.dueDate)]) }],
    }));
    draw();
  },

  actionLabel(a) {
    return ({
      CREATED: 'Captured', EDITED: 'Edited', SUBMITTED: 'Submitted', REOPENED: 'Reopened', DISCARDED: 'Draft discarded',
      AUTHORISED: 'Authorised', RETURNED: 'Returned to inputter', REJECTED: 'Rejected', REJECTED_AT_INPUT: 'Rejected at input', ALLOCATED: 'Forex allocated',
      FUNDING_CONFIRMED: 'Funding confirmed', ALLOCATION_FORFEITED: 'Allocation forfeited', EC_RECOMMENDATION: 'EC recommendation',
      ASSIGNED: 'Assigned', PAYMENT_RECORDED: 'Payment recorded', RECONCILED: 'Reconciled', EXPIRED: 'Closed – not allocated',
      COMMENTED: 'Comment', LOGIN: 'Signed in', LOGOUT: 'Signed out', LOGIN_FAILED: 'Failed sign-in', ACCOUNT_LOCKED: 'Account locked',
      ACCOUNT_UNLOCKED: 'Account unlocked', PASSWORD_CHANGED: 'Password changed', PASSWORD_SET_BY_ADMIN: 'Temporary password set',
      PASSWORD_RESET_REQUESTED: 'Password reset requested', PASSWORD_RESET: 'Password reset', REPORT_EXPORTED: 'Report exported', BRANDING_UPDATED: 'Branding updated', UPLOAD_BLOCKED: 'Upload blocked (security check)', TEMPLATE_UPDATED: 'Template updated', SETTINGS_UPDATED: 'Settings updated',
      BRANCH_SAVED: 'Branch saved', USER_SAVED: 'User saved', BANK_UPDATED: 'Bank details updated', CORRESPONDENT_SAVED: 'Correspondent bank saved',
      CLOCK_ADVANCED: 'Clock advanced', ACCESS_UPDATED: 'Access rights changed', SERVER_STARTED: 'Server started', SERVER_STOPPED: 'Server stopped', SERVER_STOP_REFUSED: 'Server stop refused', DATA_RESET: 'Demo data reset',
    })[a] || a;
  },

  /* ---------------- queue / list ---------------- */
  extraCol(queueId) {
    if (queueId === 'travel') return ['Travel date', a => `${U.fmtDate(a.details?.travelDate)}<br><small>${U.daysBetween(Store.now(), a.details?.travelDate)} days</small>`];
    if (queueId === 'recon') return ['Reconcile by', a => { const d = U.daysBetween(Store.now(), a.recon.dueDate); return `${U.fmtDate(a.recon.dueDate)}<br>${d < 0 ? UI.tag(`${-d} days overdue`, 'red') : `<small>${d} days</small>`}`; }];
    if (queueId === 'expiring') return ['Expiring', a => Engine.expiries(a).map(x => `${U.esc(x.item)}<br><small>${U.esc(x.when)} · ${U.esc(x.timeLeft)}</small>`).join('<br>')];
    if (queueId === 'awaitingFunding') return ['Fund by', a => { const al = a.allocations.find(x => x.status === 'AWAITING_FUNDING'); return al ? U.fmtDateTime(al.deadline) : '—'; }];
    return null;
  },

  appTable(apps, queueId) {
    if (!apps.length) return '<div class="empty">Nothing here right now.</div>';
    const extra = Views.extraCol(queueId);
    const ageDays = Store.state.settings.agingDays;
    return `<div class="table-wrap"><table>
      <thead><tr><th>Reference</th><th>Customer</th><th>Type</th><th class="num">Amount</th><th class="num">≈ USD</th><th>Status</th>${extra ? `<th>${extra[0]}</th>` : ''}<th>Branch</th><th>Applied</th></tr></thead>
      <tbody>${apps.map(a => {
        const br = Store.branch(a.branchId);
        const age = Engine.ageDays(a);
        return `
        <tr class="click" data-href="#/app/${a.id}">
          <td><a href="#/app/${a.id}" class="mono">${U.esc(a.ref)}</a></td>
          <td>${U.esc(a.customer?.name || '—')}<br><small class="mono">${U.esc(a.customer?.account || '')}</small></td>
          <td>${U.esc(UI.typeLabel(a.type))}</td>
          <td class="num">${U.money(a.amount, a.currency)}</td>
          <td class="num">${U.num(Rules.toUSD(a.amount, a.currency))}</td>
          <td>${UI.badge(a.status)}${a.recon && a.recon.status !== 'RECONCILED' ? `<br>${UI.tag(RECON_STATUS[a.recon.status]?.label || 'Reconciliation pending', 'amber')}` : ''}</td>
          ${extra ? `<td>${extra[1](a)}</td>` : ''}
          <td><b>${U.esc(br?.name || '—')}</b>${br ? `<br><small class="mono">${U.esc(br.code)}</small>` : ''}</td>
          <td class="nowrap">${U.fmtDate(Engine.appliedAt(a))}${Engine.isOpen(a) ? `<br>${age > ageDays ? UI.tag(`${age} days old`, 'red') : `<small>${age} day${age === 1 ? '' : 's'}</small>`}` : ''}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  },

  /* Client history: visible to every user across all branches. Links only where the user may open the record. */
  historyTable(apps, compact = false) {
    if (!apps.length) return '<div class="empty">No previous applications for this account.</div>';
    return `<div class="table-wrap"><table>
      <thead><tr><th>Reference</th><th>Applied</th>${compact ? '' : '<th>Branch</th>'}<th>Type</th><th class="num">Amount</th>${compact ? '' : '<th class="num">Paid</th><th>Beneficiary</th>'}<th>Status</th></tr></thead>
      <tbody>${apps.map(a => {
        const link = Engine.can('view', a);
        return `<tr ${link ? `class="click" data-href="#/app/${a.id}"` : ''}>
          <td class="mono">${link ? `<a href="#/app/${a.id}">${U.esc(a.ref)}</a>` : U.esc(a.ref)}</td>
          <td class="nowrap">${U.fmtDate(a.submittedAt)}${compact ? `<br><small>${U.esc(UI.branchName(a.branchId))}</small>` : ''}</td>
          ${compact ? '' : `<td>${U.esc(UI.branchName(a.branchId))}</td>`}
          <td>${U.esc(UI.typeLabel(a.type))}</td>
          <td class="num">${U.money(a.amount, a.currency)}</td>
          ${compact ? '' : `<td class="num">${U.num(Engine.totals(a).paid)}</td><td>${U.esc(a.beneficiary?.name || '')}<br><small>${U.esc(a.beneficiary?.country || '')}</small></td>`}
          <td>${UI.badge(a.status)}${a.recon && a.recon.status !== 'RECONCILED' ? `<br>${UI.tag(RECON_STATUS[a.recon.status]?.label || 'Reconciliation pending', 'amber')}` : ''}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  },

  listFilters: {},
  blankFilter() {
    return { q: '', branch: '', status: '', type: '', currency: '', acctType: '', ec: '', assigned: '', dateBasis: 'applied', from: '', to: '', minUSD: '', maxUSD: '', sort: 'updated' };
  },

  /* Every filter the list supports; also used for the CSV export. */
  applyFilter(apps, f) {
    const term = f.q.trim().toLowerCase();
    const dateOf = a => ({ applied: Engine.appliedAt(a), authorised: a.authorisedAt, updated: a.updatedAt })[f.dateBasis];
    return apps.filter(a => {
      const usd = Rules.toUSD(a.amount, a.currency);
      const d = dateOf(a) ? U.dayKey(dateOf(a)) : null;
      return (!f.branch || a.branchId === f.branch)
        && (!f.status || a.status === f.status)
        && (!f.type || a.type === f.type)
        && (!f.currency || a.currency === f.currency)
        && (!f.acctType || a.customer?.accountType === f.acctType)
        && (!f.ec || (f.ec === 'PENDING' ? !a.ec : a.ec?.recommendation === f.ec))
        && (!f.assigned || (f.assigned === 'yes') === !!a.assignment)
        && (!f.from || (d && d >= f.from)) && (!f.to || (d && d <= f.to))
        && (f.minUSD === '' || usd >= Number(f.minUSD)) && (f.maxUSD === '' || usd <= Number(f.maxUSD))
        && (!term || [a.ref, a.formerRef, a.customer?.name, a.customer?.account, a.customer?.phone, a.beneficiary?.name, a.beneficiary?.country].some(x => String(x || '').toLowerCase().includes(term)));
    }).sort({
      updated: (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''),
      applied: (a, b) => (Engine.appliedAt(b) || '').localeCompare(Engine.appliedAt(a) || ''),
      oldest: (a, b) => (Engine.appliedAt(a) || '').localeCompare(Engine.appliedAt(b) || ''),
      amount: (a, b) => Rules.toUSD(b.amount, b.currency) - Rules.toUSD(a.amount, a.currency),
      branch: (a, b) => UI.branchName(a.branchId).localeCompare(UI.branchName(b.branchId)),
    }[f.sort]);
  },

  list(queueId) {
    const q = Queues.defs[queueId];
    const u = Store.user();
    if (!q || !Access.has(u, `view.queue.${queueId}`)) { location.hash = '#/dashboard'; return; }
    UI.setTitle(q.label, 'Applications');
    const all = Queues.list(queueId);
    const f = Views.listFilters[queueId] = Views.listFilters[queueId] || Views.blankFilter();
    const showBranch = u.role !== 'INPUTTER';
    const opt = (val, label, cur) => `<option value="${U.esc(val)}" ${String(cur) === String(val) ? 'selected' : ''}>${U.esc(label)}</option>`;
    const sel = (key, label, options) => `<label class="f"><span>${label}</span><select data-f="${key}">${options.map(([v, l]) => opt(v, l, f[key])).join('')}</select></label>`;
    const usedBranches = new Set(all.map(a => a.branchId));

    document.getElementById('view').innerHTML = `
      <div class="toolbar">
        <input type="search" data-f="q" placeholder="Search reference, customer, account, phone, beneficiary, country…" value="${U.esc(f.q)}" style="flex:1;min-width:260px">
        <span class="muted" id="lf-count"></span>
        ${Export.button()}
        ${Access.has(u, 'act.capture') ? '<a class="btn btn-primary" href="#/new">+ New application</a>' : ''}
      </div>
      <div class="card" style="margin-bottom:16px"><div class="card-h"><h2>Filters <small class="muted" id="lf-active"></small></h2><button class="btn-sm" id="lf-clear">Clear all</button></div>
        <div class="card-b grid g4">
          ${showBranch ? sel('branch', 'Branch', [['', 'All branches'], ...Store.state.branches.map(b => [b.id, `${b.code} · ${b.name}${usedBranches.has(b.id) ? '' : ' (none)'}`])]) : ''}
          ${sel('status', 'Status', [['', 'All statuses'], ...Object.entries(STATUS).map(([k, s]) => [k, s.label])])}
          ${sel('type', 'Transaction type', [['', 'All types'], ...Object.entries(TXN_TYPES).map(([k, t]) => [k, t.label])])}
          ${sel('currency', 'Currency', [['', 'All currencies'], ...CURRENCIES.map(c => [c, c])])}
          ${sel('acctType', 'Account type', [['', 'Local & foreign'], ...Object.entries(ACCOUNT_TYPES)])}
          ${sel('ec', 'EC recommendation', [['', 'Any'], ['PENDING', 'Not yet reviewed'], ...RECOMMENDATIONS.map(r => [r, r])])}
          ${sel('assigned', 'Assignment', [['', 'Any'], ['yes', 'Assigned'], ['no', 'Not assigned']])}
          ${sel('sort', 'Sort by', [['updated', 'Last updated'], ['applied', 'Newest applied'], ['oldest', 'Oldest applied'], ['amount', 'Largest amount (USD)'], ['branch', 'Branch']])}
          ${sel('dateBasis', 'Date', [['applied', 'Date applied'], ['authorised', 'Date authorised'], ['updated', 'Last updated']])}
          <label class="f"><span>From</span><input type="date" data-f="from" value="${f.from}"></label>
          <label class="f"><span>To</span><input type="date" data-f="to" value="${f.to}"></label>
          <div class="f"><label class="f" style="margin:0"><span>Quick dates</span></label><div class="btn-row">
            <button class="btn-sm" data-preset="0">Today</button><button class="btn-sm" data-preset="7">7 days</button><button class="btn-sm" data-preset="30">30 days</button><button class="btn-sm" data-preset="month">This month</button></div></div>
          <label class="f"><span>Min amount (≈ USD)</span><input type="number" min="0" data-f="minUSD" value="${f.minUSD}"></label>
          <label class="f"><span>Max amount (≈ USD)</span><input type="number" min="0" data-f="maxUSD" value="${f.maxUSD}"></label>
        </div></div>
      <div class="card"><div class="card-b tight" id="lf-table"></div></div>`;

    let rows = [];
    const draw = () => {
      rows = Views.applyFilter(all, f);
      U.$('#lf-table').innerHTML = Views.appTable(rows, queueId);
      U.$('#lf-count').textContent = `${rows.length} of ${all.length}`;
      const blank = Views.blankFilter();
      const active = Object.keys(blank).filter(k => k !== 'sort' && k !== 'dateBasis' && f[k] !== blank[k]).length;
      U.$('#lf-active').textContent = active ? `· ${active} active` : '';
    };
    const view = document.getElementById('view');
    view.querySelectorAll('[data-f]').forEach(el => el.addEventListener(el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input', () => { f[el.dataset.f] = el.value; draw(); }));
    view.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
      const now = Store.now(), p = b.dataset.preset;
      f.to = U.dayKey(now);
      f.from = p === 'month' ? U.dayKey(new Date(now.getFullYear(), now.getMonth(), 1)) : U.dayKey(U.addDays(now, -Number(p)));
      view.querySelector('[data-f=from]').value = f.from; view.querySelector('[data-f=to]').value = f.to;
      draw();
    }));
    U.$('#lf-clear').addEventListener('click', () => { Views.listFilters[queueId] = Views.blankFilter(); Views.list(queueId); });
    // Describe the active filters in the exported report's subtitle.
    const filterText = () => {
      const parts = [];
      if (f.branch) parts.push(UI.branchName(f.branch));
      if (f.status) parts.push(STATUS[f.status].label);
      if (f.type) parts.push(UI.typeLabel(f.type));
      if (f.currency) parts.push(f.currency);
      if (f.acctType) parts.push(ACCOUNT_TYPES[f.acctType]);
      if (f.ec) parts.push(f.ec === 'PENDING' ? 'EC not yet reviewed' : `EC: ${f.ec}`);
      if (f.assigned) parts.push(f.assigned === 'yes' ? 'Assigned' : 'Not assigned');
      if (f.from || f.to) parts.push(`${({ applied: 'Applied', authorised: 'Authorised', updated: 'Updated' })[f.dateBasis]} ${f.from ? U.fmtDate(f.from) : '…'} – ${f.to ? U.fmtDate(f.to) : '…'}`);
      if (f.minUSD !== '' || f.maxUSD !== '') parts.push(`USD ${f.minUSD || 0} – ${f.maxUSD || '∞'}`);
      if (f.q) parts.push(`Search “${f.q}”`);
      return parts.length ? parts.join(' · ') : 'No filters';
    };
    Export.attach(view, () => ({
      title: q.label, subtitle: filterText(), filename: `${queueId}_${U.dayKey(Store.now())}`,
      sections: [{ heading: q.label,
        columns: [{ label: 'Reference' }, { label: 'Branch code' }, { label: 'Branch' }, { label: 'Customer' }, { label: 'Account' }, { label: 'Account type' }, { label: 'ID number' }, { label: 'Type' }, { label: 'Currency' }, { label: 'Amount', num: 2 }, { label: 'USD equivalent', num: 2 }, { label: 'Status' }, { label: 'EC recommendation' }, { label: 'Assigned to' }, { label: 'Beneficiary' }, { label: 'Country' }, { label: 'Applied' }, { label: 'Authorised' }, { label: 'Age (days)', num: 0 }],
        rows: rows.map(a => { const br = Store.branch(a.branchId); return [a.ref, br?.code, br?.name, a.customer?.name, a.customer?.account, ACCOUNT_TYPES[a.customer?.accountType] || '', a.customer?.idNumber || '', UI.typeLabel(a.type), a.currency, a.amount, U.round2(Rules.toUSD(a.amount, a.currency)), STATUS[a.status].label, a.ec?.recommendation || '', a.assignment ? Engine.assigneeName(a) : '', a.beneficiary?.name, a.beneficiary?.country, U.fmtDate(Engine.appliedAt(a)), a.authorisedAt ? U.fmtDate(a.authorisedAt) : '', Engine.isOpen(a) ? Engine.ageDays(a) : '']; }) }],
    }));
    draw();
  },

  /* ---------------- detail ---------------- */
  flow(app) {
    const st = app.status;
    const t = Engine.totals(app);
    const steps = [
      ['Captured', true],
      ['Authorised', !!app.authorisedAt],
      ['Forex allocated', t.allocated > 0],
      ['Account funded', app.allocations.some(a => a.status === 'FUNDED')],
      ['Paid', t.paid > 0 && st === 'CLOSED'],
    ];
    if (app.type === 'ADVANCE') steps.push(['Reconciled', app.recon?.status === 'RECONCILED']);
    let bad = -1;
    if (st === 'REJECTED') bad = 1;
    if (st === 'EXPIRED') bad = 2;
    const cur = steps.findIndex(s => !s[1]);
    return `<div class="flow">${steps.map(([label, done], i) => {
      const cls = i === bad ? 'bad' : done ? 'done' : i === cur ? 'cur' : '';
      const txt = i === bad ? (st === 'REJECTED' ? 'Rejected' : 'Not allocated') : label;
      return `<div class="step ${cls}">${done && i !== bad ? '✓ ' : ''}${txt}</div>`;
    }).join('')}</div>`;
  },

  detail(id) {
    const app = Store.app(id);
    if (!app || !Engine.can('view', app)) {
      UI.setTitle('Not found');
      document.getElementById('view').innerHTML = '<div class="card"><div class="empty">This application does not exist or you do not have access to it.</div></div>';
      return;
    }
    const u = Store.user();
    UI.setTitle(`${app.ref} · ${app.customer?.name || 'New application'}`, `${UI.typeLabel(app.type)} · ${UI.branchName(app.branchId)}`);
    const t = Engine.totals(app);
    const c = app.customer || {}, b = app.beneficiary || {}, d = app.details || {};
    const v = Rules.validate(app);
    const preAuth = ['DRAFT', 'RETURNED', 'PENDING_AUTH'].includes(app.status);
    const kv = rows => `<dl class="kv">${rows.filter(Boolean).map(([k, val]) => `<dt>${U.esc(k)}</dt><dd>${val === '' || val == null ? '<span class="muted">—</span>' : val}</dd>`).join('')}</dl>`;
    const e = s => U.esc(s);

    let typeDetails = '';
    if (Rules.isStudentCase(app)) {
      typeDetails = kv([
        app.type === 'MAINTENANCE' && ['Maintenance for', 'Student'],
        ['Student name', e(d.studentName)], ['Visa / permit expiry', U.fmtDate(d.visaExpiry)],
        ['Period of study', `${U.fmtDate(d.studyStart)} → ${U.fmtDate(d.studyEnd)}`],
      ]);
    } else if (app.type === 'MAINTENANCE') {
      typeDetails = kv([['Maintenance for', 'Other (e.g. rentals)']]);
    } else if (Rules.isTravel(app)) {
      const tr = Rules.travel(app);
      typeDetails = kv([
        ['Traveller', e(d.travellerName)], ['Passport / travel doc no.', e(d.passportNumber)],
        ['Travel → return', `${U.fmtDate(d.travelDate)} → ${U.fmtDate(d.returnDate)}${tr.days ? ` <small>(${tr.days} days)</small>` : ''}`],
        ['Allowance check', tr.days ? `≈ USD ${U.num(tr.amountUSD)} of max USD ${U.num(tr.maxUSD)} (${tr.days} × USD ${Store.state.settings.perDiemUSD})` : '—'],
        ['Ticket required', tr.ticketRequired ? 'Yes' : `No (≤ USD ${U.num(Store.state.settings.ticketThresholdUSD, 0)})`],
        app.type === 'MEDICAL' && (d.invoiceNumber || d.invoiceDate) && ['Medical invoice', `${e(d.invoiceNumber || '')}${d.invoiceDate ? ` · ${U.fmtDate(d.invoiceDate)}` : ''}`],
      ]);
    } else if (['ADVANCE', 'FREIGHT', 'OPEN_ACCOUNT'].includes(app.type)) {
      typeDetails = kv([['Invoice number', e(d.invoiceNumber)], ['Invoice date', d.invoiceDate ? U.fmtDate(d.invoiceDate) : '<span class="muted">not captured</span>'],
        ['Invoice amount', d.invoiceAmount ? U.money(d.invoiceAmount, app.currency) : '<span class="muted">not captured</span>']]);
    }

    const docs = Rules.requiredDocs(app);
    const extraDocs = (app.documents || []).filter(f => !docs.some(r => r.code === f.code));
    const fileList = files => files.map(f => `<div class="file"><span>📄</span><span class="name">${e(f.name)}</span><small>${U.fileSize(f.size)}</small>${DocView.buttons(f)}</div>`).join('');

    const msgs = Store.state.outbox.filter(m => m.appId === app.id).sort((a, b) => b.at.localeCompare(a.at));

    document.getElementById('view').innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="card-b">
          <div class="btn-row" style="justify-content:space-between;margin-bottom:12px">
            <div class="btn-row">${UI.badge(app.status)} ${UI.tag(TXN_TYPES[app.type]?.category || 'No type', 'blue')} ${UI.tag(`Branch: ${UI.branchName(app.branchId)}`, 'violet')}
              ${Engine.isOpen(app) && Engine.ageDays(app) > Store.state.settings.agingDays ? UI.tag(`Open ${Engine.ageDays(app)} days`, 'red') : ''}
              ${app.recon ? UI.tag(app.recon.status !== 'RECONCILED' ? `Reconcile by ${U.fmtDate(app.recon.dueDate)}` : 'Reconciled', app.recon.status !== 'RECONCILED' ? 'amber' : 'green') : ''}
              ${app.closedShort ? UI.tag('Closed short – balance cancelled', 'grey') : ''}</div>
            <small>Captured ${U.fmtDateTime(app.createdAt)} by ${e(UI.userName(app.createdBy))}${app.authorisedBy ? ` · authorised by ${e(UI.userName(app.authorisedBy))}` : ''}</small>
          </div>
          ${Views.flow(app)}
          <div class="amounts" style="margin-top:14px">
            <div><div class="l">Applied</div><div class="v">${U.money(app.amount, app.currency)}</div><small>≈ USD ${U.num(Rules.toUSD(app.amount, app.currency))}</small></div>
            <div><div class="l">Allocated</div><div class="v">${U.money(t.allocated, app.currency)}</div><small>${t.awaitingFunding ? `${U.num(t.awaitingFunding)} awaiting funding` : '&nbsp;'}</small></div>
            <div><div class="l">Paid</div><div class="v">${U.money(t.paid, app.currency)}</div><small>${app.payments.length} payment(s)</small></div>
            <div><div class="l">Balance</div><div class="v" style="color:${t.balance > 0 && t.paid > 0 && app.status !== 'CLOSED' ? 'var(--amber)' : 'inherit'}">${U.money(app.status === 'CLOSED' ? 0 : t.balance, app.currency)}</div><small>${t.fundedUnpaid ? `${U.num(t.fundedUnpaid)} funded, ready to pay` : '&nbsp;'}</small></div>
          </div>
        </div>
      </div>

      <div class="cols">
        <div class="stack">
          ${preAuth && (v.errors.length || v.warnings.length) ? `<div class="card"><div class="card-h"><h2>Validation</h2><small>${v.errors.length} issue(s), ${v.warnings.length} warning(s)</small></div><div class="card-b">
            ${v.errors.map(x => `<div class="alert error">✕ ${e(x.msg)}</div>`).join('')}${v.warnings.map(x => `<div class="alert warn">! ${e(x.msg)}</div>`).join('')}</div></div>` : ''}

          <div class="card"><div class="card-h"><h2>Customer & transaction</h2></div><div class="card-b kv-cols">
            ${kv([['Customer', e(c.name)], ['Account', `<span class="mono">${e(c.account)}</span>`], ['Account type', e(ACCOUNT_TYPES[c.accountType])],
              ['ID', c.idType ? `${e(ID_TYPE_LABELS[c.idType] || c.idType)}<br><span class="mono">${e(c.idNumber)}</span>` : ''], ['Address', e(c.address)], ['Email', c.email ? e(c.email) : '<span class="muted">none – SMS used</span>'], ['Contact number', e(c.phone)],
              ...(c.contacts || []).filter(k => k.value).map(k => [k.kind === 'email' ? 'Additional email' : 'Additional phone', `${e(k.value)}${k.name ? `<br><small>${e(k.name)}</small>` : ''}`]),
              ['Core banking (CBS)', c.cbs ? `Fetched ${U.fmtDateTime(c.cbs.at)} <small>(${e(c.cbs.source)})</small>${typeof CBS !== 'undefined' && CBS.amended(app).length ? `<br>${UI.tag(`Amended: ${CBS.amended(app).join(', ')}`, 'amber')}` : ''}` : '<span class="muted">not fetched – entered manually</span>']])}
            ${kv([['Transaction type', e(UI.typeLabel(app.type))], ['Account balance', U.money(app.balance, app.balanceCurrency)], ['Amount applied', `<b>${U.money(app.amount, app.currency)}</b>`], ['≈ MWK', U.num(Rules.toMWK(app.amount, app.currency))],
              ['Branch', (br => br ? `<b>${e(br.name)}</b> <small class="mono">${e(br.code)}</small><br><small>${e(br.phone)} · ${e(br.email)}</small>` : '—')(Store.branch(app.branchId))],
              ['Applied', `${U.fmtDate(Engine.appliedAt(app))}${Engine.isOpen(app) ? ` <small>(${Engine.ageDays(app)} days ago)</small>` : ''}`]])}
          </div></div>

          ${(h => `<div class="card"><div class="card-h"><h2>Client history</h2><small>${h.length} other application(s) for account ${e(c.account)} · all branches</small></div>
            <div class="card-b tight">${Views.historyTable(h)}</div></div>`)(Engine.clientHistory(c.account, app.id))}

          <div class="card"><div class="card-h"><h2>Beneficiary</h2></div><div class="card-b">
            ${kv([['Name', `${e(b.name)}${b.savedId && Beneficiaries.get(b.savedId) ? ` ${UI.tag('Saved beneficiary', 'blue')}` : ''}`], ['Address', e(b.address)], ['Country of remittance', e(b.country)], ['Product / service', e(b.product)], app.type === 'GIFTS' && ['Relationship', e(b.relationship)],
              b.bankName && ['Bank', e(b.bankName)], b.swift && ['SWIFT / BIC', `<span class="mono">${e(b.swift)}</span>`], b.accountNumber && ['Account / IBAN', `<span class="mono">${e(b.accountNumber)}</span>`]])}
          </div></div>

          ${typeDetails ? `<div class="card"><div class="card-h"><h2>${e(TXN_TYPES[app.type].category)} details</h2></div><div class="card-b">${typeDetails}</div></div>` : ''}

          <div class="card"><div class="card-h"><h2>Documents</h2><small>${docs.filter(r => r.required && r.present).length}/${docs.filter(r => r.required).length} required uploaded</small></div><div class="card-b">
            ${docs.length || extraDocs.length ? '' : '<div class="muted">No documents required for this type.</div>'}
            ${docs.map(r => `<div class="doc-slot ${r.required && !r.present ? 'missing' : ''}">
              <div class="head"><b>${r.present ? '<span class="ico ok" style="display:inline-grid">✓</span>' : r.required ? '<span class="ico no" style="display:inline-grid">✕</span>' : '<span class="ico opt" style="display:inline-grid">–</span>'} ${e(r.label)}</b>${UI.tag(r.required ? 'Required' : 'Optional', r.required ? 'red' : 'grey')}</div>
              ${r.note ? `<small>${e(r.note)}</small>` : ''}<div class="files">${fileList(r.files)}</div></div>`).join('')}
            ${extraDocs.length ? `<div class="doc-slot"><div class="head"><b>Other documents</b></div><div class="files">${fileList(extraDocs)}</div></div>` : ''}
          </div></div>

          ${app.authorisedAt ? `
          <div class="card"><div class="card-h"><h2>Treasury allocation</h2></div><div class="card-b tight">
            ${Allocation.summary(app)}
            ${app.allocations.length ? Allocation.table(app) : '<div class="empty">No foreign currency allocated yet. Allocation is not guaranteed.</div>'}
          </div></div>
          ${typeof Charges !== 'undefined' ? Charges.card(app) : ''}

          <div class="card"><div class="card-h"><h2>Exchange Control</h2></div><div class="card-b kv-cols">
            ${kv([['Recommendation', app.ec ? UI.tag(app.ec.recommendation, app.ec.recommendation === 'Not recommended' ? 'red' : app.ec.recommendation === 'Recommended' ? 'green' : 'amber') : '<span class="muted">Pending</span>'], app.ec?.note && ['Note', e(app.ec.note)], app.ec && ['By', `${e(UI.userName(app.ec.by))}, ${U.fmtDateTime(app.ec.at)}`]])}
            ${kv([['Assigned to', app.assignment ? `${e(Engine.assigneeName(app))} ${UI.tag(app.assignment.kind === 'BRANCH' ? 'Branch' : 'User', 'blue')}` : '<span class="muted">Not assigned</span>'], app.assignment?.note && ['Instruction', e(app.assignment.note)], app.assignment && ['By', `${e(UI.userName(app.assignment.by))}, ${U.fmtDateTime(app.assignment.at)}`]])}
          </div></div>

          ${app.payments.length ? `<div class="card"><div class="card-h"><h2>Payments</h2></div><div class="card-b tight"><div class="table-wrap"><table>
            <thead><tr><th>Date</th><th>Reference</th><th>Correspondent</th><th class="num">Amount</th><th class="num">Rate</th><th class="num">MWK</th><th>Outcome</th></tr></thead><tbody>
            ${app.payments.map(p => `<tr><td>${U.fmtDate(p.valueDate)}<br><small>${e(UI.userName(p.by))}</small></td><td class="mono">${e(p.reference)}</td><td>${e(Store.state.correspondents.find(x => x.id === p.correspondentId)?.name || '—')}</td><td class="num">${U.money(p.amount, app.currency)}</td><td class="num">${U.num(p.rate, 4)}</td><td class="num">${U.num(p.mwk)}</td><td>${p.reversed ? `${UI.tag('Reversed', 'red')}<br><small>${U.fmtDate(p.reversed.at)} · ${e(p.reversed.reason)}</small>` : p.outcome === 'FULL' ? UI.tag('Fully paid', 'green') : UI.tag('Partly paid', 'amber')}</td></tr>`).join('')}
            </tbody></table></div></div></div>` : ''}

          ${app.recon ? `<div class="card"><div class="card-h"><h2>Advance payment reconciliation</h2></div><div class="card-b">
            ${kv([['Expected reconciliation', `${U.fmtDate(app.recon.dueDate)} <small>(${Store.state.settings.reconDays} days from full payment)</small>`], ['Status', app.recon.status !== 'RECONCILED' ? (U.daysBetween(Store.now(), app.recon.dueDate) < 0 ? UI.tag(`Overdue by ${-U.daysBetween(Store.now(), app.recon.dueDate)} days`, 'red') : UI.tag(`Pending – ${U.daysBetween(Store.now(), app.recon.dueDate)} days left`, 'amber')) : UI.tag(`Reconciled ${U.fmtDate(app.recon.reconciledAt)}`, 'green')],
              ['Reminders', `2 per week in the 2 weeks before the due date (days ${Store.state.settings.reconPreDueOffsets.join(', ')} before), then every ${Store.state.settings.reconOverdueEveryDays} days until reconciled.`]])}
          </div></div>` : ''}` : ''}

          <div class="card"><div class="card-h"><h2>Notifications sent</h2><small>${msgs.length}</small></div><div class="card-b tight">
            ${msgs.length ? `<div class="table-wrap"><table><thead><tr><th>Sent</th><th>To</th><th>Channel</th><th>Subject</th></tr></thead><tbody>
            ${msgs.map(m => `<tr class="click" data-msg="${m.id}"><td class="nowrap">${U.fmtDateTime(m.at)}</td><td>${e(m.toLabel)}<br><small>${e(m.to)}</small></td><td>${UI.tag(m.channel, m.audience === 'Client' ? 'blue' : 'grey')}</td><td>${e(m.subject)}</td></tr>`).join('')}
            </tbody></table></div>` : '<div class="empty">No notifications yet.</div>'}
          </div></div>

          ${(trail => `<div class="card" id="audit-card"><div class="card-h"><h2>Audit trail</h2><span class="btn-row"><small>${trail.length} entries</small>${Export.button()}</span></div><div class="card-b tight">
            <div class="table-wrap"><table><thead><tr><th>Date & time</th><th>User</th><th>Role</th><th>Action</th><th>Details & field changes</th></tr></thead><tbody>
            ${trail.map(x => `<tr><td class="nowrap">${U.fmtDateTime(x.at)}</td><td>${e(x.userName)}</td><td>${e(ROLES[x.role] || 'System')}</td><td>${e(Views.actionLabel(x.action))}</td>
              <td>${e(x.details)}${(x.changes || []).map(c => `<div><small>${e(c.field)}: ${c.from !== '' ? `<del style="color:var(--red-fg)">${e(c.from)}</del>` : '<i class="muted">blank</i>'} → ${c.to !== '' ? `<b style="color:var(--green-fg)">${e(c.to)}</b>` : '<i class="muted">blank</i>'}</small></div>`).join('')}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No entries.</td></tr>'}
            </tbody></table></div></div></div>`)(Views.recordAudit(app))}
        </div>

        <div class="side">
          <div class="card"><div class="card-h"><h2>Actions</h2><small>${e(ROLES[u.role])}</small></div><div class="card-b">${Views.actionButtons(app)}</div></div>
          <div class="card"><div class="card-h"><h2>History & comments</h2></div><div class="card-b">${Views.timeline(app)}</div></div>
        </div>
      </div>`;

    const view = document.getElementById('view');
    DocView.bind(view, app.documents);
    view.querySelectorAll('[data-msg]').forEach(tr => tr.addEventListener('click', () => Views.showMessage(Store.state.outbox.find(m => m.id === tr.dataset.msg))));
    view.querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', () => Actions[btn.dataset.action](app)));
    Export.attach(U.$('#audit-card'), () => Views.recordAuditModel(app));
  },

  /* Full audit trail of one record, oldest first – visible to anyone who can open the record. */
  recordAudit(app) {
    return Store.state.audit.filter(x => x.appId === app.id).sort((a, b) => a.at.localeCompare(b.at));
  },

  recordAuditModel(app) {
    const c = app.customer || {};
    return {
      title: `Audit trail – ${app.ref}`,
      subtitle: `${c.name || ''} (${c.account || ''}) · ${UI.typeLabel(app.type)} · ${U.money(app.amount, app.currency)} · ${UI.branchName(app.branchId)} · ${STATUS[app.status].label}`,
      filename: `audit_${app.ref}`,
      sections: [
        { heading: 'Audit trail', columns: Reports.auditColumns.filter(col => col.label !== 'Reference'), rows: this.recordAudit(app).map(x => Reports.auditRow(x).filter((_, i) => i !== 4)) },
        { heading: 'Comments', columns: [{ label: 'Date & time' }, { label: 'User' }, { label: 'Role' }, { label: 'Type' }, { label: 'Comment' }],
          rows: [...app.comments].sort((a, b) => a.at.localeCompare(b.at)).map(x => [U.fmtDateTime(x.at), x.userName, ROLES[x.role] || 'System', x.kind, x.text]) },
        { heading: 'Notifications sent', columns: [{ label: 'Sent' }, { label: 'To' }, { label: 'Address' }, { label: 'Channel' }, { label: 'Subject' }],
          rows: Store.state.outbox.filter(m => m.appId === app.id).sort((a, b) => a.at.localeCompare(b.at)).map(m => [U.fmtDateTime(m.at), m.toLabel, m.to, m.channel, m.subject]) },
      ],
    };
  },

  actionButtons(app) {
    const can = a => Engine.can(a, app);
    const t = Engine.totals(app);
    const btn = (action, label, cls = '') => `<button class="${cls}" data-action="${action}" style="width:100%;justify-content:center">${label}</button>`;
    const out = [];
    if (can('edit')) out.push(`<a class="btn" href="#/edit/${app.id}" style="width:100%;justify-content:center">✎ Edit application</a>`);
    if (can('submit')) out.push(btn('submit', 'Submit for review', 'btn-primary'));
    if (can('reopen')) out.push(btn('reopen', app.status === 'PENDING_AUTH' ? 'Recall & reopen for editing' : 'Reopen application'));
    if (can('inputReject')) out.push(btn('inputReject', '✕ Reject – unreconciled items', 'btn-danger'));
    if (can('discard')) out.push(btn('discard', 'Discard draft', 'btn-danger'));
    if (can('authorise')) out.push(btn('authorise', '✓ Authorise', 'btn-success'));
    if (can('reject')) out.push(btn('reject', '✕ Reject…', 'btn-danger'));
    const me = Store.user();
    if (me.role === 'AUTHORISER' && app.status === 'PENDING_AUTH' && app.createdBy === me.id) out.push('<div class="alert warn">You captured this application, so another authoriser must authorise it.</div>');
    if (me.role === 'AUTHORISER' && app.status === 'PENDING_AUTH' && !Engine.inBranch(me, app.branchId)) out.push(`<div class="alert warn">Only an authoriser at ${U.esc(UI.branchName(app.branchId))} can authorise this application.</div>`);
    if (can('allocate')) out.push(btn('allocate', `Allocate forex (${U.money(t.unallocated, app.currency)} unallocated)`, 'btn-primary'));
    if (can('confirmFunding')) out.push(btn('confirmFunding', 'Mark as funded', 'btn-success'));
    else if (Engine.fundingBlockReason(app)) out.push(`<div class="alert warn">${U.esc(Engine.fundingBlockReason(app))}</div>`);
    if (Engine.travelPayoutNote(app)) out.push(`<div class="alert info">${U.esc(Engine.travelPayoutNote(app))}</div>`);
    if (can('forfeit')) out.push(btn('forfeit', 'Forfeit allocation', 'btn-danger'));
    if (can('recommend')) out.push(btn('recommend', app.ec ? 'Change recommendation' : 'Give recommendation', app.ec ? '' : 'btn-primary'));
    if (can('assign')) out.push(btn('assign', app.assignment ? 'Reassign' : 'Assign for processing'));
    if (can('pay')) out.push(btn('pay', 'Record payment (fully / partly paid)', 'btn-primary'));
    if (can('reconcile')) out.push(btn('reconcile', 'Mark as reconciled', 'btn-success'));
    if (can('comment')) out.push(btn('comment', 'Add comment'));
    const waiting = {
      PENDING_AUTH: 'Waiting for an authoriser.',
      AWAITING_ALLOCATION: 'Waiting for Treasury to allocate forex. Allocation is not guaranteed.',
      ALLOCATED: 'Waiting for the client to fund the account before the cut-off.',
      FUNDED: Rules.isTravel(app) ? `Funded. Waiting for ${UI.branchName(app.branchId)} to pay out.` : 'Funded. Waiting for Exchange Control / the assignee to process.',
      PARTLY_PAID: 'Balance outstanding. Waiting for a further allocation.',
    }[app.status];
    return `<div style="display:flex;flex-direction:column;gap:8px">${out.join('') || `<div class="muted">No actions for your role at this stage.</div>`}
      ${waiting ? `<div class="alert info" style="margin-top:4px">${waiting}</div>` : ''}</div>`;
  },

  timeline(app) {
    const items = [
      ...Store.state.audit.filter(e => e.appId === app.id).map(e => ({ at: e.at, kind: 'audit', e })),
      ...app.comments.map(c => ({ at: c.at, kind: 'comment', c })),
    ].sort((a, b) => b.at.localeCompare(a.at));
    if (!items.length) return '<div class="muted">No history.</div>';
    return `<ul class="timeline">${items.map(i => {
      if (i.kind === 'comment') {
        const c = i.c;
        return `<li class="cm"><div class="what">${U.esc(c.kind)}</div><div class="meta">${U.esc(c.userName)} · ${U.esc(ROLES[c.role] || 'System')} · ${U.fmtDateTime(c.at)}</div><div class="txt">${U.esc(c.text)}</div></li>`;
      }
      const e = i.e;
      return `<li class="${e.role === 'SYSTEM' ? 'sys' : ''}"><div class="what">${U.esc(Views.actionLabel(e.action))}</div>
        <div class="meta">${U.esc(e.userName)} · ${U.fmtDateTime(e.at)}</div>
        ${e.details && e.action !== 'COMMENTED' ? `<div class="chg">${U.esc(e.details)}</div>` : ''}
        ${(e.changes || []).map(ch => `<div class="chg">${U.esc(ch.field)}: ${ch.from !== '' ? `<del>${U.esc(ch.from)}</del>` : ''} ${ch.to !== '' ? `→ <ins>${U.esc(ch.to)}</ins>` : ''}</div>`).join('')}</li>`;
    }).join('')}</ul>`;
  },

  showMessage(m) {
    if (!m) return;
    const u = Store.user();
    if (m.userIds?.includes(u.id) && !m.readBy.includes(u.id)) { m.readBy.push(u.id); Store.save(); App.renderChrome(); }
    UI.modal({
      title: m.subject, wide: true, closeLabel: 'Close',
      body: `<dl class="kv" style="margin-bottom:12px">${m.from ? `<dt>From</dt><dd>${U.esc(m.from)} ${UI.tag('No-reply', 'grey')}</dd>` : ''}<dt>To</dt><dd>${U.esc(m.toLabel)} &lt;${U.esc(m.to)}&gt;</dd><dt>Channel</dt><dd>${U.esc(m.channel)} · ${U.esc(m.audience)}</dd><dt>Sent</dt><dd>${U.fmtDateTime(m.at)}</dd><dt>Template</dt><dd>${U.esc(m.template)}</dd>${m.ref ? `<dt>Application</dt><dd><a href="#/app/${m.appId}" data-close>${U.esc(m.ref)}</a></dd>` : ''}</dl><div class="msg-body">${U.esc(m.body)}</div>`,
    });
  },

  /* ---------------- messages ---------------- */
  messages(tab = 'inbox') {
    const u = Store.user();
    if (tab === 'outbox' && !Access.has(u, 'view.outbox')) tab = 'inbox';
    UI.setTitle('Messages', 'Notifications');
    const f = Views.msgFilter = Views.msgFilter || { q: '', audience: '' };
    document.getElementById('view').innerHTML = `
      <div class="tabs"><a href="#/messages/inbox" class="${tab === 'inbox' ? 'active' : ''}">My inbox (${Engine.unreadCount()} unread)</a>${Access.has(u, 'view.outbox') ? `<a href="#/messages/outbox" class="${tab === 'outbox' ? 'active' : ''}">All outgoing messages</a>` : ''}</div>
      ${tab === 'outbox' ? '<div class="alert info" style="margin-bottom:12px">Prototype: emails and SMS are not actually sent. This log shows exactly what would go out, to whom, and when. Wording comes from the templates in Admin.</div>' : ''}
      <div class="toolbar">
        <input type="search" id="mf-q" placeholder="Search subject, recipient, reference…" value="${U.esc(f.q)}">
        ${tab === 'outbox' ? `<select id="mf-aud"><option value="">Clients & staff</option><option ${f.audience === 'Client' ? 'selected' : ''}>Client</option><option ${f.audience === 'Staff' ? 'selected' : ''}>Staff</option></select>` : ''}
        <span class="grow"></span>
        ${tab === 'inbox' ? '<button id="mf-read">Mark all as read</button>' : ''}
      </div>
      <div class="card"><div class="card-b tight" id="mf-table"></div></div>`;
    const draw = () => {
      const term = f.q.trim().toLowerCase();
      let rows = tab === 'inbox' ? Engine.inbox(u) : [...Store.state.outbox].sort((a, b) => b.at.localeCompare(a.at));
      rows = rows.filter(m => (tab === 'inbox' || !f.audience || m.audience === f.audience)
        && (!term || [m.subject, m.to, m.toLabel, m.ref].some(x => String(x || '').toLowerCase().includes(term))));
      U.$('#mf-table').innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Sent</th><th>To</th><th>Channel</th><th>Subject</th><th>Ref</th></tr></thead><tbody>
        ${rows.slice(0, 500).map(m => `<tr class="click" data-msg="${m.id}" style="${tab === 'inbox' && !m.readBy.includes(u.id) ? 'font-weight:600' : ''}"><td class="nowrap">${U.fmtDateTime(m.at)}</td><td>${U.esc(m.toLabel)}<br><small>${U.esc(m.to)}</small></td><td>${UI.tag(m.channel, m.audience === 'Client' ? 'blue' : 'grey')}</td><td>${U.esc(m.subject)}</td><td class="mono">${U.esc(m.ref || '')}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">No messages.</div>';
      U.$$('#mf-table [data-msg]').forEach(tr => tr.addEventListener('click', () => { Views.showMessage(Store.state.outbox.find(m => m.id === tr.dataset.msg)); if (tab === 'inbox') draw(); }));
    };
    U.$('#mf-q').addEventListener('input', e => { f.q = e.target.value; draw(); });
    U.$('#mf-aud')?.addEventListener('change', e => { f.audience = e.target.value; draw(); });
    U.$('#mf-read')?.addEventListener('click', () => { Engine.inbox(u).forEach(m => { if (!m.readBy.includes(u.id)) m.readBy.push(u.id); }); Store.save(); App.render(); });
    draw();
  },
};

/* Workflow action dialogs. Each calls one Engine method then re-renders. */
const Actions = {
  done(msg) { UI.toast(msg, 'ok'); App.render(); },

  submit(app) {
    const v = Rules.validate(app);
    if (v.errors.length) { UI.toast(`Fix ${v.errors.length} issue(s) before submitting – see Validation.`, 'error'); return; }
    UI.modal({
      title: `Submit ${app.ref} for review`,
      body: `${v.warnings.map(w => `<div class="alert warn">! ${U.esc(w.msg)}</div>`).join('')}<label class="f" style="margin-top:10px"><span>Comment to authoriser (optional)</span><textarea name="comment"></textarea></label>`,
      actions: [{ label: 'Submit', onClick: el => { Engine.submit(app, UI.formData(el).comment); Actions.done('Submitted for authorisation.'); } }],
    });
  },

  inputReject(app) {
    const items = Engine.unreconciledFor(app);
    UI.modal({
      title: `Reject ${app.ref} – unreconciled items`,
      body: `<div class="alert error" style="margin-bottom:10px"><div>The client has ${items.length} unreconciled advance payment(s): ${items.map(a => `<b class="mono">${U.esc(a.ref)}</b> (due ${U.fmtDate(a.recon.dueDate)})`).join(', ')}.</div></div>
        <label class="f"><span>Reason (internal) <b class="req">*</b></span><textarea name="reason" rows="2">Client has unreconciled advance payment(s): ${U.esc(items.map(a => a.ref).join(', '))}</textarea></label>
        <label class="f" style="margin-top:10px"><span>Message to client</span><textarea name="clientMessage" rows="7">${U.esc(Engine.unreconciledMessage(items))}</textarea><div class="hint">Sent by email, or by SMS if there is no email. The application is kept in the client's history.</div></label>`,
      actions: [{ label: 'Reject & advise client', cls: 'btn-danger', onClick: el => {
        Engine.inputReject(app, UI.formData(el));
        UI.toast(`${app.ref} rejected. The client has been advised.`, 'ok');
        location.hash = `#/app/${app.id}`;
        App.render();
      } }],
    });
  },

  reopen(app) {
    UI.modal({
      title: `Reopen ${app.ref}`,
      body: `<p>${app.status === 'PENDING_AUTH' ? 'This takes the application back from the authorisation queue so you can edit it. You will need to resubmit it.' : 'This reopens the rejected application as a draft so you can correct it and resubmit.'}</p><label class="f"><span>Reason <b class="req">*</b></span><textarea name="reason"></textarea></label>`,
      actions: [{ label: 'Reopen', onClick: el => {
        const { reason } = UI.formData(el);
        if (!reason.trim()) { UI.toast('Give a reason.', 'error'); return false; }
        Engine.reopen(app, reason);
        location.hash = `#/edit/${app.id}`;
        UI.toast('Reopened as draft.', 'ok');
      } }],
    });
  },

  async discard(app) {
    if (await UI.confirm('Discard draft?', `<p>${U.esc(app.ref)} will be removed. The audit trail keeps a record that it was discarded.</p>`, 'Discard', 'btn-danger')) {
      Engine.discard(app);
      UI.toast('Draft discarded.', 'ok');
      location.hash = '#/apps/mine';
    }
  },

  authorise(app) {
    const v = Rules.validate(app);
    if (v.errors.length) { UI.toast(`This application has ${v.errors.length} validation issue(s). Edit it or return it to the inputter.`, 'error'); return; }
    UI.modal({
      title: `Authorise ${app.ref}`,
      body: `<div class="alert info">Once authorised, Treasury and Exchange Control are notified, and the client is sent an acknowledgement saying the application is waiting for allocation, which is not guaranteed.</div>
        ${v.warnings.map(w => `<div class="alert warn">! ${U.esc(w.msg)}</div>`).join('')}
        <label class="f" style="margin-top:10px"><span>Comment (optional)</span><textarea name="comment"></textarea></label>`,
      actions: [{ label: 'Authorise', cls: 'btn-success', onClick: el => { Engine.authorise(app, UI.formData(el).comment); Actions.done('Authorised. Treasury, Exchange Control and the client have been notified.'); } }],
    });
  },

  reject(app) {
    UI.modal({
      title: `Reject ${app.ref}`,
      body: `<div class="radio-row" style="margin-bottom:12px">
          <label class="radio-card"><input type="radio" name="mode" value="RETURN" checked><span><b>Send back to inputter</b><small>For corrections. The inputter edits it and resubmits.</small></span></label>
          <label class="radio-card"><input type="radio" name="mode" value="CLIENT"><span><b>Reject & advise client</b><small>Closes the application and sends your message to the client.</small></span></label>
        </div>
        <label class="f"><span>Comment (reason) <b class="req">*</b></span><textarea name="comment" rows="3"></textarea></label>
        <label class="f hidden" id="cm-wrap" style="margin-top:10px"><span>Message to client: what they should do</span><textarea name="clientMessage" rows="4" placeholder="e.g. Please bring a valid student visa and the latest fees structure to the branch, then reapply."></textarea><div class="hint">Leave blank to send the comment above. Sent by email, or by SMS if there is no email.</div></label>`,
      onOpen: el => el.querySelectorAll('[name=mode]').forEach(r => r.addEventListener('change', () => U.$('#cm-wrap', el).classList.toggle('hidden', UI.formData(el).mode !== 'CLIENT'))),
      actions: [{ label: 'Reject', cls: 'btn-danger', onClick: el => {
        const d = UI.formData(el);
        if (!d.comment.trim()) { UI.toast('A comment is required.', 'error'); return false; }
        Engine.reject(app, d);
        Actions.done(d.mode === 'RETURN' ? 'Returned to inputter.' : 'Rejected. The client has been advised.');
      } }],
    });
  },

  allocate(app) {
    const t = Engine.totals(app);
    const s = Store.state.settings;
    const indicative = s.rates[app.currency] || '';
    const cross = app.currency !== 'USD' && s.rates[app.currency] ? (s.rates[app.currency] / s.rates.USD).toFixed(4) : '';
    const deadline = Engine.fundingDeadline();
    UI.modal({
      title: `Allocate forex – ${app.ref}`,
      body: `<div class="grid g2">
          <label class="f"><span>Amount to allocate (${app.currency}) <b class="req">*</b></span><input name="amount" type="number" step="0.01" value="${t.unallocated}"><div class="hint">Unallocated: ${U.money(t.unallocated, app.currency)}</div></label>
          <label class="f"><span>Value date</span><input name="valueDate" type="date" value="${U.dayKey(Store.now())}"></label>
          <label class="f"><span>Rate (MWK per 1 ${app.currency}) <b class="req">*</b></span><input name="rate" type="number" step="0.0001" value="${indicative}"><div class="hint">Indicative: ${U.num(indicative, 4)}</div></label>
          <label class="f"><span>Cross rate ${app.currency !== 'USD' ? `(${app.currency}/USD)` : ''}</span><input name="crossRate" type="number" step="0.0001" value="${cross}"><div class="hint">Leave blank if not applicable</div></label>
          <label class="f span-all"><span>Note</span><input name="note"></label>
        </div>
        <div class="alert info" style="margin-top:12px" id="al-prev"></div>`,
      onOpen: el => {
        const upd = () => {
          const d = UI.formData(el);
          U.$('#al-prev', el).innerHTML = `Client must provide <b>MWK ${U.num((Number(d.amount) || 0) * (Number(d.rate) || 0))}</b> and fund account ${U.esc(app.customer.account)} by <b>${U.fmtDateTime(deadline)}</b>, or the allocation is forfeited. The client is notified now.`;
        };
        el.querySelectorAll('input').forEach(i => i.addEventListener('input', upd));
        upd();
      },
      actions: [{ label: 'Allocate & notify client', onClick: el => { Engine.allocate(app, UI.formData(el)); Actions.done('Forex allocated. The client has been asked to fund the account.'); } }],
    });
  },

  confirmFunding(app) {
    const al = app.allocations.find(a => a.status === 'AWAITING_FUNDING');
    UI.modal({
      title: 'Confirm account funded',
      body: `<p>Confirm that account <b>${U.esc(app.customer.account)}</b> has been funded with <b>MWK ${U.num(al.amount * al.rate)}</b> for the allocation of ${U.money(al.amount, app.currency)} (deadline ${U.fmtDateTime(al.deadline)}).</p>
        <div class="alert info" style="margin-bottom:10px">Exchange Control${app.assignment ? ` and ${U.esc(Engine.assigneeName(app))}` : ''} will be notified that the transaction is ready to process.</div>
        <label class="f"><span>Comment (optional)</span><textarea name="comment" placeholder="e.g. Deposit slip / transfer reference"></textarea></label>`,
      actions: [{ label: 'Mark funded & notify Exchange Control', cls: 'btn-success', onClick: el => { Engine.confirmFunding(app, UI.formData(el).comment); Actions.done('Marked as funded. Exchange Control has been notified.'); } }],
    });
  },

  forfeit(app) {
    UI.modal({
      title: 'Forfeit allocation',
      body: `<p>Allocations that are not funded are forfeited automatically at the deadline. Use this to release one early.</p><label class="f"><span>Reason <b class="req">*</b></span><textarea name="reason"></textarea></label>`,
      actions: [{ label: 'Forfeit & notify client', cls: 'btn-danger', onClick: el => {
        const { reason } = UI.formData(el);
        if (!reason.trim()) { UI.toast('Give a reason.', 'error'); return false; }
        Engine.forfeit(app, reason);
        Actions.done('Allocation forfeited.');
      } }],
    });
  },

  recommend(app) {
    UI.modal({
      title: `Exchange Control review – ${app.ref}`,
      body: `<div class="radio-row" style="margin-bottom:12px">${RECOMMENDATIONS.map((r, i) => `<label class="radio-card"><input type="radio" name="recommendation" value="${r}" ${(app.ec?.recommendation || RECOMMENDATIONS[0]) === r ? 'checked' : ''}><span><b>${r}</b></span></label>`).join('')}</div>
        <label class="f"><span>Recommendation note</span><textarea name="note" rows="3">${U.esc(app.ec?.note || '')}</textarea></label>`,
      actions: [{ label: 'Save recommendation', onClick: el => { Engine.recommend(app, UI.formData(el)); Actions.done('Recommendation saved.'); } }],
    });
  },

  assign(app) {
    const S = Store.state;
    UI.modal({
      title: `Assign ${app.ref} for processing`,
      body: `<div class="radio-row" style="margin-bottom:12px">
          <label class="radio-card"><input type="radio" name="kind" value="SELF" checked><span><b>Myself</b></span></label>
          <label class="radio-card"><input type="radio" name="kind" value="USER"><span><b>A user</b></span></label>
          <label class="radio-card"><input type="radio" name="kind" value="BRANCH"><span><b>A branch</b></span></label></div>
        <label class="f hidden" id="as-user"><span>User</span><select name="userId">${S.users.filter(u => u.role !== 'ADMIN' && u.active !== false).map(u => `<option value="${u.id}">${U.esc(u.name)} – ${ROLES[u.role]}, ${U.esc(UI.branchName(u.branchId))}</option>`).join('')}</select></label>
        <label class="f hidden" id="as-branch"><span>Branch</span><select name="branchId">${S.branches.map(b => `<option value="${b.id}" ${b.id === app.branchId ? 'selected' : ''}>${U.esc(b.name)}</option>`).join('')}</select></label>
        <label class="f" style="margin-top:10px"><span>Instruction (optional)</span><textarea name="note"></textarea></label>`,
      onOpen: el => el.querySelectorAll('[name=kind]').forEach(r => r.addEventListener('change', () => {
        const k = UI.formData(el).kind;
        U.$('#as-user', el).classList.toggle('hidden', k !== 'USER');
        U.$('#as-branch', el).classList.toggle('hidden', k !== 'BRANCH');
      })),
      actions: [{ label: 'Assign', onClick: el => { Engine.assign(app, UI.formData(el)); Actions.done('Assigned.'); } }],
    });
  },

  pay(app) {
    const t = Engine.totals(app);
    UI.modal({
      title: `Record payment – ${app.ref}`,
      body: `<div class="radio-row" style="margin-bottom:12px">
          <label class="radio-card"><input type="radio" name="outcome" value="${t.fundedUnpaid >= t.balance - 0.005 ? 'FULL' : 'PART'}" checked><span><b>${t.fundedUnpaid >= t.balance - 0.005 ? 'Fully paid' : 'Partly paid'}</b><small>${t.fundedUnpaid >= t.balance - 0.005 ? 'Closes the record and notifies the client, the inputter and the branch.' : `Balance of ${U.money(t.balance - t.fundedUnpaid, app.currency)} still required.`}</small></span></label>
          <label class="radio-card"><input type="radio" name="outcome" value="${t.fundedUnpaid >= t.balance - 0.005 ? 'PART' : 'FULL'}"><span><b>${t.fundedUnpaid >= t.balance - 0.005 ? 'Partly paid' : 'Fully paid – close short'}</b><small>${t.fundedUnpaid >= t.balance - 0.005 ? 'Pay less than the balance; the rest stays outstanding.' : 'Close the record at the amount paid and cancel the rest.'}</small></span></label></div>
        <div class="grid g2">
          <label class="f"><span>Amount paid (${app.currency}) <b class="req">*</b></span><input name="amount" type="number" step="0.01" value="${t.fundedUnpaid}"><div class="hint">Funded and available: ${U.money(t.fundedUnpaid, app.currency)}</div></label>
          <label class="f"><span>Value date</span><input name="valueDate" type="date" value="${U.dayKey(Store.now())}"></label>
          <label class="f"><span>Payment reference (e.g. MT103) <b class="req">*</b></span><input name="reference"></label>
          <label class="f"><span>Correspondent bank</span><select name="correspondentId"><option value="">—</option>${Store.state.correspondents.map(c => `<option value="${c.id}">${U.esc(c.name)} (${U.esc(c.currencies)})</option>`).join('')}</select></label>
          <label class="f span-all"><span>Comment</span><textarea name="comment"></textarea></label>
        </div>
        ${app.type === 'ADVANCE' ? `<div class="alert info" style="margin-top:10px">Advance payment: once fully paid, the expected reconciliation date is set to ${Store.state.settings.reconDays} days from today and reminders are scheduled.</div>` : ''}`,
      actions: [{ label: 'Record payment & notify', onClick: async el => {
        const d = UI.formData(el);
        const after = t.paid + Number(d.amount);
        if (d.outcome === 'FULL' && after < app.amount - 0.005) {
          const ok = await UI.confirm('Close short?', `<p>Total paid will be ${U.money(after, app.currency)}, which is less than the ${U.money(app.amount, app.currency)} applied. Closing cancels the remaining ${U.money(app.amount - after, app.currency)}.</p>`, 'Close short', 'btn-danger');
          if (!ok) return false;
        }
        Engine.recordPayment(app, d);
        Actions.done('Payment recorded. Client, inputter and branch notified.');
      } }],
    });
  },

  reconcile(app) {
    let uploaded = [];
    UI.modal({
      title: `Reconcile advance payment ${app.ref}`,
      body: `<p>Confirm the import documents have been received and match the advance payment of ${U.money(app.amount, app.currency)}.</p>
        <label class="f"><span>Reconciliation documents (optional)</span><input type="file" id="rc-files" multiple accept=".pdf,image/*,.doc,.docx,.xls,.xlsx,.csv,.txt"></label>
        <label class="f" style="margin-top:10px"><span>Comment <b class="req">*</b></span><textarea name="comment" placeholder="e.g. Bill of entry no. … and final invoice received"></textarea></label>`,
      onOpen: el => U.$('#rc-files', el).addEventListener('change', async e => {
        uploaded = [];
        try { for (const f of e.target.files) uploaded.push(await Form.storeFile(f, 'RECON')); }
        catch (err) { uploaded = []; e.target.value = ''; UI.error(err); }   // e.g. refused by the security check
      }),
      actions: [{ label: 'Mark reconciled', cls: 'btn-success', onClick: el => {
        const { comment } = UI.formData(el);
        if (!comment.trim()) { UI.toast('Add a comment.', 'error'); return false; }
        Engine.reconcile(app, { comment, documents: uploaded });
        Actions.done('Marked as reconciled. Reminders stopped.');
      } }],
    });
  },

  comment(app) {
    UI.modal({
      title: 'Add comment',
      body: '<label class="f"><span>Comment</span><textarea name="text" rows="4"></textarea></label>',
      actions: [{ label: 'Add', onClick: el => {
        const { text } = UI.formData(el);
        if (!text.trim()) return false;
        Engine.comment(app, text);
        Actions.done('Comment added.');
      } }],
    });
  },
};
