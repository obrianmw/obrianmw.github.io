'use strict';

/* Graphical dashboard (operations-centre style) for every user, with a switch back to the classic view (remembered in
   this browser, per user). It covers the applications the user may see: totals, the pipeline by status, the mix by
   type, received against processed over 30 days, branches, currencies and reconciliation. Every chart can be
   clicked to list the applications behind it. Administrators also see the system panels: users online by branch
   and department (click for who is where), server uptime and health checks (database, disk, backups, virus scanner,
   core banking link, incidents), refreshed every 30 seconds. */

const DASH_STATUS_COLOURS = { DRAFT: '#94a3b8', PENDING_AUTH: '#fbbf24', RETURNED: '#fb923c', REJECTED: '#fb7185', AWAITING_ALLOCATION: '#60a5fa', ALLOCATED: '#a78bfa',
  FUNDED: '#2dd4bf', PARTLY_PAID: '#a3e635', CLOSED: '#34d399', EXPIRED: '#64748b', REVERSED: '#f472b6', CANCELLED: '#cbd5e1' };
const DASH_PALETTE = ['#38bdf8', '#34d399', '#fbbf24', '#fb7185', '#a78bfa', '#fb923c', '#2dd4bf', '#a3e635', '#60a5fa', '#f472b6'];
// Dashboard panels, each an access right "dash.<key>" (default: every role, unless roles are given).
const DASH_PANELS = [
  ['tiles', 'Summary figures', 'Totals, open, awaiting allocation, received and processed this month, overdue reconciliations (the user\'s branch).'],
  ['status', 'Pipeline by status', 'Applications by status (the user\'s branch).'],
  ['type', 'Applications by type', 'Mix of transaction types (the user\'s branch).'],
  ['trend', 'Received and processed – 30 days', 'Applications received and paid per day (the user\'s branch).'],
  ['recon', 'Advance payment reconciliation', 'Reconciled, not reconciled and overdue advance payments. Whole bank by default; the user can pick a branch.'],
  ['unrec', 'Unreconciled items', 'Advance payments awaiting reconciliation and their value. Whole bank by default; the user can pick a branch.'],
  ['branch', 'Open applications by branch', 'Open applications per branch.'],
  ['ccy', 'Still to pay by currency', 'Open balances by currency in USD.'],
  ['queues', 'My work queues', 'The user\'s work queues and their counts.'],
  ['activity', 'Recent activity', 'Latest actions on applications (the user\'s branch).'],
  ['system', 'System panels', 'Users online, server uptime and health checks. Administrators only: the server reports its health to administrators.', ['ADMIN']],
];
const DASH_DEPARTMENTS ={ INPUTTER: 'Branch operations – inputters', AUTHORISER: 'Branch operations – authorisers', TREASURY: 'Treasury', EC: 'Exchange Control', ADMIN: 'IT / Administration' };

