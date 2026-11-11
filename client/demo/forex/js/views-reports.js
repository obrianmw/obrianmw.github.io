'use strict';

/* Reports: outward transactions, processed (finished) transactions, demand (LCY vs FCY accounts), client history,
   audit trail. Every report is open to every role by default; Administration → Access rights can take reports away
   from (or give them to) roles and individual users. Branch staff see their own branch's data unless they also
   have "Applications from all branches".
   Every report exports to Excel, Word, PDF, CSV, HTML or print through Export (js/export.js). */
const Reports = {
  tabs: [['outward', 'Outward transactions'], ['processed', 'Processed transactions'], ['demand', 'Demand'], ['client', 'Client history'], ['audit', 'Audit trail']],
  state: {},

  allowed(user = Store.user()) { return Reports.tabs.filter(([k]) => Access.has(user, `report.${k}`)); },

  render(name) {
    const tabs = Reports.allowed();
    if (!tabs.length) { UI.toast('You do not have access to any reports.', 'error'); location.hash = '#/dashboard'; return; }
    if (!tabs.some(t => t[0] === name)) name = tabs[0][0];
    UI.setTitle(tabs.find(t => t[0] === name)[1], 'Reports');
    document.getElementById('view').innerHTML = `
      <div class="tabs">${tabs.map(([k, l]) => `<a href="#/reports/${k}" class="${k === name ? 'active' : ''}">${l}</a>`).join('')}</div>
      <div id="rep"></div>`;
    Reports[name]();
  },

  /* Period picker shared by outward & demand: day / week / month / year / custom. */
  period(key) {
    const st = this.state[key] = this.state[key] || { mode: 'month', anchor: U.dayKey(Store.now()), from: '', to: '' };
    const a = U.parseDay(st.anchor);
    let from, to;
    if (st.mode === 'day') { from = a; to = a; }
    else if (st.mode === 'week') { const dow = (a.getDay() + 6) % 7; from = U.addDays(a, -dow); to = U.addDays(from, 6); }
    else if (st.mode === 'month') { from = new Date(a.getFullYear(), a.getMonth(), 1); to = new Date(a.getFullYear(), a.getMonth() + 1, 0); }
    else if (st.mode === 'year') { from = new Date(a.getFullYear(), 0, 1); to = new Date(a.getFullYear(), 11, 31); }
    else { from = U.parseDay(st.from || st.anchor); to = U.parseDay(st.to || st.anchor); }
    return { st, from: U.dayKey(from), to: U.dayKey(to) };
  },

  periodBar(key, onChange, opts = {}) {
    const { st, from, to } = this.period(key);
    if (opts.noBranch) st.branch = '';   // reports limited to the user's own branch have no branch picker
    const html = `<div class="toolbar">
      <div class="pill-group">${['day', 'week', 'month', 'year', 'custom'].map(m => `<button data-mode="${m}" class="${st.mode === m ? 'on' : ''}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>
      ${st.mode === 'custom'
        ? `<label>From <input type="date" id="p-from" value="${st.from || from}"></label><label>To <input type="date" id="p-to" value="${st.to || to}"></label>`
        : `<button id="p-prev" aria-label="Previous period">‹</button><input type="date" id="p-anchor" value="${st.anchor}"><button id="p-next" aria-label="Next period">›</button>`}
      <b style="margin-left:6px">${U.fmtDate(from)}${from !== to ? ` – ${U.fmtDate(to)}` : ''}</b>
      ${!opts.noBranch && Access.has(Store.user(), 'view.allBranches') ? `<select id="p-branch" aria-label="Branch"><option value="">All branches</option>${Store.state.branches.map(b => `<option value="${b.id}" ${st.branch === b.id ? 'selected' : ''}>${U.esc(b.code)} · ${U.esc(b.name)}</option>`).join('')}</select>` : ''}
      <span class="grow"></span>
      ${Export.button()}
    </div>`;
    const bind = (root) => {
      root.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { st.mode = b.dataset.mode; if (st.mode === 'custom') { st.from = from; st.to = to; } onChange(); }));
      const step = dir => {
        const a = U.parseDay(st.anchor);
        if (st.mode === 'day') st.anchor = U.dayKey(U.addDays(a, dir));
        if (st.mode === 'week') st.anchor = U.dayKey(U.addDays(a, 7 * dir));
        if (st.mode === 'month') st.anchor = U.dayKey(new Date(a.getFullYear(), a.getMonth() + dir, 1));
        if (st.mode === 'year') st.anchor = U.dayKey(new Date(a.getFullYear() + dir, 0, 1));
        onChange();
      };
      root.querySelector('#p-prev')?.addEventListener('click', () => step(-1));
      root.querySelector('#p-next')?.addEventListener('click', () => step(1));
      root.querySelector('#p-anchor')?.addEventListener('change', e => { if (e.target.value) { st.anchor = e.target.value; onChange(); } });
      root.querySelector('#p-from')?.addEventListener('change', e => { st.from = e.target.value; onChange(); });
      root.querySelector('#p-to')?.addEventListener('change', e => { st.to = e.target.value; onChange(); });
      root.querySelector('#p-branch')?.addEventListener('change', e => { st.branch = e.target.value; onChange(); });
    };
    // Branch filter plus the user's own visibility (branch staff see their branch only).
    const match = a => (!st.branch || a.branchId === st.branch) && Engine.can('view', a);
    const label = `${U.fmtDate(from)}${from !== to ? ` – ${U.fmtDate(to)}` : ''} · ${opts.noBranch ? UI.branchName(Engine.workingBranch(Store.user())) : st.branch ? UI.branchName(st.branch) : (Access.has(Store.user(), 'view.allBranches') ? 'All branches' : UI.branchName(Engine.workingBranch(Store.user())))}`;
    return { html, bind, from, to, match, label };
  },

  inRange(iso, from, to) { const k = U.dayKey(iso); return k >= from && k <= to; },

  /* ---------- outward transactions (payments made) ---------- */
  outward() {
    const draw = () => {
      const pb = this.periodBar('outward', draw);
      const rows = [];
      Store.state.apps.filter(pb.match).forEach(a => a.payments.forEach(p => {
        if (!p.reversed && this.inRange(p.valueDate, pb.from, pb.to)) rows.push({ a, p });   // reversed payments came back
      }));
      rows.sort((x, y) => x.p.valueDate.localeCompare(y.p.valueDate));
      const byCcy = {};
      rows.forEach(({ a, p }) => {
        const r = byCcy[a.currency] = byCcy[a.currency] || { n: 0, amt: 0, mwk: 0, usd: 0 };
        r.n++; r.amt += p.amount; r.mwk += p.mwk; r.usd += Rules.toUSD(p.amount, a.currency);
      });
      const byType = {};
      rows.forEach(({ a, p }) => { const r = byType[a.type] = byType[a.type] || { n: 0, usd: 0 }; r.n++; r.usd += Rules.toUSD(p.amount, a.currency); });
      const totUSD = U.sum(Object.values(byCcy), r => r.usd);
      const totMWK = U.sum(Object.values(byCcy), r => r.mwk);
      const maxType = Math.max(1, ...Object.values(byType).map(r => r.usd));

      U.$('#rep').innerHTML = pb.html + `
        <div class="kpis">
          <div class="kpi"><div class="v">${rows.length}</div><div class="l">Outward payments</div></div>
          <div class="kpi green"><div class="v">${U.num(totUSD, 0)}</div><div class="l">Total ≈ USD</div></div>
          <div class="kpi violet"><div class="v">${U.num(totMWK, 0)}</div><div class="l">Total MWK equivalent</div></div>
          <div class="kpi amber"><div class="v">${new Set(rows.map(r => r.a.customer.account)).size}</div><div class="l">Clients</div></div>
        </div>
        <div class="grid g2" style="margin-bottom:16px">
          <div class="card"><div class="card-h"><h2>By currency</h2></div><div class="card-b tight"><table><thead><tr><th>Currency</th><th class="num">Count</th><th class="num">Amount</th><th class="num">MWK equiv.</th><th class="num">≈ USD</th></tr></thead><tbody>
            ${Object.entries(byCcy).map(([c, r]) => `<tr><td><b>${c}</b></td><td class="num">${r.n}</td><td class="num">${U.num(r.amt)}</td><td class="num">${U.num(r.mwk)}</td><td class="num">${U.num(r.usd)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No payments in this period.</td></tr>'}
          </tbody></table></div></div>
          <div class="card"><div class="card-h"><h2>By transaction type (≈ USD)</h2></div><div class="card-b tight"><table><tbody>
            ${Object.entries(byType).sort((x, y) => y[1].usd - x[1].usd).map(([t, r]) => `<tr><td>${U.esc(UI.typeLabel(t))}</td><td class="num">${r.n}</td><td style="width:40%"><div class="bar"><span style="width:${(r.usd / maxType * 100).toFixed(1)}%"></span></div></td><td class="num">${U.num(r.usd)}</td></tr>`).join('') || '<tr><td class="empty">No payments in this period.</td></tr>'}
          </tbody></table></div></div>
        </div>
        <div class="card"><div class="card-h"><h2>Transactions</h2></div><div class="card-b tight"><div class="table-wrap"><table>
          <thead><tr><th>Value date</th><th>Reference</th><th>Customer</th><th>Type</th><th>Beneficiary</th><th>Country</th><th class="num">Amount</th><th class="num">Rate</th><th class="num">MWK</th><th>Payment ref</th><th>Branch</th></tr></thead>
          <tbody>${rows.map(({ a, p }) => `<tr><td class="nowrap">${U.fmtDate(p.valueDate)}</td><td><a class="mono" href="#/app/${a.id}">${a.ref}</a></td><td>${U.esc(a.customer.name)}<br><small class="mono">${U.esc(a.customer.account)}</small></td><td>${U.esc(UI.typeLabel(a.type))}</td><td>${U.esc(a.beneficiary.name)}</td><td>${U.esc(a.beneficiary.country)}</td><td class="num">${U.money(p.amount, a.currency)}</td><td class="num">${U.num(p.rate, 4)}</td><td class="num">${U.num(p.mwk)}</td><td class="mono">${U.esc(p.reference)}</td><td>${U.esc(UI.branchName(a.branchId))}</td></tr>`).join('') || '<tr><td colspan="11" class="empty">No outward transactions in this period.</td></tr>'}</tbody>
        </table></div></div></div>`;
      pb.bind(U.$('#rep'));
      Export.attach(U.$('#rep'), () => ({
        title: 'Outward transactions', subtitle: pb.label, filename: `outward_${pb.from}_${pb.to}`,
        sections: [
          { heading: 'By currency', columns: [{ label: 'Currency' }, { label: 'Count', num: 0 }, { label: 'Amount', num: 2 }, { label: 'MWK equivalent', num: 2 }, { label: 'USD equivalent', num: 2 }],
            rows: Object.entries(byCcy).map(([c, r]) => [c, r.n, U.round2(r.amt), U.round2(r.mwk), U.round2(r.usd)]),
            totals: rows.length ? ['Total', rows.length, '', U.round2(totMWK), U.round2(totUSD)] : null },
          { heading: 'By transaction type', columns: [{ label: 'Transaction type' }, { label: 'Count', num: 0 }, { label: 'USD equivalent', num: 2 }],
            rows: Object.entries(byType).sort((x, y) => y[1].usd - x[1].usd).map(([t, r]) => [UI.typeLabel(t), r.n, U.round2(r.usd)]) },
          { heading: 'Transactions',
            columns: [{ label: 'Value date' }, { label: 'Reference' }, { label: 'Customer' }, { label: 'Account' }, { label: 'Type' }, { label: 'Beneficiary' }, { label: 'Country' }, { label: 'Currency' }, { label: 'Amount', num: 2 }, { label: 'Rate', num: 4 }, { label: 'MWK equivalent', num: 2 }, { label: 'USD equivalent', num: 2 }, { label: 'Payment ref' }, { label: 'Outcome' }, { label: 'Branch' }, { label: 'Processed by' }],
            rows: rows.map(({ a, p }) => [U.fmtDate(p.valueDate), a.ref, a.customer.name, a.customer.account, UI.typeLabel(a.type), a.beneficiary.name, a.beneficiary.country, a.currency, p.amount, Math.round(p.rate * 10000) / 10000, U.round2(p.mwk), U.round2(Rules.toUSD(p.amount, a.currency)), p.reference, p.outcome === 'FULL' ? 'Fully paid' : 'Partly paid', UI.branchName(a.branchId), UI.userName(p.by)]) },
        ],
      }));
    };
    draw();
  },

  /* ---------- processed (finished) transactions: closed paid, closed short, not allocated, rejected ---------- */
  OUTCOMES: {
    PAID: { label: 'Paid in full', tone: 'green' },
    SHORT: { label: 'Closed short', tone: 'amber' },
    EXPIRED: { label: 'Closed – not allocated', tone: 'grey' },
    REJECTED: { label: 'Rejected', tone: 'red' },
  },

  outcomeOf(a) {
    if (a.status === 'CLOSED') return a.closedShort ? 'SHORT' : 'PAID';
    if (a.status === 'EXPIRED') return 'EXPIRED';
    if (a.status === 'REJECTED') return 'REJECTED';
    return null;
  },

  finishedAt(a) { return a.status === 'REJECTED' ? (a.rejectedAt || a.updatedAt) : (a.closedAt || a.updatedAt); },

  finishedBy(a) {
    if (a.status === 'EXPIRED') return 'System (travel date passed)';
    if (a.status === 'CLOSED') { const p = a.payments[a.payments.length - 1]; return p ? UI.userName(p.by) : ''; }
    const e = [...Store.state.audit].reverse().find(x => x.appId === a.id && ['REJECTED', 'REJECTED_AT_INPUT'].includes(x.action));
    return e ? e.userName : '';
  },

  processed() {
    const draw = () => {
      const pb = this.periodBar('processed', draw);
      const st = this.state.processedOutcome = this.state.processedOutcome || '';
      const all = Store.state.apps.filter(a => pb.match(a) && this.outcomeOf(a) && this.inRange(this.finishedAt(a), pb.from, pb.to));
      const apps = all.filter(a => !st || this.outcomeOf(a) === st).sort((x, y) => this.finishedAt(y).localeCompare(this.finishedAt(x)));
      const count = k => all.filter(a => this.outcomeOf(a) === k).length;
      const paidUSD = U.sum(apps, a => Rules.toUSD(Engine.totals(a).paid, a.currency));
      const paidMWK = U.sum(apps, a => U.sum(a.payments, p => p.mwk));
      const days = a => Math.max(0, U.daysBetween(Engine.appliedAt(a), this.finishedAt(a)));
      const avgDays = apps.length ? U.sum(apps, days) / apps.length : 0;
      const byType = {};
      apps.forEach(a => { const r = byType[a.type] = byType[a.type] || { n: 0, applied: 0, paid: 0, days: 0 }; r.n++; r.applied += Rules.toUSD(a.amount, a.currency); r.paid += Rules.toUSD(Engine.totals(a).paid, a.currency); r.days += days(a); });
      const tag = a => { const o = this.OUTCOMES[this.outcomeOf(a)]; return UI.tag(o.label, o.tone); };

      U.$('#rep').innerHTML = pb.html + `
        <div class="toolbar"><span class="muted">Outcome</span><div class="pill-group">
          <button data-outcome="" class="${!st ? 'on' : ''}">All finished (${all.length})</button>
          ${Object.entries(this.OUTCOMES).map(([k, o]) => `<button data-outcome="${k}" class="${st === k ? 'on' : ''}">${U.esc(o.label)} (${count(k)})</button>`).join('')}
        </div></div>
        <div class="kpis">
          <div class="kpi"><div class="v">${apps.length}</div><div class="l">Transactions finished</div></div>
          <div class="kpi green"><div class="v">${U.num(paidUSD, 0)}</div><div class="l">Paid ≈ USD</div></div>
          <div class="kpi violet"><div class="v">${U.num(paidMWK, 0)}</div><div class="l">Paid MWK equivalent</div></div>
          <div class="kpi amber"><div class="v">${U.num(avgDays, 1)}</div><div class="l">Average days, applied → finished</div></div>
        </div>
        <div class="card" style="margin-bottom:16px"><div class="card-h"><h2>By transaction type</h2></div><div class="card-b tight"><table>
          <thead><tr><th>Type</th><th class="num">Finished</th><th class="num">Applied ≈ USD</th><th class="num">Paid ≈ USD</th><th class="num">Average days</th></tr></thead><tbody>
          ${Object.entries(byType).sort((x, y) => y[1].n - x[1].n).map(([t, r]) => `<tr><td>${U.esc(UI.typeLabel(t))}</td><td class="num">${r.n}</td><td class="num">${U.num(r.applied)}</td><td class="num">${U.num(r.paid)}</td><td class="num">${U.num(r.days / r.n, 1)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No finished transactions in this period.</td></tr>'}
        </tbody></table></div></div>
        <div class="card"><div class="card-h"><h2>Transactions</h2><small>Newest first</small></div><div class="card-b tight"><div class="table-wrap"><table>
          <thead><tr><th>Finished</th><th>Reference</th><th>Customer</th><th>Type</th><th class="num">Applied</th><th class="num">Paid</th><th class="num">MWK</th><th>Outcome</th><th class="num">Days</th><th>Finished by</th><th>Branch</th></tr></thead>
          <tbody>${apps.map(a => { const t = Engine.totals(a); return `<tr><td class="nowrap">${U.fmtDate(this.finishedAt(a))}</td><td><a class="mono" href="#/app/${a.id}">${a.ref}</a></td><td>${U.esc(a.customer.name)}<br><small class="mono">${U.esc(a.customer.account)}</small></td><td>${U.esc(UI.typeLabel(a.type))}</td><td class="num">${U.money(a.amount, a.currency)}</td><td class="num">${t.paid ? U.money(t.paid, a.currency) : '–'}</td><td class="num">${t.paid ? U.num(U.sum(a.payments, p => p.mwk)) : '–'}</td><td>${tag(a)}</td><td class="num">${days(a)}</td><td>${U.esc(this.finishedBy(a))}</td><td>${U.esc(UI.branchName(a.branchId))}</td></tr>`; }).join('') || '<tr><td colspan="11" class="empty">No finished transactions in this period.</td></tr>'}</tbody>
        </table></div></div></div>`;
      pb.bind(U.$('#rep'));
      U.$$('#rep [data-outcome]').forEach(b => b.addEventListener('click', () => { this.state.processedOutcome = b.dataset.outcome; draw(); }));
      Export.attach(U.$('#rep'), () => ({
        title: 'Processed transactions', subtitle: `${pb.label}${st ? ` · ${this.OUTCOMES[st].label}` : ' · all outcomes'}`, filename: `processed_${pb.from}_${pb.to}`,
        sections: [
          { heading: 'Summary by outcome', columns: [{ label: 'Outcome' }, { label: 'Count', num: 0 }],
            rows: Object.entries(this.OUTCOMES).map(([k, o]) => [o.label, count(k)]), totals: ['Total', all.length] },
          { heading: 'By transaction type', columns: [{ label: 'Transaction type' }, { label: 'Finished', num: 0 }, { label: 'Applied USD equivalent', num: 2 }, { label: 'Paid USD equivalent', num: 2 }, { label: 'Average days', num: 1 }],
            rows: Object.entries(byType).sort((x, y) => y[1].n - x[1].n).map(([t, r]) => [UI.typeLabel(t), r.n, U.round2(r.applied), U.round2(r.paid), Math.round(r.days / r.n * 10) / 10]) },
          { heading: 'Transactions',
            columns: [{ label: 'Finished' }, { label: 'Reference' }, { label: 'Applied on' }, { label: 'Customer' }, { label: 'Account' }, { label: 'Type' }, { label: 'Beneficiary' }, { label: 'Country' }, { label: 'Currency' }, { label: 'Amount applied', num: 2 }, { label: 'Paid', num: 2 }, { label: 'MWK equivalent', num: 2 }, { label: 'Paid USD equivalent', num: 2 }, { label: 'Outcome' }, { label: 'Days', num: 0 }, { label: 'Finished by' }, { label: 'Branch' }],
            rows: apps.map(a => { const t = Engine.totals(a); return [U.fmtDate(this.finishedAt(a)), a.ref, U.fmtDate(Engine.appliedAt(a)), a.customer.name, a.customer.account, UI.typeLabel(a.type), a.beneficiary?.name || '', a.beneficiary?.country || '', a.currency, a.amount, t.paid, U.round2(U.sum(a.payments, p => p.mwk)), U.round2(Rules.toUSD(t.paid, a.currency)), this.OUTCOMES[this.outcomeOf(a)].label, days(a), this.finishedBy(a), UI.branchName(a.branchId)]; }) },
        ],
      }));
    };
    draw();
  },

  /* ---------- demand: amounts applied for, split by local vs foreign currency accounts ---------- */
  /* Inputters and authorisers see the demand of their whole branch (every application of the branch, whoever
     captured it); other roles see a branch or the whole bank (branch picker, with "Applications from all branches"). */
  ownDemand(user = Store.user()) {
    if (['INPUTTER', 'AUTHORISER'].includes(user.role)) return a => Engine.inBranch(user, a.branchId);
    return () => true;
  },

  demand() {
    const draw = () => {
      const pb = this.periodBar('demand', draw, { noBranch: ['INPUTTER', 'AUTHORISER'].includes(Store.user().role) });
      const st = this.state.demandBasis = this.state.demandBasis || 'authorised';
      const dateOf = a => st === 'authorised' ? a.authorisedAt : a.submittedAt;
      const mine = this.ownDemand();
      const apps = Store.state.apps.filter(a => pb.match(a) && mine(a) && dateOf(a) && this.inRange(dateOf(a), pb.from, pb.to) && !['DRAFT'].includes(a.status));
      const group = (list) => {
        const g = {};
        list.forEach(a => {
          const t = Engine.totals(a);
          const r = g[a.currency] = g[a.currency] || { n: 0, demand: 0, allocated: 0, paid: 0, usd: 0 };
          r.n++; r.demand += a.amount; r.allocated += t.allocated; r.paid += t.paid; r.usd += Rules.toUSD(a.amount, a.currency);
        });
        return Object.entries(g).sort((x, y) => y[1].usd - x[1].usd);
      };
      const section = (key, title) => {
        const list = apps.filter(a => a.customer.accountType === key);
        const g = group(list);
        const totUSD = U.sum(g, ([, r]) => r.usd);
        const allocUSD = U.sum(g, ([c, r]) => Rules.toUSD(r.allocated, c));
        return { title, g, totUSD, html: `<div class="card"><div class="card-h"><h2>${title}</h2><small>${list.length} application(s) · ≈ USD ${U.num(totUSD)} demanded · ${totUSD ? Math.round(allocUSD / totUSD * 100) : 0}% allocated</small></div><div class="card-b tight"><div class="table-wrap"><table>
          <thead><tr><th>Currency</th><th class="num">Applications</th><th class="num">Demand</th><th class="num">Allocated</th><th class="num">Paid</th><th class="num">Unmet</th><th>Fill rate</th><th class="num">Demand ≈ USD</th></tr></thead><tbody>
          ${g.map(([c, r]) => `<tr><td><b>${c}</b></td><td class="num">${r.n}</td><td class="num">${U.num(r.demand)}</td><td class="num">${U.num(r.allocated)}</td><td class="num">${U.num(r.paid)}</td><td class="num">${U.num(Math.max(0, r.demand - r.allocated))}</td><td style="min-width:120px"><div class="bar"><span class="b2" style="width:${r.demand ? Math.min(100, r.allocated / r.demand * 100).toFixed(1) : 0}%"></span></div></td><td class="num">${U.num(r.usd)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No demand in this period.</td></tr>'}
          </tbody></table></div></div></div>` };
      };
      const lcy = section('LCY', 'Local currency accounts (MWK)');
      const fcy = section('FCY', 'Foreign currency accounts');
      const byType = {};
      apps.forEach(a => { const r = byType[a.type] = byType[a.type] || { lcy: 0, fcy: 0 }; r[a.customer.accountType === 'FCY' ? 'fcy' : 'lcy'] += Rules.toUSD(a.amount, a.currency); });

      const who = Store.user().role;
      U.$('#rep').innerHTML = pb.html + `
        ${['INPUTTER', 'AUTHORISER'].includes(who) ? `<div class="alert info" style="margin-bottom:12px"><div>Demand from all applications of ${U.esc(UI.branchName(Engine.workingBranch(Store.user())))}.</div></div>` : ''}
        <div class="toolbar"><span class="muted">Count applications by</span><div class="pill-group"><button data-basis="authorised" class="${st === 'authorised' ? 'on' : ''}">Date authorised</button><button data-basis="submitted" class="${st === 'submitted' ? 'on' : ''}">Date submitted</button></div></div>
        <div class="stack">${lcy.html}${fcy.html}
        <div class="card"><div class="card-h"><h2>Demand by transaction type (≈ USD)</h2></div><div class="card-b tight"><table><thead><tr><th>Type</th><th class="num">Local currency accts</th><th class="num">Foreign currency accts</th><th class="num">Total</th></tr></thead><tbody>
          ${Object.entries(byType).map(([t, r]) => `<tr><td>${U.esc(UI.typeLabel(t))}</td><td class="num">${U.num(r.lcy)}</td><td class="num">${U.num(r.fcy)}</td><td class="num"><b>${U.num(r.lcy + r.fcy)}</b></td></tr>`).join('') || '<tr><td colspan="4" class="empty">No demand in this period.</td></tr>'}
        </tbody></table></div></div></div>`;
      pb.bind(U.$('#rep'));
      U.$$('#rep [data-basis]').forEach(b => b.addEventListener('click', () => { this.state.demandBasis = b.dataset.basis; draw(); }));
      const ccyCols = [{ label: 'Currency' }, { label: 'Applications', num: 0 }, { label: 'Demand', num: 2 }, { label: 'Allocated', num: 2 }, { label: 'Paid', num: 2 }, { label: 'Unmet', num: 2 }, { label: 'Demand USD equivalent', num: 2 }];
      const ccyRows = s => s.g.map(([c, r]) => [c, r.n, U.round2(r.demand), U.round2(r.allocated), U.round2(r.paid), U.round2(Math.max(0, r.demand - r.allocated)), U.round2(r.usd)]);
      Export.attach(U.$('#rep'), () => ({
        title: 'Demand report', subtitle: `${pb.label} · by date ${st}`, filename: `demand_${pb.from}_${pb.to}`,
        sections: [
          { heading: lcy.title, columns: ccyCols, rows: ccyRows(lcy), totals: lcy.g.length ? ['Total', U.sum(lcy.g, ([, r]) => r.n), '', '', '', '', U.round2(lcy.totUSD)] : null },
          { heading: fcy.title, columns: ccyCols, rows: ccyRows(fcy), totals: fcy.g.length ? ['Total', U.sum(fcy.g, ([, r]) => r.n), '', '', '', '', U.round2(fcy.totUSD)] : null },
          { heading: 'Demand by transaction type (USD equivalent)', columns: [{ label: 'Transaction type' }, { label: 'Local currency accounts', num: 2 }, { label: 'Foreign currency accounts', num: 2 }, { label: 'Total', num: 2 }],
            rows: Object.entries(byType).map(([t, r]) => [UI.typeLabel(t), U.round2(r.lcy), U.round2(r.fcy), U.round2(r.lcy + r.fcy)]) },
          { heading: 'Applications',
            columns: [{ label: 'Reference' }, { label: 'Date' }, { label: 'Account type' }, { label: 'Customer' }, { label: 'Account' }, { label: 'Type' }, { label: 'Currency' }, { label: 'Amount applied', num: 2 }, { label: 'USD equivalent', num: 2 }, { label: 'Allocated', num: 2 }, { label: 'Paid', num: 2 }, { label: 'Status' }, { label: 'Branch' }],
            rows: apps.map(a => { const t = Engine.totals(a); return [a.ref, U.fmtDate(dateOf(a)), ACCOUNT_TYPES[a.customer.accountType], a.customer.name, a.customer.account, UI.typeLabel(a.type), a.currency, a.amount, U.round2(Rules.toUSD(a.amount, a.currency)), t.allocated, t.paid, STATUS[a.status].label, UI.branchName(a.branchId)]; }) },
        ],
      }));
    };
    draw();
  },

  /* ---------- client history (all branches, all users) ---------- */
  client() {
    const st = this.state.client = this.state.client || { q: '', account: '' };
    const clients = {};
    // Client history is shared by all users and branches: every application ever submitted for the account.
    Store.state.apps.filter(a => a.customer?.account && Engine.inHistory(a)).forEach(a => {
      const c = clients[a.customer.account] = clients[a.customer.account] || { account: a.customer.account, name: a.customer.name, apps: [] };
      c.apps.push(a);
    });
    const draw = () => {
      const term = st.q.trim().toLowerCase();
      const list = Object.values(clients).filter(c => !term || c.name.toLowerCase().includes(term) || c.account.includes(term)).sort((a, b) => a.name.localeCompare(b.name));
      const sel = clients[st.account];
      U.$('#rep').innerHTML = `
        <div class="cols" style="grid-template-columns:320px minmax(0,1fr)">
          <div class="card"><div class="card-h"><input type="search" id="cl-q" placeholder="Search client name or account…" value="${U.esc(st.q)}"></div>
            <div class="card-b tight" style="max-height:70vh;overflow:auto"><table><tbody>${list.map(c => `<tr class="click" data-acct="${c.account}" style="${c.account === st.account ? 'background:var(--blue-50)' : ''}"><td><b>${U.esc(c.name)}</b><br><small class="mono">${c.account}</small></td><td class="num">${c.apps.length}</td></tr>`).join('') || '<tr><td class="empty">No clients found.</td></tr>'}</tbody></table></div></div>
          <div>${sel ? this.clientDetail(sel) : '<div class="card"><div class="empty">Select a client to see their full history.</div></div>'}</div>
        </div>`;
      const q = U.$('#cl-q');
      q.addEventListener('input', e => { st.q = e.target.value; draw(); const n = U.$('#cl-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
      U.$$('#rep [data-acct]').forEach(tr => tr.addEventListener('click', () => { st.account = tr.dataset.acct; draw(); }));
      if (sel) Export.attach(U.$('#rep'), () => this.clientModel(sel));
    };
    draw();
  },

  clientModel(c) {
    const apps = [...c.apps].sort((a, b) => Engine.appliedAt(b).localeCompare(Engine.appliedAt(a)));
    const latest = apps[0].customer;
    const msgs = Store.state.outbox.filter(m => m.audience === 'Client' && apps.some(a => a.id === m.appId)).sort((a, b) => b.at.localeCompare(a.at));
    return {
      title: `Client history – ${c.name}`, subtitle: `Account ${c.account} · all branches`, filename: `client_history_${c.account}`,
      sections: [
        { heading: 'Client', columns: [{ label: 'Field' }, { label: 'Value' }],
          rows: [['Name', latest.name], ['Account', c.account], ['Account type', ACCOUNT_TYPES[latest.accountType] || ''], ['ID', `${ID_TYPE_LABELS[latest.idType] || ''} ${latest.idNumber || ''}`.trim()], ['Address', latest.address], ['Contact', [latest.phone, latest.email].filter(Boolean).join(' · ')],
            ['Applications', String(apps.length)], ['Unreconciled advance payments', String(apps.filter(a => (a.recon && a.recon.status !== 'RECONCILED')).length)]] },
        { heading: 'Applications',
          columns: [{ label: 'Reference' }, { label: 'Applied' }, { label: 'Branch' }, { label: 'Type' }, { label: 'Currency' }, { label: 'Amount', num: 2 }, { label: 'Allocated', num: 2 }, { label: 'Paid', num: 2 }, { label: 'Beneficiary' }, { label: 'Country' }, { label: 'Status' }],
          rows: apps.map(a => { const t = Engine.totals(a); return [a.ref, U.fmtDate(Engine.appliedAt(a)), UI.branchName(a.branchId), UI.typeLabel(a.type), a.currency, a.amount, t.allocated, t.paid, a.beneficiary?.name, a.beneficiary?.country, STATUS[a.status].label + ((a.recon && a.recon.status !== 'RECONCILED') ? ' (reconciliation pending)' : '')]; }) },
        { heading: 'Messages sent to client', columns: [{ label: 'Sent' }, { label: 'Channel' }, { label: 'Subject' }, { label: 'Reference' }],
          rows: msgs.map(m => [U.fmtDateTime(m.at), m.channel, m.subject, m.ref || '']) },
      ],
    };
  },

  clientDetail(c) {
    const apps = [...c.apps].sort((a, b) => Engine.appliedAt(b).localeCompare(Engine.appliedAt(a)));
    const latest = apps[0].customer;
    const paidUSD = U.sum(apps, a => Rules.toUSD(Engine.totals(a).paid, a.currency));
    const msgs = Store.state.outbox.filter(m => m.audience === 'Client' && apps.some(a => a.id === m.appId)).sort((a, b) => b.at.localeCompare(a.at));
    const pendingRecon = apps.filter(a => (a.recon && a.recon.status !== 'RECONCILED'));
    return `<div class="card"><div class="card-h"><h2>${U.esc(c.name)}</h2>${Export.button()}</div>
      <div class="card-b"><dl class="kv"><dt>Account</dt><dd class="mono">${c.account} · ${U.esc(ACCOUNT_TYPES[latest.accountType])}</dd>${latest.idNumber ? `<dt>ID</dt><dd>${U.esc(ID_TYPE_LABELS[latest.idType] || '')} <span class="mono">${U.esc(latest.idNumber)}</span></dd>` : ''}<dt>Address</dt><dd>${U.esc(latest.address)}</dd><dt>Contact</dt><dd>${U.esc(latest.phone)} ${latest.email ? `· ${U.esc(latest.email)}` : ''}</dd></dl>
      <div class="kpis" style="margin:14px 0 0"><div class="kpi"><div class="v">${apps.length}</div><div class="l">Applications</div></div><div class="kpi green"><div class="v">${U.num(paidUSD, 0)}</div><div class="l">Remitted ≈ USD</div></div>
      <div class="kpi ${pendingRecon.length ? 'red' : ''}"><div class="v">${pendingRecon.length}</div><div class="l">Pending reconciliations</div></div><div class="kpi"><div class="v">${apps.filter(a => a.status === 'REJECTED').length}</div><div class="l">Rejected</div></div></div></div></div>
      <div class="card"><div class="card-h"><h2>Applications</h2><small>All branches · ${new Set(apps.map(a => a.branchId)).size} branch(es)</small></div><div class="card-b tight">${Views.historyTable(apps)}</div></div>
      <div class="card"><div class="card-h"><h2>Messages sent to client</h2><small>${msgs.length}</small></div><div class="card-b tight"><table><tbody>${msgs.slice(0, 50).map(m => `<tr><td class="nowrap">${U.fmtDateTime(m.at)}</td><td>${UI.tag(m.channel, 'blue')}</td><td>${U.esc(m.subject)}</td><td class="mono">${m.ref}</td></tr>`).join('') || '<tr><td class="empty">None.</td></tr>'}</tbody></table></div></div>`;
  },

  /* ---------- audit trail ---------- */
  /* Who sees whose entries: an administrator sees everything; an authoriser sees their own and those of the users of
     their branch; everyone else sees only their own. (Each application page keeps its own audit trail.) */
  auditUsers(user = Store.user()) {
    if (user.role === 'ADMIN') return Store.state.users;
    if (user.role === 'AUTHORISER') return Store.state.users.filter(u => u.id === user.id || Engine.branchesOf(u).some(b => Engine.inBranch(user, b)));
    return Store.state.users.filter(u => u.id === user.id);
  },

  visibleAudit(user = Store.user()) {
    if (user.role === 'ADMIN') return Store.state.audit;
    const ids = new Set(this.auditUsers(user).map(u => u.id));
    return Store.state.audit.filter(e => ids.has(e.userId));
  },

  /* Server activity: what the server itself records (start, stop, stops without the root password, backups…). */
  isServerEntry(e) { return e.userId === 'system' || String(e.action || '').startsWith('SERVER_'); },

  auditColumns: [{ label: 'Date & time' }, { label: 'User' }, { label: 'Role' }, { label: 'Action' }, { label: 'Reference' }, { label: 'Details' }, { label: 'Field changes' }],
  auditRow(e) {
    return [U.fmtDateTime(e.at), e.userName, ROLES[e.role] || 'System', Views.actionLabel(e.action), e.ref || '', e.details || '', (e.changes || []).map(c => `${c.field}: ${c.from === '' ? '(blank)' : c.from} → ${c.to === '' ? '(blank)' : c.to}`).join('\n')];
  },

  audit() {
    const st = this.state.audit = this.state.audit || { from: U.dayKey(U.addDays(Store.now(), -30)), to: U.dayKey(Store.now()), user: '', action: '', q: '', kind: '', branch: '' };
    const me = Store.user();
    const source = this.visibleAudit(me);
    const actions = [...new Set(source.map(e => e.action))].sort();
    const isAdmin = me.role === 'ADMIN';
    const people = this.auditUsers(me);
    const branchOf = e => Store.userById(e.userId)?.branchId;
    const draw = () => {
      // Administrators: activity type and branch first; the user list then only offers that branch's users.
      const choosable = isAdmin && st.branch ? people.filter(u => u.branchId === st.branch) : people;
      if (st.user && st.user !== 'system' && !choosable.some(u => u.id === st.user)) st.user = '';
      const term = st.q.trim().toLowerCase();
      const rows = source.filter(e => this.inRange(e.at, st.from, st.to) && (!st.user || e.userId === st.user) && (!st.action || e.action === st.action)
        && (!st.kind || (st.kind === 'server') === this.isServerEntry(e))
        && (!st.branch || branchOf(e) === st.branch)
        && (!term || [e.ref, e.appId && Store.app(e.appId)?.ref, e.details, e.userName].some(x => String(x || '').toLowerCase().includes(term)))).sort((a, b) => b.at.localeCompare(a.at));
      const scope = isAdmin ? ''
        : me.role === 'AUTHORISER' ? `You see your own activity and that of the users of ${U.esc(UI.branchName(Engine.workingBranch(me)))}.`
        : 'You see your own activity only.';
      U.$('#rep').innerHTML = `
        ${scope ? `<div class="alert info" style="margin-bottom:12px"><div>${scope} Each application page also has its own Audit trail.</div></div>` : ''}
        <div class="toolbar">
          <label>From <input type="date" id="au-from" value="${st.from}"></label><label>To <input type="date" id="au-to" value="${st.to}"></label>
          ${isAdmin ? `<select id="au-kind" aria-label="Activity"><option value="">All activity</option><option value="server" ${st.kind === 'server' ? 'selected' : ''}>Server activity</option><option value="user" ${st.kind === 'user' ? 'selected' : ''}>User activity</option></select>
          <select id="au-branch" aria-label="Branch"><option value="">All branches</option>${Store.state.branches.map(b => `<option value="${b.id}" ${st.branch === b.id ? 'selected' : ''}>${U.esc(b.code)} · ${U.esc(b.name)}</option>`).join('')}</select>` : ''}
          ${choosable.length > 1 || isAdmin ? `<select id="au-user" aria-label="User"><option value="">${isAdmin && st.branch ? 'All users of the branch' : 'All users'}</option>${isAdmin && !st.branch ? `<option value="system" ${st.user === 'system' ? 'selected' : ''}>System</option>` : ''}${choosable.map(u => `<option value="${u.id}" ${st.user === u.id ? 'selected' : ''}>${U.esc(u.name)}</option>`).join('')}</select>` : ''}
          <select id="au-action"><option value="">All actions</option>${actions.map(a => `<option value="${a}" ${st.action === a ? 'selected' : ''}>${U.esc(Views.actionLabel(a))}</option>`).join('')}</select>
          <input type="search" id="au-q" placeholder="Search ref, details…" value="${U.esc(st.q)}">
          <span class="grow"></span><span class="muted">${rows.length} entries</span>${Export.button()}
        </div>
        <div class="card"><div class="card-b tight"><div class="table-wrap"><table><thead><tr><th>Date & time</th><th>User</th><th>Role</th><th>Action</th><th>Reference</th><th>Details</th></tr></thead><tbody>
          ${rows.slice(0, 1000).map(e => `<tr><td class="nowrap">${U.fmtDateTime(e.at)}</td><td>${U.esc(e.userName)}</td><td>${U.esc(ROLES[e.role] || 'System')}</td><td>${U.esc(Views.actionLabel(e.action))}</td><td>${e.appId && Store.app(e.appId) ? `<a class="mono" href="#/app/${e.appId}">${e.ref}</a>` : `<span class="mono">${U.esc(e.ref || '')}</span>`}</td>
            <td>${U.esc(e.details)}${(e.changes || []).map(c => `<div><small>${U.esc(c.field)}: ${U.esc(c.from)} → ${U.esc(c.to)}</small></div>`).join('')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No audit entries match.</td></tr>'}
        </tbody></table></div></div></div>`;
      U.$('#au-from').addEventListener('change', e => { st.from = e.target.value; draw(); });
      U.$('#au-to').addEventListener('change', e => { st.to = e.target.value; draw(); });
      U.$('#au-user')?.addEventListener('change', e => { st.user = e.target.value; draw(); });
      U.$('#au-kind')?.addEventListener('change', e => { st.kind = e.target.value; draw(); });
      U.$('#au-branch')?.addEventListener('change', e => { st.branch = e.target.value; draw(); });
      U.$('#au-action').addEventListener('change', e => { st.action = e.target.value; draw(); });
      U.$('#au-q').addEventListener('change', e => { st.q = e.target.value; draw(); });
      Export.attach(U.$('#rep'), () => ({
        title: 'Audit trail', subtitle: `${U.fmtDate(st.from)} – ${U.fmtDate(st.to)}${st.kind ? ` · ${st.kind === 'server' ? 'Server' : 'User'} activity` : ''}${st.branch ? ` · ${UI.branchName(st.branch)}` : ''}${st.user ? ` · ${st.user === 'system' ? 'System' : UI.userName(st.user)}` : ''}${st.action ? ` · ${Views.actionLabel(st.action)}` : ''}`,
        filename: `audit_${st.from}_${st.to}`,
        sections: [{ heading: 'Audit trail', columns: this.auditColumns, rows: rows.map(e => this.auditRow(e)) }],
      }));
    };
    draw();
  },
};
