'use strict';

/* Reports → All transactions: every application in one list, filtered by advance-payment reconciliation
   (all / advance / reconciled / not reconciled / overdue / under review / declined / not yet paid / non-advance),
   transaction type, status, branch and a date (applied, paid or reconciled, or any date). Branch staff see their own
   branch unless they also have "Applications from all branches", as in the other reports. */

const ALLTX_RECON = [
  ['', 'All transactions'],
  ['ADV', 'Advance payments – all'],
  ['ADV_REC', 'Advance – reconciled'],
  ['ADV_UNREC', 'Advance – not reconciled'],
  ['ADV_OVERDUE', 'Advance – reconciliation overdue'],
  ['ADV_REVIEW', 'Advance – documents under review'],
  ['ADV_DECLINED', 'Advance – declined by Exchange Control'],
  ['ADV_UNPAID', 'Advance – not yet fully paid'],
  ['OTHER', 'All except advance payments'],
];

const AllTx = {
  state: null,

  reconLabel(a) {
    if (a.type !== 'ADVANCE') return 'Not applicable';
    if (!a.recon) return 'Not yet fully paid';
    return RECON_STATUS[a.recon.status]?.label || a.recon.status;
  },

  reconMatch(a, k, today) {
    const adv = a.type === 'ADVANCE', st = a.recon?.status;
    switch (k) {
      case 'ADV': return adv;
      case 'ADV_REC': return adv && st === 'RECONCILED';
      case 'ADV_UNREC': return adv && !!a.recon && st !== 'RECONCILED';
      case 'ADV_OVERDUE': return adv && !!a.recon && st !== 'RECONCILED' && a.recon.dueDate < today;
      case 'ADV_REVIEW': return adv && ['SUBMITTED', 'REVIEW'].includes(st);
      case 'ADV_DECLINED': return adv && st === 'DECLINED';
      case 'ADV_UNPAID': return adv && !a.recon;
      case 'OTHER': return !adv;
      default: return true;
    }
  },

  /* The date the period filter looks at. */
  dateOf(a, basis) {
    if (basis === 'applied') return [Engine.appliedAt(a)];
    if (basis === 'paid') return (a.payments || []).map(p => p.valueDate);
    if (basis === 'reconciled') return a.recon?.reconciledAt ? [a.recon.reconciledAt] : [];
    return null;
  },

  report() {
    const f = this.state = this.state || { recon: '', type: '', status: '', basis: 'any', q: '' };
    const root = U.$('#rep'), e = U.esc;
    const draw = () => {
      const pb = Reports.periodBar('alltx', draw);
      const today = U.dayKey(Store.now()), q = f.q.trim().toLowerCase();
      const rows = Store.state.apps.filter(a => a.ref && pb.match(a)
        && this.reconMatch(a, f.recon, today)
        && (!f.type || a.type === f.type)
        && (!f.status || a.status === f.status)
        && (f.basis === 'any' || this.dateOf(a, f.basis).some(d => d && Reports.inRange(d, pb.from, pb.to)))
        && (q.length < 2 || (typeof Recon !== 'undefined' ? Recon.matches(a, f.q.trim()) : `${a.ref} ${a.customer.name} ${a.customer.account}`.toLowerCase().includes(q))))
        .sort((x, y) => (Engine.appliedAt(y) || '').localeCompare(Engine.appliedAt(x) || ''));
      const adv = rows.filter(a => a.type === 'ADVANCE');
      const usd = U.sum(rows, a => Rules.toUSD(a.amount, a.currency));
      const paidUsd = U.sum(rows, a => Rules.toUSD(Engine.totals(a).paid, a.currency));
      const shown = rows.slice(0, 500);
      const opt = (list, cur) => list.map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${e(l)}</option>`).join('');
      root.innerHTML = `
        <div class="toolbar">
          <select id="ax-recon" aria-label="Transactions">${opt(ALLTX_RECON, f.recon)}</select>
          <select id="ax-type" aria-label="Type">${opt([['', 'All types'], ...Object.entries(TXN_TYPES).map(([k, t]) => [k, t.label])], f.type)}</select>
          <select id="ax-status" aria-label="Status">${opt([['', 'All statuses'], ...Object.entries(STATUS).map(([k, s]) => [k, s.label])], f.status)}</select>
          <select id="ax-basis" aria-label="Date">${opt([['any', 'Any date'], ['applied', 'Applied in the period'], ['paid', 'Paid in the period'], ['reconciled', 'Reconciled in the period']], f.basis)}</select>
          <input type="search" id="ax-q" value="${e(f.q)}" placeholder="Client, account, ID, phone, email, SWIFT or reference">
        </div>
        ${pb.html.replace('<div class="toolbar">', `<div class="toolbar" style="${f.basis === 'any' ? 'opacity:.55' : ''}">`)}
        <div class="kpis">
          <div class="kpi"><div class="v">${rows.length}</div><div class="l">Transactions</div></div>
          <div class="kpi violet"><div class="v">${U.num(usd, 0)}</div><div class="l">Applied ≈ USD</div></div>
          <div class="kpi green"><div class="v">${U.num(paidUsd, 0)}</div><div class="l">Paid ≈ USD</div></div>
          <div class="kpi amber"><div class="v">${adv.filter(a => a.recon && a.recon.status !== 'RECONCILED').length} / ${adv.filter(a => a.recon?.status === 'RECONCILED').length}</div><div class="l">Advance not reconciled / reconciled</div></div>
        </div>
        <div class="card"><div class="card-h"><h2>Transactions</h2><small>${rows.length > shown.length ? `First ${shown.length} of ${rows.length} shown – export for all` : ''}</small></div><div class="card-b tight"><div class="table-wrap"><table>
          <thead><tr><th>Applied</th><th>Reference</th><th>Client</th><th>Type</th><th>Branch</th><th class="num">Amount</th><th class="num">Paid</th><th>Status</th><th>Reconciliation</th><th>Due</th><th>Reconciled</th></tr></thead>
          <tbody>${shown.map(a => { const t = Engine.totals(a), r = a.recon, od = r && r.status !== 'RECONCILED' && r.dueDate < today;
            return `<tr><td class="nowrap">${U.fmtDate(Engine.appliedAt(a))}</td><td>${Engine.can('view', a) ? `<a class="mono" href="#/app/${a.id}">${e(a.ref)}</a>` : `<span class="mono">${e(a.ref)}</span>`}</td>
              <td>${e(a.customer.name)}<br><small class="mono">${e(a.customer.account)}</small></td><td>${e(UI.typeLabel(a.type))}</td><td>${e(UI.branchName(a.branchId))}</td>
              <td class="num">${U.money(a.amount, a.currency)}</td><td class="num">${t.paid ? U.num(t.paid) : '—'}</td><td>${UI.badge(a.status)}</td>
              <td>${a.type === 'ADVANCE' ? (r ? `<a href="#/recon/${a.id}">${UI.tag(this.reconLabel(a), RECON_STATUS[r.status]?.tone || 'grey')}</a>` : UI.tag('Not yet fully paid', 'grey')) : '<span class="muted">—</span>'}</td>
              <td class="nowrap">${r ? U.fmtDate(r.dueDate) : ''}${od ? `<br>${UI.tag('Overdue', 'red')}` : ''}</td><td class="nowrap">${r?.reconciledAt ? U.fmtDate(r.reconciledAt) : ''}</td></tr>`; }).join('') || '<tr><td colspan="11" class="empty">No transactions for these filters.</td></tr>'}</tbody>
        </table></div></div></div>`;
      pb.bind(root);
      const on = (id, key) => root.querySelector(id).addEventListener('change', ev => { f[key] = ev.target.value; draw(); });
      on('#ax-recon', 'recon'); on('#ax-type', 'type'); on('#ax-status', 'status'); on('#ax-basis', 'basis');
      root.querySelector('#ax-q').addEventListener('input', ev => { f.q = ev.target.value; draw(); const n = root.querySelector('#ax-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
      Export.attach(root, () => ({
        title: 'All transactions',
        subtitle: [ALLTX_RECON.find(x => x[0] === f.recon)[1], f.type ? UI.typeLabel(f.type) : '', f.status ? STATUS[f.status].label : '', f.basis === 'any' ? 'any date' : `${f.basis} ${pb.label}`].filter(Boolean).join(' · '),
        filename: 'all_transactions',
        sections: [{ heading: 'Transactions',
          columns: [{ label: 'Applied' }, { label: 'Reference' }, { label: 'Client' }, { label: 'Account' }, { label: 'Type' }, { label: 'Branch' }, { label: 'Beneficiary' }, { label: 'Country' }, { label: 'Currency' }, { label: 'Amount', num: 2 }, { label: 'Allocated', num: 2 }, { label: 'Paid', num: 2 }, { label: 'USD equivalent', num: 2 }, { label: 'Charges (MWK)', num: 2 }, { label: 'Status' }, { label: 'Payment ref' }, { label: 'Reconciliation' }, { label: 'Reconciliation due' }, { label: 'Reconciled' }],
          rows: rows.map(a => { const t = Engine.totals(a), r = a.recon;
            return [U.fmtDate(Engine.appliedAt(a)), a.ref, a.customer.name, a.customer.account, UI.typeLabel(a.type), UI.branchName(a.branchId), a.beneficiary?.name || '', a.beneficiary?.country || '', a.currency, a.amount, t.allocated, t.paid, U.round2(Rules.toUSD(a.amount, a.currency)), typeof Charges !== 'undefined' ? Charges.ofApp(a) : '', STATUS[a.status]?.label || a.status, (a.payments || []).map(p => p.reference).join(', '), this.reconLabel(a), r ? U.fmtDate(r.dueDate) : '', r?.reconciledAt ? U.fmtDate(r.reconciledAt) : '']; }) }],
      }));
    };
    draw();
  },
};

Reports.tabs.splice(2, 0, ['alltx', 'All transactions']);
Reports.alltx = () => AllTx.report();