const Dash = {
  KEY: 'fx-dashboard-view',
  health: null,
  healthAt: 0,
  timer: null,

  mode(u = Store.user()) { try { return localStorage.getItem(`${this.KEY}-${u.id}`) || 'graphical'; } catch (e) { return 'graphical'; } },
  setMode(m) { try { localStorage.setItem(`${this.KEY}-${Store.user().id}`, m); } catch (e) { /* private window: not remembered */ } Views.dashboard(); },

  apps(u = Store.user()) { return Store.state.apps.filter(a => a.ref && Engine.can('view', a, u)); },

  /* ---------- charts (inline SVG / HTML, no libraries) ---------- */
  donut(parts, total, label, key) {
    const r = 54, c = 2 * Math.PI * r, sum = parts.reduce((t, p) => t + p.value, 0) || 1;
    let off = 0;
    const arcs = parts.filter(p => p.value > 0).map(p => {
      const len = (p.value / sum) * c, a = `<circle r="${r}" cx="70" cy="70" fill="none" stroke="${p.colour}" stroke-width="18" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" data-drill="${key}:${U.esc(p.key)}" tabindex="0"><title>${U.esc(p.label)}: ${U.num(p.value, 0)}</title></circle>`;
      off += len;
      return a;
    }).join('');
    return `<div class="soc-donut"><svg viewBox="0 0 140 140" role="img" aria-label="${U.esc(label)}"><g transform="rotate(-90 70 70)"><circle r="${r}" cx="70" cy="70" fill="none" stroke="var(--soc-track)" stroke-width="18"/>${arcs}</g>
        <text x="70" y="66" text-anchor="middle" class="soc-big">${U.num(total, 0)}</text><text x="70" y="86" text-anchor="middle" class="soc-small">${U.esc(label)}</text></svg>
      <ul class="soc-legend">${parts.map(p => `<li data-drill="${key}:${U.esc(p.key)}" tabindex="0"><i style="background:${p.colour}"></i>${U.esc(p.label)}<b>${U.num(p.value, 0)}</b></li>`).join('')}</ul></div>`;
  },

  bars(items, key, fmt = v => U.num(v, 0)) {
    const max = Math.max(1, ...items.map(i => i.value));
    return `<div class="soc-bars">${items.map((i, n) => `<div class="soc-bar" data-drill="${key}:${U.esc(i.key)}" tabindex="0" title="${U.esc(i.label)}: ${fmt(i.value)}">
        <span class="l">${U.esc(i.label)}</span><span class="t"><span style="width:${Math.max(1.5, (i.value / max) * 100)}%;background:${i.colour || DASH_PALETTE[n % DASH_PALETTE.length]}"></span></span><span class="v">${fmt(i.value)}</span></div>`).join('') || '<div class="soc-muted">Nothing yet.</div>'}</div>`;
  },

  area(series, labels) {
    const w = 560, h = 150, pad = 22, n = labels.length, max = Math.max(1, ...series.flatMap(s => s.values));
    const x = i => pad + (i * (w - 2 * pad)) / Math.max(1, n - 1), y = v => h - pad - (v / max) * (h - 2 * pad);
    const grid = [0, 0.5, 1].map(f => `<line x1="${pad}" x2="${w - pad}" y1="${y(max * f)}" y2="${y(max * f)}" class="soc-grid"/><text x="${pad - 4}" y="${y(max * f) + 3}" text-anchor="end" class="soc-axis">${Math.round(max * f)}</text>`).join('');
    const paths = series.map(s => {
      const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
      return `<polygon points="${x(0)},${h - pad} ${pts} ${x(n - 1)},${h - pad}" fill="${s.colour}" opacity=".14"/><polyline points="${pts}" fill="none" stroke="${s.colour}" stroke-width="2.2" stroke-linejoin="round"/>`;
    }).join('');
    const ticks = labels.map((l, i) => (i % 5 === 0 || i === n - 1 ? `<text x="${x(i)}" y="${h - 6}" text-anchor="middle" class="soc-axis">${U.esc(l)}</text>` : '')).join('');
    const hits = labels.map((l, i) => `<rect x="${x(i) - (w - 2 * pad) / n / 2}" y="${pad}" width="${(w - 2 * pad) / n}" height="${h - 2 * pad}" fill="transparent" data-drill="day:${i}"><title>${U.esc(l)}: ${series.map(s => `${s.label} ${s.values[i]}`).join(', ')}</title></rect>`).join('');
    return `<svg viewBox="0 0 ${w} ${h}" class="soc-area" role="img" aria-label="${U.esc(series.map(s => s.label).join(' and '))} per day">${grid}${paths}${ticks}${hits}</svg>
      <div class="soc-key">${series.map(s => `<span><i style="background:${s.colour}"></i>${U.esc(s.label)} <b>${U.num(s.values.reduce((t, v) => t + v, 0), 0)}</b></span>`).join('')}</div>`;
  },

  spark(values, colour) {
    const w = 120, h = 30, max = Math.max(1, ...values), n = values.length;
    const pts = values.map((v, i) => `${(i * w) / Math.max(1, n - 1)},${h - 2 - (v / max) * (h - 4)}`).join(' ');
    return `<svg viewBox="0 0 ${w} ${h}" class="soc-spark" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${colour}" stroke-width="1.8"/></svg>`;
  },

  gauge(pct, colour, label) {
    const a = Math.PI * Math.min(1, Math.max(0, pct)), r = 52, cx = 70, cy = 70;
    const ex = cx - r * Math.cos(a), ey = cy - r * Math.sin(a);
    return `<svg viewBox="0 0 140 82" class="soc-gauge" role="img" aria-label="${U.esc(label)}"><path d="M18 70 A52 52 0 0 1 122 70" fill="none" stroke="var(--soc-track)" stroke-width="12" stroke-linecap="round"/>
      ${pct > 0 ? `<path d="M18 70 A52 52 0 0 1 ${ex.toFixed(1)} ${ey.toFixed(1)}" fill="none" stroke="${colour}" stroke-width="12" stroke-linecap="round"/>` : ''}
      <text x="70" y="64" text-anchor="middle" class="soc-big">${Math.round(pct * 100)}%</text><text x="70" y="80" text-anchor="middle" class="soc-small">${U.esc(label)}</text></svg>`;
  },

  /* ---------- the figures ---------- */
  figures(apps) {
    const now = Store.now(), today = U.dayKey(now), days = [];
    for (let i = 29; i >= 0; i--) days.push(U.dayKey(U.addDays(now, -i)));
    const idx = new Map(days.map((d, i) => [d, i]));
    const received = days.map(() => 0), processed = days.map(() => 0), recvApps = days.map(() => []), procApps = days.map(() => []);
    apps.forEach(a => {
      const i = idx.get(U.dayKey(Engine.appliedAt(a)));
      if (i != null && a.submittedAt) { received[i]++; recvApps[i].push(a); }
      (a.payments || []).filter(p => !p.reversed).forEach(p => { const j = idx.get(U.dayKey(p.valueDate || p.at)); if (j != null) { processed[j]++; if (!procApps[j].includes(a)) procApps[j].push(a); } });
    });
    const month = today.slice(0, 7);
    const open = apps.filter(a => Engine.isOpen(a) && a.status !== 'DRAFT');
    const unrec = apps.filter(a => a.type === 'ADVANCE' && a.recon && a.recon.status !== 'RECONCILED' && Recon.visible(a));
    return {
      days, received, processed, recvApps, procApps, open, unrec,
      overdue: unrec.filter(a => a.recon.dueDate < today),
      monthIn: apps.filter(a => a.submittedAt && U.dayKey(a.submittedAt).startsWith(month)),
      monthPaid: apps.filter(a => (a.payments || []).some(p => !p.reversed && U.dayKey(p.valueDate || p.at).startsWith(month))),
      awaiting: apps.filter(a => a.status === 'AWAITING_ALLOCATION'),
      usdOpen: U.sum(open, a => Rules.toUSD(Engine.totals(a).balance, a.currency)),
      usdPaidMonth: U.sum(apps, a => U.sum((a.payments || []).filter(p => !p.reversed && U.dayKey(p.valueDate || p.at).startsWith(month)), p => Rules.toUSD(p.amount, a.currency))),
    };
  },

  /* ---------- branch scope ---------- */
  pref(name, def) { try { return localStorage.getItem(`${this.KEY}-${name}-${Store.user().id}`) || def; } catch (e) { return def; } },
  setPref(name, v) { try { localStorage.setItem(`${this.KEY}-${name}-${Store.user().id}`, v); } catch (e) { /* private window: not remembered */ } },

  /* Branches a user may look at on the dashboard: their own (home) branches, plus whatever an administrator has
     added under Administration → Dashboards. Administrators may see every branch unless set otherwise. */
  allowedBranches(u = Store.user()) {
    const all = Store.state.branches.map(b => b.id), d = Access.state().dash?.[u.id];
    if (d === 'ALL' || (d == null && u.role === 'ADMIN')) return all;
    return [...new Set([...Engine.branchesOf(u), ...(Array.isArray(d) ? d : [])])].filter(id => all.includes(id));
  },

  homeLabel(u) { const h = Engine.branchesOf(u); return `${h.length > 1 ? 'My branches' : 'My branch'} – ${h.map(b => UI.branchName(b)).join(', ')}`; },

  /* The scope of the ordinary panels: the user's home branch by default. */
  mainScope(u = Store.user()) {
    const allowed = this.allowedBranches(u), home = Engine.branchesOf(u), every = allowed.length === Store.state.branches.length;
    const opts = [['home', this.homeLabel(u)]];
    if (allowed.some(b => !home.includes(b))) {
      opts.push(['all', every ? 'All branches' : 'All my dashboard branches']);
      allowed.forEach(b => opts.push([b, UI.branchName(b)]));
    }
    let v = this.pref('scope', 'home');
    if (!opts.some(o => o[0] === v)) v = 'home';
    const ids = v === 'home' ? home : v === 'all' ? allowed : [v];
    return { v, ids, opts, label: opts.find(o => o[0] === v)[1].replace(/^My branch(es)? – /, '') };
  },

  /* The scope of a reconciliation panel: the whole bank by default, or the home branch, or any one branch. */
  reconScope(u, name) {
    const opts = [['bank', Access.has(u, 'view.reconAllBranches') ? 'Whole bank' : 'Whole bank (other branches: overdue only)'], ['home', this.homeLabel(u)], ...Store.state.branches.map(b => [b.id, UI.branchName(b.id)])];
    let v = this.pref(name, 'bank');
    if (!opts.some(o => o[0] === v)) v = 'bank';
    return { v, opts, ids: v === 'bank' ? null : v === 'home' ? Engine.branchesOf(u) : [v] };
  },

  select(name, s, label) {
    return `<select class="soc-sel" data-scope="${name}" aria-label="${U.esc(label)}">${s.opts.map(([v, l]) => `<option value="${U.esc(v)}" ${v === s.v ? 'selected' : ''}>${U.esc(l)}</option>`).join('')}</select>`;
  },

  /* ---------- the page ---------- */
  render() {
    const u = Store.user(), e = U.esc, admin = u.role === 'ADMIN', can = k => Access.has(u, `dash.${k}`);
    const scope = this.mainScope(u), inScope = a => scope.ids.includes(a.branchId);
    const apps = Store.state.apps.filter(a => a.ref && inScope(a)), F = this.figures(apps);
    const label = d => U.fmtDate(d).replace(/ \d{4}$/, '');
    const byStatus = Object.keys(STATUS).map(k => ({ key: k, label: STATUS[k].label, value: apps.filter(a => a.status === k).length, colour: DASH_STATUS_COLOURS[k] || '#94a3b8' })).filter(x => x.value);
    const byType = Object.entries(TXN_TYPES).map(([k, t], i) => ({ key: k, label: t.label.replace(/ \(.*\)$/, ''), value: apps.filter(a => a.type === k).length, colour: DASH_PALETTE[i % DASH_PALETTE.length] }));
    const byBranch = Store.state.branches.map(b => ({ key: b.id, label: b.name, value: F.open.filter(a => a.branchId === b.id).length })).filter(x => x.value).sort((a, b) => b.value - a.value).slice(0, 10);
    const ccys = [...new Set(F.open.map(a => a.currency))].map((c, i) => ({ key: c, label: c, value: Math.round(U.sum(F.open.filter(a => a.currency === c), a => Rules.toUSD(Engine.totals(a).balance, a.currency))), colour: DASH_PALETTE[(i + 3) % DASH_PALETTE.length] })).sort((a, b) => b.value - a.value);
    const queues = can('queues') ? Queues.forUser(u).map(q => ({ q, n: Queues.list(q.id).length })) : [];
    const tile = (k, v, l, colour, spark, alert) => `<div class="soc-tile${alert ? ' alert' : ''}" data-drill="${k}" tabindex="0"><div class="v" style="color:${colour}">${v}</div><div class="l">${e(l)}</div>${spark || ''}</div>`;
    const recent = Reports.visibleAudit(u).filter(x => { const a = x.appId && Store.app(x.appId); return a && inScope(a); }).slice(-8).reverse();

    // Reconciliation: the whole bank by default, narrowed by each panel's own choice. Items not yet due from other
    // branches only count for users with "Reconciliation – all branches before the due date" (js/recon.js).
    const today = U.dayKey(Store.now()), advances = Recon.items(u);
    const rs = this.reconScope(u, 'recScope'), us = this.reconScope(u, 'unrecScope');
    const within = (s, a) => !s.ids || s.ids.includes(a.branchId);
    const rAll = advances.filter(a => within(rs, a)), rDone = rAll.filter(a => a.recon.status === 'RECONCILED'), rOpen = rAll.filter(a => a.recon.status !== 'RECONCILED'), rLate = rOpen.filter(a => a.recon.dueDate < today);
    const uOpen = Engine.unreconciled().filter(a => within(us, a) && Recon.visible(a, u)), uLate = uOpen.filter(a => a.recon.dueDate < today), uUsd = U.sum(uOpen, a => Rules.toUSD(a.amount, a.currency));
    const rPct = rAll.length ? rDone.length / rAll.length : 1, uPct = uOpen.length ? 1 - uLate.length / uOpen.length : 1;
    const tone = p => (p > 0.8 ? '#34d399' : p > 0.5 ? '#fbbf24' : '#fb7185');
    const where = s => s.opts.find(o => o[0] === s.v)[1].replace(/^My branch(es)? – /, '');

    this.drillSets = {
      all: ['All applications', apps], open: ['Open applications', F.open], awaiting: ['Awaiting allocation', F.awaiting], monthIn: ['Received this month', F.monthIn],
      monthPaid: ['Processed (paid) this month', F.monthPaid], unrec: ['Advance payments not reconciled', F.unrec, 'recon'], overdue: ['Reconciliation overdue', F.overdue, 'recon'],
      rpDone: [`Reconciled – ${where(rs)}`, rDone], rpOpen: [`Not reconciled – ${where(rs)}`, rOpen, 'recon'], rpLate: [`Reconciliation overdue – ${where(rs)}`, rLate, 'recon'],
      urOpen: [`Unreconciled items – ${where(us)}`, uOpen, 'recon'], urLate: [`Unreconciled items overdue – ${where(us)}`, uLate, 'recon'],
    };
    this.drillDays = { F, label };
    this.scopedApps = apps;

    const feed = cols => `<ul class="soc-feed${cols ? ' cols' : ''}">${recent.map(x => `<li><a href="#/app/${x.appId}">${e(x.ref || '')}</a> ${e(Views.actionLabel(x.action))}<small>${e(x.userName)} · ${U.fmtDateTime(x.at)}</small></li>`).join('') || '<li class="soc-muted">No activity yet.</li>'}</ul>`;
    const P = {
      status: can('status') && `<div class="soc-panel"><h3>Pipeline by status</h3>${this.bars(byStatus, 'status')}</div>`,
      type: can('type') && `<div class="soc-panel"><h3>Applications by type</h3>${this.donut(byType, apps.length, 'applications', 'type')}</div>`,
      trend: can('trend') && `<div class="soc-panel"><h3>Received and processed – last 30 days</h3>${this.area([{ label: 'Received', values: F.received, colour: '#38bdf8' }, { label: 'Processed (paid)', values: F.processed, colour: '#34d399' }], F.days.map(label))}</div>`,
      recon: can('recon') && `<div class="soc-panel"><h3>Advance payment reconciliation ${this.select('recScope', rs, 'Advance payment reconciliation: branches')}</h3>
          <div class="soc-center" data-drill="rpDone" tabindex="0">${this.gauge(rPct, tone(rPct), 'reconciled')}</div>
          <div class="soc-key"><span data-drill="rpDone" tabindex="0"><i style="background:#34d399"></i>Reconciled <b>${U.num(rDone.length, 0)}</b></span><span data-drill="rpOpen" tabindex="0"><i style="background:#60a5fa"></i>Not reconciled <b>${U.num(rOpen.length, 0)}</b></span><span data-drill="rpLate" tabindex="0"><i style="background:#fb7185"></i>Overdue <b>${U.num(rLate.length, 0)}</b></span></div></div>`,
      unrec: can('unrec') && `<div class="soc-panel"><h3>Unreconciled items ${this.select('unrecScope', us, 'Unreconciled items: branches')}</h3>
          <div class="soc-center" data-drill="urOpen" tabindex="0">${this.gauge(uPct, tone(uPct), 'within due date')}</div>
          <div class="soc-key"><span data-drill="urOpen" tabindex="0"><i style="background:#60a5fa"></i>Not reconciled <b>${U.num(uOpen.length, 0)}</b></span><span data-drill="urLate" tabindex="0"><i style="background:#fb7185"></i>Overdue <b>${U.num(uLate.length, 0)}</b></span><span data-drill="urOpen" tabindex="0"><i style="background:#38bdf8"></i>Value ≈ USD <b>${U.num(uUsd, 0)}</b></span>${Access.has(u, 'view.unreconciled') ? '<a class="soc-more" href="#/unreconciled">View all →</a>' : ''}</div></div>`,
      branch: can('branch') && `<div class="soc-panel"><h3>Open applications by branch</h3>${this.bars(byBranch, 'branch')}</div>`,
      ccy: can('ccy') && `<div class="soc-panel"><h3>Still to pay by currency <small>≈ USD</small></h3>${this.bars(ccys, 'ccy', v => U.num(v, 0))}</div>`,
      queues: queues.length && `<div class="soc-panel"><h3>My work queues</h3><div class="soc-queues">${queues.map(({ q, n }) => `<a href="#/apps/${q.id}" class="${q.alert && n ? 'alert' : ''}"><b>${n}</b><span>${e(q.label)}</span></a>`).join('')}</div></div>`,
      activity: can('activity') && `<div class="soc-panel"><h3>Recent activity</h3>${feed(!queues.length)}</div>`,
    };
    const row = (cls, ...keys) => { const ps = keys.map(k => P[k]).filter(Boolean); return ps.length ? `<div class="soc-grid ${ps.length === 1 ? '' : ps.length === 2 ? (cls === 'g3' ? 'g2' : cls) : 'g3'}">${ps.join('')}</div>` : ''; };
    const showSystem = admin && can('system');
    const shown = Object.values(P).some(Boolean) || can('tiles') || showSystem;

    document.getElementById('view').innerHTML = `
      <div class="soc">
        <div class="soc-head"><div><h2>Operations dashboard</h2><small>${e(ROLES[u.role])} · ${e(scope.label)} · ${U.fmtDateTime(Store.now())}</small></div>
          <div class="btn-row">${scope.opts.length > 1 ? `<label class="soc-muted">Branch ${this.select('scope', scope, 'Dashboard branches')}</label>` : ''}${Access.has(u, 'act.capture') ? '<a class="btn btn-primary btn-sm" href="#/new">+ New application</a>' : ''}<button class="btn-sm" id="dash-classic">Classic view</button></div></div>
        ${admin ? this.approvalsPanel() : ''}
        ${showSystem ? '<div id="soc-system" class="soc-grid g-sys"><div class="soc-panel"><div class="soc-muted">Checking the system…</div></div></div>' : ''}
        ${can('tiles') ? `<div class="soc-tiles">
          ${tile('all', U.num(apps.length, 0), 'All applications', '#38bdf8', this.spark(F.received, '#38bdf8'))}
          ${tile('open', U.num(F.open.length, 0), `Open · ≈ USD ${U.num(F.usdOpen, 0)} to pay`, '#60a5fa')}
          ${tile('awaiting', U.num(F.awaiting.length, 0), 'Awaiting allocation', '#a78bfa')}
          ${tile('monthIn', U.num(F.monthIn.length, 0), 'Received this month', '#fbbf24', this.spark(F.received.slice(-14), '#fbbf24'))}
          ${tile('monthPaid', U.num(F.monthPaid.length, 0), `Processed this month · ≈ USD ${U.num(F.usdPaidMonth, 0)}`, '#34d399', this.spark(F.processed, '#34d399'))}
          ${tile('overdue', U.num(F.overdue.length, 0), `Reconciliation overdue (of ${F.unrec.length} open)`, F.overdue.length ? '#fb7185' : '#34d399', '', F.overdue.length > 0)}
        </div>` : ''}
        ${row('g2', 'status', 'type')}
        ${row('g21', 'trend', 'recon')}
        ${row('g3', 'branch', 'ccy', 'unrec')}
        ${row('g2', 'queues', 'activity')}
        ${shown ? '' : '<div class="soc-panel"><div class="soc-muted">No dashboard panels have been given to you. An administrator can assign them under Administration → Access rights.</div></div>'}
      </div>`;
    U.$('#dash-classic').addEventListener('click', () => this.setMode('classic'));
    const root = U.$('.soc');
    const go = el => { const d = el.dataset.drill; if (d) this.drill(d); };
    root.addEventListener('click', ev => { const el = ev.target.closest('[data-drill]'); if (el) go(el); });
    root.addEventListener('keydown', ev => { if (ev.key === 'Enter') { const el = ev.target.closest('[data-drill]'); if (el) go(el); } });
    root.addEventListener('change', ev => { const s = ev.target.closest('select[data-scope]'); if (s) { this.setPref(s.dataset.scope, s.value); this.render(); } });
    clearInterval(this.timer); clearInterval(this.ticker);
    if (showSystem) {
      this.system();
      const onDash = () => location.hash === '#/dashboard' || location.hash === '';
      this.timer = setInterval(() => { if (onDash()) this.system(); else clearInterval(this.timer); }, this.REFRESH_MS);
      this.ticker = setInterval(() => this.tick(), 1000);
      if (!this.onVisible) {
        this.onVisible = () => { if (!document.hidden && document.getElementById('soc-system') && Date.now() - this.healthAt > this.REFRESH_MS) this.system(); };
        document.addEventListener('visibilitychange', this.onVisible);
      }
    }
  },

  /* ---------- server uptime, counting every second ---------- */
  span(from, to) {
    const a = new Date(from), b = new Date(to);
    if (!(b > a)) return [0, 0, 0, 0, 0, 0];
    let y = b.getFullYear() - a.getFullYear(), m = b.getMonth() - a.getMonth(), d = b.getDate() - a.getDate();
    let s = (b.getHours() * 3600 + b.getMinutes() * 60 + b.getSeconds()) - (a.getHours() * 3600 + a.getMinutes() * 60 + a.getSeconds());
    if (s < 0) { s += 86400; d--; }
    if (d < 0) { m--; d += new Date(b.getFullYear(), b.getMonth(), 0).getDate(); }
    if (m < 0) { y--; m += 12; }
    return [y, m, d, Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  },

  clock() {
    const h = this.health, start = h && (h.prototype ? window.__dashLoadedAt : h.startedAt);
    const p = this.span(start || Date.now(), Date.now() + (this.skew || 0));
    const L = ['YY', 'MM', 'DD', 'HH', 'mm', 'SS'], W = ['years', 'months', 'days', 'hours', 'minutes', 'seconds'];
    return { html: p.map((v, i) => `${i ? '<em>:</em>' : ''}<span><b>${String(v).padStart(2, '0')}</b><i>${L[i]}</i></span>`).join(''), text: p.map((v, i) => `${v} ${W[i]}`).join(', ') };
  },

  tick() {
    const el = document.getElementById('soc-clock');
    if (!el) { if (!document.querySelector('.soc')) clearInterval(this.ticker); return; }
    const c = this.clock();
    el.innerHTML = c.html;
    el.setAttribute('aria-label', `Up ${c.text}`);
    const age = document.getElementById('soc-age');
    if (age && this.healthAt) {
      const sec = Math.max(0, Math.round((Date.now() - this.healthAt) / 1000)), stale = sec * 1000 > this.STALE_MS;
      age.textContent = stale ? `not updated for ${sec} s – the server is not answering` : sec < 2 ? 'just now' : `${sec} s ago`;
      age.style.color = stale ? '#fb7185' : '';
      if (stale && !this.sysBusy && !document.hidden) this.system();
    }
  },

  /* A chart clicked: the applications behind it. */
  drill(key) {
    const [kind, val] = key.split(':'), apps = this.scopedApps || this.apps(), F = this.drillDays?.F;
    let title, list, recon;
    if (this.drillSets[kind]) [title, list, recon] = this.drillSets[kind];
    else if (kind === 'status') { title = `Status: ${STATUS[val]?.label}`; list = apps.filter(a => a.status === val); }
    else if (kind === 'type') { title = `Type: ${TXN_TYPES[val]?.label}`; list = apps.filter(a => a.type === val); }
    else if (kind === 'branch') { title = `Open applications – ${UI.branchName(val)}`; list = F.open.filter(a => a.branchId === val); }
    else if (kind === 'ccy') { title = `Open applications in ${val}`; list = F.open.filter(a => a.currency === val); }
    else if (kind === 'day') { const i = Number(val); title = `${U.fmtDate(F.days[i])}: received and processed`; list = [...new Set([...F.recvApps[i], ...F.procApps[i]])]; }
    else if (kind === 'online') return this.onlineModal(val);
    else if (kind === 'sec') return this.securityModal(key.slice(4));
    else if (kind === 'apu') return this.approvalModal(val);
    else if (kind === 'apacc') { location.hash = '#/admin/access'; return; }
    else return;
    // Reconciliation lists keep their due-date order and the unreconciled-items columns (whole bank: rows link only where the user may open them).
    if (!recon) list = list.slice().sort((a, b) => (Engine.appliedAt(b) || '').localeCompare(Engine.appliedAt(a) || ''));
    const m = UI.modal({ title: `${title} (${U.num(list.length, 0)})`, wide: true, closeLabel: 'Close',
      body: `${recon ? Views.reconTable(list.slice(0, 200)) : Views.appTable(list.slice(0, 200), null)}${list.length > 200 ? `<div class="muted" style="margin-top:8px">Showing 200 of ${U.num(list.length, 0)}. Reports → All transactions lists them all.</div>` : ''}` });
    window.addEventListener('hashchange', () => m.close(), { once: true });
  },

  /* ---------- administrators: system panels ---------- */
  async fetchHealth() {
    if (typeof Live !== 'undefined' && Live.token) {
      try { this.health = await Live.api('POST', '/api/admin/health', {}); this.health.ok = true; }
      catch (err) { this.health = { ok: false, error: /Unknown endpoint/.test(err.message) ? 'The server does not report its health yet. Restart it after the update.' : err.message }; }
    } else {
      // The prototype has no server: the browser is the system.
      let bytes = 0, big = false;
      try { bytes = (localStorage.getItem(Store.KEY || 'cbm-forex-state') || '').length * 2; big = !!localStorage.getItem('cbm-forex-state-big'); } catch (err) { /* blocked storage */ }
      this.health = { ok: true, prototype: true, now: new Date().toISOString(), startedAt: window.__dashLoadedAt, runtime: navigator.userAgent.replace(/^.*\) /, ''), sessions: 1,
        users: [{ userId: Store.user().id, idleSeconds: 0 }], db: { bytes, big, apps: Store.state.apps.length }, incidents: 0 };
    }
    this.healthAt = Date.now();
    // The uptime clock counts on the server's time, not this PC's.
    this.skew = this.health.ok && this.health.now && !this.health.prototype ? new Date(this.health.now) - Date.now() : 0;
    return this.health;
  },

  online(h = this.health) {
    const S = Store.state, recent = new Map((h?.users || []).filter(x => x.idleSeconds <= 120).map(x => [x.userId, x]));
    const active = S.users.filter(u => u.active !== false);
    return { active, on: active.filter(u => recent.has(u.id)), recent };
  },

  REFRESH_MS: 10000,   // system panels refresh every 10 s; shown as out of date after 30 s
  STALE_MS: 30000,

  async system() {
    const box = U.$('#soc-system');
    if (!box || this.sysBusy) return;
    this.sysBusy = true;
    try { await this.systemNow(box); } finally { this.sysBusy = false; }
  },

  async systemNow(box) {
    const h = await this.fetchHealth();
    if (!U.$('#soc-system')) return;
    const e = U.esc;
    if (!h.ok) { box.innerHTML = `<div class="soc-panel"><h3>System</h3><div class="soc-check bad"><i></i>${e(h.error)}</div></div>`; return; }
    const { active, on } = this.online(h);
    const byRole = Object.keys(DASH_DEPARTMENTS).map((r, i) => ({ key: r, label: DASH_DEPARTMENTS[r], value: on.filter(u => u.role === r).length, colour: DASH_PALETTE[i] }));
    const up = h.startedAt ? (Date.now() - new Date(h.startedAt)) / 1000 : 0;
    const dur = s => (s >= 86400 ? `${Math.floor(s / 86400)}d ` : '') + `${Math.floor((s % 86400) / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    const size = b => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
    const checks = [];
    const add = (state, text) => checks.push(`<div class="soc-check ${state}"><i></i>${text}</div>`);
    if (h.prototype) {
      add('ok', 'Browser-only prototype: the data is kept in this browser');
      add('ok', `${h.db.big ? 'Data kept in the large browser store (IndexedDB)' : `Data stored: ${size(h.db.bytes)}`} · ${U.num(h.db.apps, 0)} applications`);
      add('ok', 'Only this browser is online: the prototype has no server, uptime or backups');
    } else {
      add('ok', `Server up ${dur(up)} · since ${U.fmtDateTime(h.startedAt)} on ${e(h.computer || '')}`);
      add('ok', `Database ${size(h.db.bytes)} · ${U.num(h.db.apps, 0)} applications · ${U.num(h.db.files, 0)} files`);
      const freePct = h.disk.total ? h.disk.free / h.disk.total : 1;
      add(freePct < 0.05 ? 'bad' : freePct < 0.15 ? 'warn' : 'ok', `Disk: ${size(h.disk.free)} free of ${size(h.disk.total)} (${Math.round(freePct * 100)}%)`);
      const ageH = h.backup?.at ? (Date.now() - new Date(h.backup.at)) / 3600000 : null;
      add(!h.backup ? 'warn' : !h.backup.ok ? 'bad' : ageH > 30 ? 'warn' : 'ok', h.backup ? `Last backup ${U.fmtDateTime(h.backup.at)}${h.backup.ok ? '' : ' – FAILED'} (${e(h.backup.kind || '')})` : 'No backup has run yet');
      const blocked = Store.state.audit.filter(x => x.action === 'UPLOAD_BLOCKED' && Date.now() - new Date(x.at) < 86400000).length;
      add(h.scanner.mode === 'off' ? 'warn' : !h.scanner.program ? (h.scanner.mode === 'required' ? 'bad' : 'warn') : blocked ? 'warn' : 'ok',
        `Virus scan: ${h.scanner.mode === 'off' ? 'switched off' : h.scanner.program ? e(h.scanner.program) : 'no scanner found'}${blocked ? ` · ${blocked} upload(s) refused in 24 h` : ''}`);
      add(h.cbs.mode === 'cbs' ? 'ok' : 'warn', h.cbs.mode === 'cbs' ? `Core banking link: ${e(h.cbs.url)}` : 'Core banking: simulated (no cbs.url set)');
      add(h.incidents ? 'bad' : 'ok', h.incidents ? `${h.incidents} server stop(s) without the root password to acknowledge` : 'No unacknowledged server stops');
      add('ok', `${e(h.runtime)} · ${h.threads} threads · ${h.sessions} session(s)${h.memory ? ` · memory ${size(h.memory.used)} of ${size(h.memory.max)}` : ''} · ${e(h.environment)}`);
    }
    let activeBlocks = [];
    if (!h.prototype && typeof Live !== 'undefined') { try { activeBlocks = (await Live.api('POST', '/api/admin/login-blocks', {})).blocks || []; } catch (err) { /* older server */ } }
    if (!U.$('#soc-system')) return;
    const sec = this.security(24, activeBlocks);
    add(sec.state, sec.state === 'ok' ? 'Sign-in security: nothing suspicious in the last 24 h' : `Sign-in security: ${e(sec.headline)}`);
    const worst = checks.some(c => c.includes(' bad"')) ? 'bad' : checks.some(c => c.includes(' warn"')) ? 'warn' : 'ok';
    box.innerHTML = `
      <div class="soc-panel"><h3>Users online <small>last 2 minutes</small></h3>${this.donut([{ key: 'on', label: 'Online', value: on.length, colour: '#34d399' }, { key: 'off', label: 'Not online', value: active.length - on.length, colour: '#334155' }], on.length, `of ${active.length} online`, 'online')}
        <div class="soc-key">${byRole.filter(r => r.value).map(r => `<span data-drill="online:${r.key}" tabindex="0"><i style="background:${r.colour}"></i>${e(r.label)} <b>${r.value}</b></span>`).join('') || '<span class="soc-muted">Nobody else online.</span>'}</div></div>
      <div class="soc-panel"><h3>Server uptime</h3><div class="soc-uptime ${worst}"><div class="soc-clock" id="soc-clock" role="timer" aria-label="Up ${e(this.clock().text)}">${this.clock().html}</div>
        <small>${h.prototype ? 'this browser session · prototype, no server' : `since ${U.fmtDateTime(h.startedAt)}`}</small></div>
        <div class="soc-muted" style="margin-top:8px">Checked ${U.fmtDateTime(h.now)} · <span id="soc-age">just now</span> · live, refreshes every ${this.REFRESH_MS / 1000} s</div></div>
      <div class="soc-panel"><h3>System health <span class="soc-dot ${worst}"></span></h3>${checks.join('')}</div>
      ${this.securityPanel(sec)}`;
  },

  /* ---------- sign-in security: unauthorised, suspect and brute-force sign-in attempts, from the audit trail ----------
     Failed sign-ins, locked accounts, computers blocked for too many failures, administrator sign-ins from outside the
     allowed networks and password-reset abuse. Patterns: brute force (10+ failures from one address), password spraying
     (one address trying 3+ accounts) and guessing user names (sign-ins for accounts that do not exist). */
  SEC: {
    LOGIN_FAILED: ['Failed sign-in', '#fbbf24'], ACCOUNT_LOCKED: ['Account locked', '#fb923c'], LOGIN_SOURCE_BLOCKED: ['Computer blocked', '#fb7185'],
    ADMIN_SIGNIN_REFUSED: ['Admin sign-in from outside', '#f43f5e'], PASSWORD_RESET_THROTTLED: ['Too many reset requests', '#c084fc'],
    PASSWORD_RESET_REFUSED: ['Password reset refused', '#a78bfa'],
  },

  securityEvents(hours) {
    const since = Store.now().getTime() - hours * 3600000;   // the system date: audit entries are stamped with it
    return (Store.state.audit || []).filter(x => this.SEC[x.action] && new Date(x.at).getTime() >= since).map(x => {
      const d = String(x.details || '');
      const ip = (d.match(/from ((?:\d{1,3}\.){3}\d{1,3}|[0-9a-f]*:[0-9a-f:.]+)/i) || [])[1] || '';
      const unknown = (d.match(/^Failed sign-in for "(.*?)"/) || [])[1];
      return { ...x, ip, unknown: unknown != null, account: unknown != null ? unknown : (x.role !== 'SYSTEM' ? x.userName || '' : '') };
    }).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  },

  security(hours = 24, activeBlocks = []) {
    const ev = this.securityEvents(hours), n = a => ev.filter(x => x.action === a).length;
    const bySrc = new Map();
    ev.filter(x => x.action === 'LOGIN_FAILED').forEach(x => {
      const k = x.ip || 'this computer', v = bySrc.get(k) || { ip: k, fails: 0, accounts: new Set(), last: x.at };
      v.fails++; v.accounts.add(String(x.account || x.userId || '').toLowerCase()); bySrc.set(k, v);
    });
    const sources = [...bySrc.values()].sort((a, b) => b.fails - a.fails);
    const brute = sources.filter(v => v.fails >= 10), spraying = sources.filter(v => v.accounts.size >= 3);
    const unknown = new Set(ev.filter(x => x.unknown).map(x => x.account.toLowerCase())).size;
    const r = { ev, sources, brute, spraying, unknown, activeBlocks, failed: n('LOGIN_FAILED'), locked: n('ACCOUNT_LOCKED'), blocked: n('LOGIN_SOURCE_BLOCKED'),
      adminRefused: n('ADMIN_SIGNIN_REFUSED'), reset: n('PASSWORD_RESET_THROTTLED') + n('PASSWORD_RESET_REFUSED') };
    const alerts = [];
    brute.forEach(v => alerts.push(['bad', `Possible brute-force attack: ${v.fails} failed sign-ins from ${v.ip}`]));
    spraying.forEach(v => alerts.push(['bad', `Possible password spraying: ${v.ip} tried ${v.accounts.size} different accounts`]));
    if (activeBlocks.length) alerts.push(['bad', `${activeBlocks.length} computer(s) refused right now for too many failures`]);
    else if (r.blocked) alerts.push(['bad', `${r.blocked} time(s) a computer was blocked for too many failures`]);
    if (r.adminRefused) alerts.push(['bad', `${r.adminRefused} administrator sign-in(s) from outside the allowed networks`]);
    if (r.locked) alerts.push(['warn', `${r.locked} account(s) locked after wrong passwords`]);
    if (unknown >= 3) alerts.push(['warn', `${unknown} user names tried that do not exist (user-name guessing)`]);
    if (r.reset) alerts.push(['warn', `${r.reset} refused or throttled password reset request(s)`]);
    if (!alerts.length && r.failed >= 5) alerts.push(['warn', `${r.failed} failed sign-ins`]);
    r.alerts = alerts;
    r.state = alerts.some(a => a[0] === 'bad') ? 'bad' : alerts.length ? 'warn' : 'ok';
    r.headline = alerts.length ? alerts[0][1] + (alerts.length > 1 ? ` (+${alerts.length - 1} more)` : '') : '';
    return r;
  },

  securityPanel(r) {
    const e = U.esc;
    const tile = (k, v, l, colour, alert) => `<div class="soc-tile${alert ? ' alert' : ''}" data-drill="sec:${k}" tabindex="0"><div class="v" style="color:${v ? colour : '#34d399'}">${U.num(v, 0)}</div><div class="l">${e(l)}</div></div>`;
    return `<div class="soc-panel" style="grid-column:1/-1"><h3>Sign-in security <small>last 24 hours</small> <span class="soc-dot ${r.state}"></span></h3>
      <div class="soc-tiles" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
        ${tile('LOGIN_FAILED', r.failed, 'Failed sign-ins', '#fbbf24')}
        ${tile('unknown', r.unknown, 'Unknown user names tried', '#fbbf24', r.unknown >= 3)}
        ${tile('ACCOUNT_LOCKED', r.locked, 'Accounts locked', '#fb923c')}
        ${tile('LOGIN_SOURCE_BLOCKED', r.activeBlocks.length || r.blocked, r.activeBlocks.length ? 'Computers blocked now' : 'Computers blocked', '#fb7185', r.activeBlocks.length > 0)}
        ${tile('ADMIN_SIGNIN_REFUSED', r.adminRefused, 'Admin sign-ins refused', '#f43f5e', r.adminRefused > 0)}
        ${tile('reset', r.reset, 'Password reset abuse', '#c084fc')}
      </div>
      <div class="soc-grid g2" style="margin:0">
        <div>${r.alerts.length ? r.alerts.map(([st, t]) => `<div class="soc-check ${st}"><i></i>${e(t)}</div>`).join('') : '<div class="soc-check ok"><i></i>No brute-force, password-spraying or other suspect sign-in activity</div>'}</div>
        <div>${r.sources.length ? `<div class="soc-muted" style="margin-bottom:4px">Where failed sign-ins came from</div>${this.bars(r.sources.slice(0, 5).map(v => ({ key: `ip=${v.ip}`, label: `${v.ip} · ${v.accounts.size} account(s)`, value: v.fails, colour: v.fails >= 10 || v.accounts.size >= 3 ? '#fb7185' : '#fbbf24' })), 'sec')}` : '<div class="soc-muted">No failed sign-ins.</div>'}</div>
      </div>
      <div style="margin-top:8px"><a class="soc-more" href="javascript:void 0" data-drill="sec:all">View sign-in security events (7 days) →</a></div></div>`;
  },

  securityModal(filter) {
    const e = U.esc, all = this.securityEvents(24 * 7);
    const list = !filter || filter === 'all' ? all : filter === 'unknown' ? all.filter(x => x.unknown) : filter === 'reset' ? all.filter(x => /^PASSWORD_RESET/.test(x.action))
      : filter.startsWith('ip=') ? all.filter(x => (x.ip || 'this computer') === filter.slice(3)) : all.filter(x => x.action === filter);
    const title = !filter || filter === 'all' ? 'Sign-in security events' : filter === 'unknown' ? 'Sign-ins for user names that do not exist' : filter === 'reset' ? 'Password reset abuse'
      : filter.startsWith('ip=') ? `Sign-in events from ${filter.slice(3)}` : this.SEC[filter]?.[0] || filter;
    UI.modal({ title: `${title} – last 7 days (${list.length})`, wide: true, closeLabel: 'Close',
      body: list.length ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>Event</th><th>User tried</th><th>From</th><th>Details</th></tr></thead><tbody>${list.map(x => `<tr>
          <td>${U.fmtDateTime(x.at)}</td><td>${e(this.SEC[x.action][0])}</td><td>${e(x.account || '–')}${x.unknown ? ' <small class="muted">(no such user)</small>' : ''}</td><td>${e(x.ip || '–')}</td><td><small>${e(x.details || '')}</small></td></tr>`).join('')}</tbody></table></div>
        <p class="muted" style="margin-top:8px">Computers blocked for too many failures can be released under Administration → Users. Locked accounts are unlocked there too.</p>`
        : '<div class="empty">No events in the last 7 days.</div>' });
  },

  /* ---------- administrators: user changes awaiting approval (js/approvals.js); not shown when there are none ---------- */
  approvalItems() {
    if (typeof Approvals === 'undefined') return [];
    const S = Store.state;
    const users = [...Approvals.pendingUsers(S).map(u => ({ u, kind: 'New user', what: `${ROLES[u.role] || u.role}, ${UI.branchName(u.branchId)}`, by: u.createdByName || UI.userName(u.createdBy), at: u.createdAt })),
      ...Approvals.pendingChanges(S).map(u => ({ u, kind: 'Change', what: (u.pendingChange.lines || []).map(l => `${l.field}: ${l.from} → ${l.to}`).join('; '), by: u.pendingChange.byName, at: u.pendingChange.at }))];
    const acc = Approvals.accessPending(S);
    if (acc) users.push({ access: true, kind: 'Access rights', what: `${(acc.changes || []).length} change(s) to access rights`, by: acc.byName, at: acc.at });
    return users.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  },

  approvalsPanel() {
    const items = this.approvalItems(), e = U.esc;
    if (!items.length) return '';
    return `<div class="soc-panel" style="margin-bottom:12px;border-color:#b45309"><h3>User changes awaiting approval <span class="soc-dot warn"></span> <small>${items.length}</small></h3>
      <ul class="soc-feed">${items.map(x => `<li data-drill="${x.access ? 'apacc' : `apu:${e(x.u.id)}`}" tabindex="0" style="cursor:pointer">
        <b>${x.access ? 'Access rights' : e(x.u.name)}</b> <span class="soc-muted">· ${e(x.kind)}</span> – ${e(x.what)}
        <small>asked for by ${e(x.by || '–')}${x.at ? ` · ${U.fmtDateTime(x.at)}` : ''}</small></li>`).join('')}</ul></div>`;
  },

  approvalModal(id) {
    const S = Store.state, u = S.users.find(x => x.id === id), e = U.esc, me = Store.user();
    if (!u) return;
    const p = u.pendingChange, isNew = u.pendingApproval === true;
    const row = (k, v) => `<tr><th style="width:30%">${e(k)}</th><td>${v}</td></tr>`;
    const request = isNew
      ? `<p class="muted" style="margin:0 0 6px">New user created by <b>${e(u.createdByName || UI.userName(u.createdBy) || '–')}</b>${u.createdAt ? `, ${U.fmtDateTime(u.createdAt)}` : ''}. They cannot sign in until another administrator approves them.</p>`
      : `<p class="muted" style="margin:0 0 6px">Asked for by <b>${e(p.byName)}</b>, ${U.fmtDateTime(p.at)}. Nothing changes until another administrator approves it.</p>
         <div class="table-wrap"><table><thead><tr><th>Field</th><th>Now</th><th>After approval</th></tr></thead><tbody>${(p.lines || []).map(l => `<tr><td>${e(l.field)}</td><td>${e(l.from)}</td><td><b>${e(l.to)}</b></td></tr>`).join('')}</tbody></table></div>`;
    const details = `<table><tbody>
      ${row('Name', e(u.name))}${row('Username', `<span class="mono">${e(u.username)}</span>`)}${row('Email', e(u.email || '–'))}
      ${row('Role', e(ROLES[u.role] || u.role))}${row('Home branch', e(UI.branchName(u.branchId)))}
      ${row('Further branches', e((u.extraBranchIds || []).map(b => UI.branchName(b)).join(', ') || 'none'))}
      ${row('Status', u.active === false ? 'Inactive' : isNew ? 'Awaiting approval' : 'Active')}
      ${row('Created', `${u.createdAt ? U.fmtDateTime(u.createdAt) : '–'}${u.createdByName ? ` by ${e(u.createdByName)}` : ''}`)}
      ${row('Approved', u.approvedAt ? `${U.fmtDateTime(u.approvedAt)}${u.approvedByName ? ` by ${e(u.approvedByName)}` : ''}` : '–')}
      ${row('Last sign-in', u.lastLoginAt ? U.fmtDateTime(u.lastLoginAt) : 'never')}</tbody></table>`;
    // Audit trail about this user (their name and username in the entry), and what they did themselves.
    const tag = `(${u.username})`;
    const trail = (S.audit || []).filter(x => String(x.details || '').includes(tag) || (u.name && String(x.details || '').includes(u.name)) || x.userId === u.id)
      .sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 100);
    const audit = trail.length ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>By</th><th>Action</th><th>Details</th></tr></thead><tbody>${trail.map(x => `<tr>
        <td class="nowrap">${U.fmtDateTime(x.at)}</td><td>${e(x.userName || '')}</td><td>${e(Views.actionLabel(x.action))}</td><td><small>${e(x.details || '')}</small>${Array.isArray(x.changes) && x.changes.length ? `<br><small class="muted">${x.changes.map(c => `${e(c.field)}: ${e(c.from)} → ${e(c.to)}`).join('<br>')}</small>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">No audit entries for this user yet.</div>';
    // The decision, where this administrator may take it.
    let buttons = '';
    if (isNew) buttons = u.createdBy === me.id && Approvals.needed() ? '<button class="btn-sm btn-danger" data-ap="withdrawNew">Withdraw</button>' : '<button class="btn-sm btn-success" data-ap="approveNew">Approve</button><button class="btn-sm btn-danger" data-ap="rejectNew">Reject</button>';
    else buttons = Approvals.decideButtons(me, p, [u.id], 'data-ap="change" data-apc');
    const m = UI.modal({ title: `${u.name} – ${isNew ? 'new user awaiting approval' : 'change awaiting approval'}`, wide: true, closeLabel: 'Close',
      body: `<div class="btn-row" style="justify-content:flex-end;margin-bottom:8px">${buttons}</div>
        <h3 style="margin:0 0 6px">${isNew ? 'Request' : 'Change asked for'}</h3>${request}
        <h3 style="margin:14px 0 6px">User details now</h3><div class="table-wrap">${details}</div>
        <h3 style="margin:14px 0 6px">Audit trail <small class="muted">${trail.length} entr${trail.length === 1 ? 'y' : 'ies'}</small></h3>${audit}` });
    const done = (fn, msg) => { try { fn(); UI.toast(msg, 'ok'); m.close(); App.render(); } catch (err) { UI.error(err); } };
    const reason = (own, title, fn) => { m.close(); Approvals.reasonModal(title, own, fn); };
    m.el.querySelector('[data-ap="approveNew"]')?.addEventListener('click', () => done(() => Approvals.approveUser(u), 'Approved. The user can now sign in with the temporary password.'));
    m.el.querySelector('[data-ap="rejectNew"]')?.addEventListener('click', () => reason(false, `Reject ${u.name}`, r => Approvals.rejectUser(u, r)));
    m.el.querySelector('[data-ap="withdrawNew"]')?.addEventListener('click', () => reason(true, `Withdraw ${u.name}`, r => Approvals.rejectUser(u, r)));
    m.el.querySelector('[data-apc-ok]')?.addEventListener('click', () => done(() => Approvals.approveUserChange(u), 'Change approved and applied.'));
    m.el.querySelector('[data-apc-no]')?.addEventListener('click', () => reason(p.by === me.id, `${p.by === me.id ? 'Withdraw' : 'Reject'} the change to ${u.name}`, r => Approvals.rejectUserChange(u, r)));
  },

  onlineModal(filter) {
    const { active, recent } = this.online(), e = U.esc;
    const show = active.filter(u => filter === 'off' ? !recent.has(u.id) : recent.has(u.id) && (filter === 'on' || !filter || u.role === filter));
    const groups = new Map();
    show.forEach(u => Engine.branchesOf(u).slice(0, 1).forEach(b => { if (!groups.has(b)) groups.set(b, []); groups.get(b).push(u); }));
    const title = filter === 'off' ? 'Users not online' : filter && filter !== 'on' ? `Online – ${DASH_DEPARTMENTS[filter]}` : 'Users online';
    UI.modal({ title: `${title} (${show.length})`, wide: true, closeLabel: 'Close',
      body: [...groups.entries()].sort((a, b) => UI.branchName(a[0]).localeCompare(UI.branchName(b[0]))).map(([b, list]) => `<h3 style="margin:12px 0 6px">${e(UI.branchName(b))} <small class="muted">${list.length}</small></h3>
        <div class="table-wrap"><table><thead><tr><th>User</th><th>Department</th><th>Branches</th><th>Last active</th></tr></thead><tbody>${list.map(u => { const s = recent.get(u.id);
          return `<tr><td><b>${e(u.name)}</b><br><small>${e(u.username)}</small></td><td>${e(DASH_DEPARTMENTS[u.role] || u.role)}</td><td><small>${e(Engine.branchesOf(u).map(x => UI.branchName(x)).join(', '))}</small></td><td>${s ? (s.idleSeconds < 60 ? 'now' : `${Math.round(s.idleSeconds / 60)} min ago`) : u.lastLoginAt ? `last sign-in ${U.fmtDateTime(u.lastLoginAt)}` : 'never signed in'}</td></tr>`; }).join('')}</tbody></table></div>`).join('') || '<div class="empty">Nobody here.</div>' });
  },
};

window.__dashLoadedAt = new Date().toISOString();

(() => {
  // Styles of the operations-centre look: a dark canvas in both the light and the dark theme.
  const css = `
  .soc { --soc-bg:#0b1220; --soc-panel:#111a2e; --soc-line:#1f2b46; --soc-ink:#e2e8f0; --soc-ink2:#94a3b8; --soc-track:#1e293b;
    background:var(--soc-bg); color:var(--soc-ink); border-radius:14px; padding:16px; margin:-4px 0 0; }
  .soc a { color:#7dd3fc; } .soc h2 { margin:0; color:#f8fafc; font-size:18px; } .soc h3 { margin:0 0 10px; font-size:13px; letter-spacing:.04em; text-transform:uppercase; color:var(--soc-ink2); display:flex; align-items:center; gap:8px; }
  .soc h3 small { text-transform:none; letter-spacing:0; font-weight:400; }
  .soc-head { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:14px; } .soc-head small { color:var(--soc-ink2); }
  .soc .btn-sm, .soc .btn { background:#1e293b; color:#e2e8f0; border-color:#334155; } .soc .btn-primary { background:#2563eb; border-color:#2563eb; color:#fff; }
  .soc-tiles { display:grid; grid-template-columns:repeat(auto-fill,minmax(170px,1fr)); gap:12px; margin-bottom:12px; }
  .soc-tile { background:var(--soc-panel); border:1px solid var(--soc-line); border-radius:12px; padding:12px 14px; cursor:pointer; position:relative; overflow:hidden; }
  .soc-tile:hover, .soc-tile:focus { border-color:#38bdf8; outline:none; box-shadow:0 0 0 1px #38bdf8 inset, 0 0 18px rgba(56,189,248,.18); }
  .soc-tile.alert { border-color:#7f1d1d; box-shadow:0 0 16px rgba(251,113,133,.18); }
  .soc-tile .v { font-size:28px; font-weight:700; line-height:1.1; font-variant-numeric:tabular-nums; } .soc-tile .l { color:var(--soc-ink2); font-size:12.5px; margin-top:2px; }
  .soc-spark { width:100%; height:26px; margin-top:6px; }
  .soc-grid { display:grid; gap:12px; margin-bottom:12px; } .soc-grid.g2 { grid-template-columns:1fr 1fr; } .soc-grid.g21 { grid-template-columns:2fr 1fr; } .soc-grid.g3, .soc-grid.g-sys { grid-template-columns:1fr 1fr 1fr; }
  @media (max-width: 1000px) { .soc-grid.g2, .soc-grid.g21, .soc-grid.g3, .soc-grid.g-sys { grid-template-columns:1fr; } }
  .soc-panel { background:var(--soc-panel); border:1px solid var(--soc-line); border-radius:12px; padding:14px; min-width:0; }
  .soc-muted { color:var(--soc-ink2); font-size:12.5px; }
  .soc-bars { display:flex; flex-direction:column; gap:7px; } .soc-bar { display:grid; grid-template-columns:minmax(70px, 38%) 1fr auto; gap:8px; align-items:center; cursor:pointer; font-size:12.5px; }
  .soc-bar .l { color:var(--soc-ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } .soc-bar .t { background:var(--soc-track); border-radius:6px; height:12px; overflow:hidden; }
  .soc-bar .t span { display:block; height:100%; border-radius:6px; box-shadow:0 0 10px currentColor; } .soc-bar .v { min-width:34px; text-align:right; font-variant-numeric:tabular-nums; color:#f8fafc; }
  .soc-bar:hover .l, .soc-bar:focus .l { color:#7dd3fc; } .soc-bar:focus { outline:none; }
  .soc-donut { display:flex; gap:14px; align-items:center; flex-wrap:wrap; } .soc-donut svg { width:150px; height:150px; flex:none; } .soc-donut circle[data-drill] { cursor:pointer; } .soc-donut circle[data-drill]:hover { stroke-width:22; }
  .soc-big { fill:#f8fafc; font-size:22px; font-weight:700; } .soc-small { fill:var(--soc-ink2); font-size:10px; }
  .soc-legend { list-style:none; margin:0; padding:0; display:grid; gap:4px; flex:1; min-width:150px; font-size:12.5px; } .soc-legend li { display:flex; align-items:center; gap:7px; cursor:pointer; } .soc-legend li:hover { color:#7dd3fc; }
  .soc-legend b { margin-left:auto; font-variant-numeric:tabular-nums; } .soc-legend i, .soc-key i { width:10px; height:10px; border-radius:3px; display:inline-block; flex:none; }
  .soc-area { width:100%; height:auto; } .soc-area rect { cursor:pointer; } .soc-area rect:hover { fill:rgba(148,163,184,.12); } .soc-grid line, .soc-area .soc-grid { stroke:#1e293b; } .soc-axis { fill:var(--soc-ink2); font-size:9px; }
  .soc-key { display:flex; flex-wrap:wrap; gap:6px 14px; margin-top:8px; font-size:12.5px; } .soc-key span { display:inline-flex; align-items:center; gap:6px; } .soc-key span[data-drill] { cursor:pointer; } .soc-key span[data-drill]:hover { color:#7dd3fc; }
  .soc-center { display:flex; justify-content:center; cursor:pointer; } .soc-gauge { width:220px; max-width:100%; }
  .soc-queues { display:grid; grid-template-columns:1fr 1fr; gap:8px; } .soc-queues a { background:#0f172a; border:1px solid var(--soc-line); border-radius:10px; padding:8px 10px; color:var(--soc-ink); text-decoration:none; display:flex; flex-direction:column; }
  .soc-queues a b { font-size:20px; color:#f8fafc; } .soc-queues a span { font-size:12px; color:var(--soc-ink2); } .soc-queues a.alert { border-color:#7c2d12; } .soc-queues a.alert b { color:#fbbf24; } .soc-queues a:hover { border-color:#38bdf8; }
  .soc-feed { list-style:none; margin:0; padding:0; display:grid; gap:7px; font-size:12.5px; } .soc-feed.cols { grid-template-columns:1fr 1fr; } .soc-feed small { display:block; color:var(--soc-ink2); }
  .soc-check { display:flex; align-items:center; gap:8px; font-size:12.5px; padding:4px 0; border-bottom:1px solid var(--soc-line); } .soc-check:last-child { border-bottom:0; }
  .soc-check i, .soc-dot { width:9px; height:9px; border-radius:50%; flex:none; display:inline-block; }
  .soc-check.ok i, .soc-dot.ok { background:#34d399; box-shadow:0 0 8px #34d399; } .soc-check.warn i, .soc-dot.warn { background:#fbbf24; box-shadow:0 0 8px #fbbf24; } .soc-check.bad i, .soc-dot.bad { background:#fb7185; box-shadow:0 0 8px #fb7185; }
  .soc-uptime { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:18px 6px; border-radius:12px; background:#0f172a; border:1px solid var(--soc-line); }
  .soc-uptime small { color:var(--soc-ink2); font-size:12.5px; margin-top:6px; }
  .soc-clock { display:flex; align-items:flex-start; gap:4px; font-variant-numeric:tabular-nums; } .soc-clock span { display:flex; flex-direction:column; align-items:center; }
  .soc-clock b { font-size:28px; line-height:1.1; color:#f8fafc; } .soc-clock i { font-style:normal; font-size:10px; letter-spacing:.06em; color:var(--soc-ink2); margin-top:2px; } .soc-clock em { font-style:normal; font-size:24px; line-height:1.15; color:var(--soc-ink2); }
  @media (max-width: 1300px) { .soc-clock b { font-size:22px; } .soc-clock em { font-size:19px; } }
  .soc-uptime.ok { box-shadow:0 0 22px rgba(52,211,153,.15) inset; } .soc-uptime.warn { box-shadow:0 0 22px rgba(251,191,36,.18) inset; } .soc-uptime.bad { box-shadow:0 0 22px rgba(251,113,133,.22) inset; }
  .soc .card { background:var(--soc-panel); border-color:var(--soc-line); color:var(--soc-ink); --ink:var(--soc-ink); --ink-2:var(--soc-ink2); --ink-3:var(--soc-ink2); --line:var(--soc-line); --card:var(--soc-panel); }
  .soc .card .card-h { border-color:var(--soc-line); } .soc .kpi { background:#0f172a; border-color:var(--soc-line); color:var(--soc-ink); }
  #view.dash-full { max-width:none; flex:1; display:flex; flex-direction:column; } #view.dash-wide { max-width:none; } #view.dash-full > .soc { flex:1; }
  .soc-sel { margin-left:auto; background:#0f172a; color:var(--soc-ink); border:1px solid #334155; border-radius:7px; padding:3px 6px; font:inherit; font-size:12px; text-transform:none; letter-spacing:0; max-width:60%; }
  .soc-head .soc-sel { margin-left:6px; max-width:none; } .soc-head label { display:inline-flex; align-items:center; }
  .soc-key .soc-more { margin-left:auto; font-weight:600; }
  .dash-br { display:flex; flex-wrap:wrap; gap:4px 14px; margin-top:6px; } .dash-br label { display:inline-flex; align-items:center; gap:5px; font-size:12.5px; cursor:pointer; }`;
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  const baseDashboard = Views.dashboard.bind(Views);
  Views.dashboard = function () {
    const u = Store.user();
    if (!u) return baseDashboard();
    clearInterval(Dash.timer); clearInterval(Dash.ticker);
    // Both dashboard views use the whole content area beside the menu (no 1400px cap), until another page replaces them.
    const view = document.getElementById('view');
    view.classList.remove('dash-full', 'dash-wide');
    window.addEventListener('hashchange', () => setTimeout(() => { if (!['', '#', '#/', '#/dashboard'].includes(location.hash)) view.classList.remove('dash-full', 'dash-wide'); }), { once: true });
    if (Dash.mode(u) === 'classic') {
      baseDashboard();
      view.classList.add('dash-wide');
      view.insertAdjacentHTML('afterbegin', '<div class="btn-row" style="justify-content:flex-end;margin-bottom:10px"><button class="btn-sm" id="dash-graphical">◔ Graphical view</button></div>');
      U.$('#dash-graphical').addEventListener('click', () => Dash.setMode('graphical'));
      return;
    }
    UI.setTitle('Dashboard', `${ROLES[u.role]} · ${UI.branchName(Engine.workingBranch(u))}`);
    Dash.render();
    view.classList.add('dash-full');
  };

  /* Each dashboard panel is an access right (group "Dashboard"), so Administration → Access rights gives or takes it
     away per role and per user like any other right. */
  const baseCatalogue = Access.catalogue.bind(Access);
  Access.catalogue = function () {
    if (this.list) return this.list;
    const base = baseCatalogue(), at = base.findIndex(r => r.group !== 'Views');
    const dash = DASH_PANELS.map(([k, label, desc, roles]) => ({ key: `dash.${k}`, group: 'Dashboard', label: `Dashboard: ${label}`, desc, roles: roles || ALL_ROLES }));
    this.list = [...base.slice(0, at), ...dash, ...base.slice(at)];
    this.map = Object.fromEntries(this.list.map(r => [r.key, r]));
    return this.list;
  };
  Access.list = null; Access.map = null;
  // Access rights keep the dashboard branch settings (Store.state.access.dash) when they are saved.
  const baseClean = Access.clean.bind(Access);
  Access.clean = function (A) {
    const out = baseClean(A), d = Store.state.access?.dash;
    if (d && Object.keys(d).length) out.dash = d;
    return out;
  };

  /* Administration → Dashboards: which branches each user may view on the dashboard. */
  Admin.tabs.splice(Math.max(0, Admin.tabs.findIndex(t => t[0] === 'access') + 1), 0, ['dashboards', 'Dashboards']);
  Admin.dashboards = () => DashAdmin.render();
})();

const DashAdmin = {
  draft: null,

  saved() { return U.clone(Access.state().dash || {}); },
  describe(v, u) { return v === 'ALL' ? 'All branches' : Array.isArray(v) ? `Own branch plus ${v.map(b => UI.branchName(b)).join(', ') || 'nothing else'}` : u.role === 'ADMIN' ? 'All branches (administrator standard)' : 'Own branch only (standard)'; },

  render() {
    const S = Store.state, e = U.esc;
    if (!this.draft) this.draft = this.saved();
    const D = this.draft, changed = JSON.stringify(D) !== JSON.stringify(this.saved());
    const users = S.users.filter(u => u.active !== false).sort((a, b) => a.name.localeCompare(b.name));
    const panels = Access.catalogue().filter(r => r.group === 'Dashboard');
    U.$('#adm').innerHTML = `
      <div class="alert info" style="margin-bottom:12px"><div>Choose which branches each user may view on the graphical dashboard. Users see their <b>own branch</b> by default and can switch to any branch given here.
        The two reconciliation panels (<i>Advance payment reconciliation</i> and <i>Unreconciled items</i>) always open on the <b>whole bank</b>, and users can narrow them to their own or any other branch.
        Which panels each role or user sees is set under <a href="#/admin/access">Access rights → Dashboard</a>.</div></div>
      <div class="toolbar"><button class="btn-primary" id="db-save" ${changed ? '' : 'disabled'}>Save dashboard settings</button><button id="db-discard" ${changed ? '' : 'disabled'}>Discard changes</button></div>
      <div class="card"><div class="card-h"><h2>Dashboard branches by user</h2></div>
        <div class="card-b tight"><div class="table-wrap"><table>
          <thead><tr><th>User</th><th>Own branch</th><th>May view on the dashboard</th><th>Panels shown</th></tr></thead>
          <tbody>${users.map(u => {
            const v = D[u.id], mode = v === 'ALL' ? 'ALL' : Array.isArray(v) ? 'PICK' : '', home = Engine.branchesOf(u);
            const n = panels.filter(r => Access.has(u, r.key)).length;
            return `<tr><td><b>${e(u.name)}</b><br><small class="muted">${e(ROLES[u.role])}</small></td>
              <td>${e(home.map(b => UI.branchName(b)).join(', '))}</td>
              <td><select data-dbu="${u.id}" aria-label="Dashboard branches for ${e(u.name)}">
                  <option value="" ${mode === '' ? 'selected' : ''}>${u.role === 'ADMIN' ? 'Standard – all branches' : 'Standard – own branch only'}</option>
                  <option value="ALL" ${mode === 'ALL' ? 'selected' : ''}>All branches</option>
                  <option value="PICK" ${mode === 'PICK' ? 'selected' : ''}>Own branch plus chosen branches…</option></select>
                ${mode === 'PICK' ? `<div class="dash-br">${S.branches.map(b => { const own = home.includes(b.id);
                  return `<label><input type="checkbox" data-dbb="${u.id}" value="${b.id}" ${own || v.includes(b.id) ? 'checked' : ''} ${own ? 'disabled' : ''}>${e(b.name)}</label>`; }).join('')}</div>` : ''}</td>
              <td>${n} of ${panels.length} <a href="#/admin/access" data-dbacc="${u.id}">change</a></td></tr>`;
          }).join('')}</tbody></table></div></div></div>`;
    U.$$('#adm [data-dbu]').forEach(sel => sel.addEventListener('change', () => {
      const id = sel.dataset.dbu;
      if (sel.value === 'ALL') D[id] = 'ALL'; else if (sel.value === 'PICK') D[id] = Array.isArray(D[id]) ? D[id] : []; else delete D[id];
      this.render();
    }));
    U.$$('#adm [data-dbb]').forEach(cb => cb.addEventListener('change', () => {
      const id = cb.dataset.dbb, list = new Set(D[id] || []);
      if (cb.checked) list.add(cb.value); else list.delete(cb.value);
      D[id] = [...list];
      this.render();
    }));
    U.$$('#adm [data-dbacc]').forEach(a => a.addEventListener('click', () => { Access.selUser = a.dataset.dbacc; }));
    U.$('#db-discard').addEventListener('click', () => { this.draft = null; this.render(); });
    U.$('#db-save').addEventListener('click', () => this.save());
  },

  save() {
    const before = this.saved(), after = {};
    Object.entries(this.draft).forEach(([id, v]) => { if (Store.userById(id) && (v === 'ALL' || Array.isArray(v))) after[id] = v; });
    const changes = [...new Set([...Object.keys(before), ...Object.keys(after)])].map(id => {
      const u = Store.userById(id);
      const a = u && this.describe(before[id], u), b = u && this.describe(after[id], u);
      return u && a !== b ? { field: `${u.name} – Dashboard branches`, from: a, to: b } : null;
    }).filter(Boolean);
    const A = Store.state.access = Store.state.access || { roles: {}, users: {} };
    if (Object.keys(after).length) A.dash = after; else delete A.dash;
    Store.audit('ACCESS_UPDATED', null, `Dashboard branches changed (${changes.length} change${changes.length === 1 ? '' : 's'})`, changes);
    Store.save();
    this.draft = null;
    UI.toast('Dashboard settings saved.', 'ok');
    this.render();
  },
};
