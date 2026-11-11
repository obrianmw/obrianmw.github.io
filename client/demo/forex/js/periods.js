'use strict';

/* End of day (EOD), end of month (EOM) and end of year (EOY), with backups.

   Closing a period: pre-checks → catch-up of the reminder scheduler → a snapshot of the period's activity and the
   positions at close → a saved, exportable report → backups to every destination set up for that kind of close.
   EOY ⊃ EOM ⊃ EOD: closing a month first closes its last business day (and any missed days before it); closing a year
   first closes December. Re-running needs the period reopened (with a reason). Everything is in the audit trail.

   Backups: in the prototype (browser only) the whole state plus uploaded files becomes one JSON file, downloaded or
   written to folders the user picks (another drive, USB stick, network share, OneDrive/Google Drive folder), optionally
   encrypted (AES-256-GCM). In the server versions the server backs up the database and copies it to its configured
   destinations (Backup.java); this screen manages them.

   Records live in Store.state.periods (server versions: the shared "periods" collection). */

const PERIOD_KINDS = { EOD: 'End of day', EOM: 'End of month', EOY: 'End of year' };

const Periods = {
  /* ---------- settings, keys, calendar ---------- */
  cfg() {
    return Object.assign({ closeWeekends: false, holidays: [], afterEod: 'allow', remind: true, backupOn: ['EOD', 'EOM', 'EOY'] },
      Store.state.settings.eod || {});
  },
  list() { Store.state.periods = Store.state.periods || []; return Store.state.periods; },
  today() { return U.dayKey(Store.now()); },
  closed(kind, key) { return this.list().find(p => p.kind === kind && p.key === key && p.status !== 'REOPENED'); },
  latest(kind) { return this.list().filter(p => p.kind === kind && p.status !== 'REOPENED').sort((a, b) => b.key.localeCompare(a.key))[0]; },
  holidayKeys() { return this.cfg().holidays.map(h => String(h).slice(0, 10)); },
  isBusinessDay(k) { return (this.cfg().closeWeekends || !U.isWeekend(U.parseDay(k))) && !this.holidayKeys().includes(k); },
  monthKey(k) { return k.slice(0, 7); },
  monthName(m) { const d = U.parseDay(`${m}-01`); return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); },
  lastBusinessDay(y, m) { let d = new Date(y, m + 1, 0); for (let i = 0; i < 31 && !this.isBusinessDay(U.dayKey(d)); i++) d = U.addDays(d, -1); return U.dayKey(d); },
  prevMonth(m) { const d = U.parseDay(`${m}-01`); return U.dayKey(new Date(d.getFullYear(), d.getMonth() - 1, 1)).slice(0, 7); },
  startISO(k) { return U.parseDay(k).toISOString(); },
  endISO(k) { return new Date(U.addDays(U.parseDay(k), 1).getTime() - 1).toISOString(); },
  label(p) { return p.kind === 'EOD' ? U.fmtDate(p.key) : p.kind === 'EOM' ? this.monthName(p.key) : p.key; },

  can(user = Store.user()) { return Access.has(user, 'act.eod'); },
  canView(user = Store.user()) { return Access.has(user, 'view.eod') || this.can(user); },

  /* Business days after the last closed EOD and before `before` that were never closed (oldest first). */
  missedDays(before) {
    const last = this.latest('EOD');
    if (!last) return [];
    const out = [];
    for (let d = U.addDays(U.parseDay(last.key), 1); U.dayKey(d) < before && out.length < 400; d = U.addDays(d, 1)) {
      const k = U.dayKey(d);
      if (this.isBusinessDay(k) && !this.closed('EOD', k)) out.push(k);
    }
    return out;
  },

  /* ---------- pre-checks and the plan of what will be closed ---------- */
  check(kind, key) {
    const S = Store.state, today = this.today(), now = Store.now();
    const blockers = [], warnings = [], info = [], plan = [];
    let interim = false;
    if (!this.can()) blockers.push('You do not have the right to run end-of-period processing (Access rights → "Run end of day / month / year").');
    if (typeof Live !== 'undefined' && Live.saving) blockers.push('Changes are still being saved to the server. Wait a few seconds and check again.');
    const addEod = k => { if (!this.closed('EOD', k) && !plan.some(p => p.kind === 'EOD' && p.key === k)) plan.push({ kind: 'EOD', key: k }); };

    if (kind === 'EOD') {
      if (!/^\d{4}-\d\d-\d\d$/.test(key || '')) blockers.push('Choose the business date to close.');
      else if (key > today) blockers.push('You cannot close a future date.');
      else if (this.closed('EOD', key)) blockers.push(`End of day for ${U.fmtDate(key)} is already closed. Reopen it under History to run it again.`);
      else {
        const missed = this.missedDays(key);
        if (missed.length > 62) blockers.push(`${missed.length} business days since the last end of day were never closed. Close them in smaller steps (pick an earlier date first).`);
        else if (missed.length) info.push(`${missed.length} earlier business day(s) were not closed and will be closed first: ${missed.map(U.fmtDate).join(', ')}. Their positions are recorded as at now.`);
        missed.forEach(addEod); addEod(key);
        if (!this.isBusinessDay(key)) warnings.push(`${U.fmtDate(key)} is a weekend or holiday. It will be closed anyway.`);
        if (key === today) {
          const [h, m] = S.settings.fundingCutoff.split(':').map(Number);
          const cut = new Date(now); cut.setHours(h, m, 0, 0);
          if (now < cut) warnings.push(`It is before today's funding cut-off (${S.settings.fundingCutoff}). Allocations still awaiting funding are carried forward, not forfeited.`);
        }
      }
    } else if (kind === 'EOM') {
      if (!/^\d{4}-\d\d$/.test(key || '')) blockers.push('Choose the month to close.');
      else {
        const [y, mo] = key.split('-').map(Number);
        const lbd = this.lastBusinessDay(y, mo - 1);
        if (this.closed('EOM', key)) blockers.push(`${this.monthName(key)} is already closed. Reopen it under History to run it again.`);
        else if (today < lbd) { blockers.push(`${this.monthName(key)} can be closed on or after its last business day (${U.fmtDate(lbd)}).`); interim = true; }
        else {
          const prev = this.prevMonth(key);
          if (this.list().some(p => p.kind === 'EOM' && p.key < key && p.status !== 'REOPENED') && !this.closed('EOM', prev)) blockers.push(`Close ${this.monthName(prev)} first: months are closed in order.`);
          const missed = this.missedDays(lbd);
          if (missed.length > 62) blockers.push(`${missed.length} business days were never closed. Run end of day for earlier dates first.`);
          missed.forEach(addEod);
          addEod(lbd);
          if (plan.length > 1) info.push(`${plan.length} end-of-day close(s) are included first, ending with ${U.fmtDate(lbd)}.`);
          plan.push({ kind: 'EOM', key });
        }
      }
    } else if (kind === 'EOY') {
      const y = Number(key);
      if (!(y > 2000 && y < 2100)) blockers.push('Choose the year to close.');
      else {
        const dec = `${y}-12`, lbd = this.lastBusinessDay(y, 11);
        if (this.closed('EOY', String(y))) blockers.push(`${y} is already closed. Reopen it under History to run it again.`);
        else if (today < lbd) { blockers.push(`${y} can be closed on or after its last business day (${U.fmtDate(lbd)}).`); interim = true; }
        else {
          if (this.list().some(p => p.kind === 'EOY' && Number(p.key) < y && p.status !== 'REOPENED') && !this.closed('EOY', String(y - 1))) blockers.push(`Close ${y - 1} first: years are closed in order.`);
          if (!this.closed('EOM', dec)) {
            const sub = this.check('EOM', dec);
            sub.blockers.filter(b => !/^You do not have/.test(b)).forEach(b => blockers.push(b));
            sub.plan.forEach(p => plan.push(p));
            info.push(`December ${y} is not closed yet, so it is closed first.`);
          }
          plan.push({ kind: 'EOY', key: String(y) });
        }
      }
    }

    // Open items carried forward (warnings only).
    const apps = S.apps;
    const n = f => apps.filter(f).length;
    const pendingAuth = n(a => a.status === 'PENDING_AUTH'), allocated = n(a => a.status === 'ALLOCATED'), funded = n(a => Engine.totals(a).fundedUnpaid > 0);
    const overdue = Engine.unreconciled().filter(a => a.recon.dueDate < today).length;
    if (pendingAuth) warnings.push(`${pendingAuth} application(s) are waiting for authorisation and carry forward.`);
    if (allocated) warnings.push(`${allocated} allocation(s) are still waiting for the client to fund.`);
    if (funded) warnings.push(`${funded} funded transaction(s) are not paid yet.`);
    if (overdue) warnings.push(`${overdue} advance payment reconciliation(s) are overdue.`);
    const drafts = n(a => a.status === 'DRAFT' && U.daysBetween(a.createdAt, now) > 7);
    if (drafts) info.push(`${drafts} draft(s) are older than 7 days.`);
    if (typeof Live !== 'undefined') info.push('Ask other users to finish and save their work: changes made after closing count towards the next day.');
    if (kind !== 'EOD' || plan.length) info.push(`Backups after closing: ${Backups.summary(kind)}.`);
    return { blockers, warnings, info, plan, interim };
  },

  /* ---------- the snapshot: activity in (from, to] plus positions at close ---------- */
  snapshot(from, to) {
    const S = Store.state, today = this.today();
    const inW = iso => !!iso && iso > from && iso <= to;
    const activity = {};
    S.audit.forEach(e => { if (e.appId && inW(e.at)) activity[e.action] = (activity[e.action] || 0) + 1; });
    const money = {}, branches = {}, finished = { PAID: 0, SHORT: 0, EXPIRED: 0, REJECTED: 0 };
    const m = c => (money[c] = money[c] || { allocated: 0, allocMWK: 0, forfeited: 0, paid: 0, paidMWK: 0, paidUSD: 0 });
    const b = id => (branches[id] = branches[id] || { submitted: 0, authorised: 0, payments: 0, paidUSD: 0, finished: 0, open: 0 });
    const pos = { byStatus: {}, awaitingFunding: {}, fundedUnpaid: {}, unallocated: {} };
    const addPos = (k, c, v) => { if (v > 0.005) pos[k][c] = U.round2((pos[k][c] || 0) + v); };
    S.apps.forEach(a => {
      (a.allocations || []).forEach(al => {
        if (inW(al.at)) { m(a.currency).allocated += al.amount; m(a.currency).allocMWK += al.amount * al.rate; }
        if (al.status === 'FORFEITED' && inW(al.forfeitedAt)) m(a.currency).forfeited += al.amount;
      });
      (a.payments || []).forEach(p => {
        if (!inW(p.at) || p.reversed) return;
        const usd = Rules.toUSD(p.amount, a.currency);
        m(a.currency).paid += p.amount; m(a.currency).paidMWK += p.mwk; m(a.currency).paidUSD += usd;
        b(a.branchId).payments++; b(a.branchId).paidUSD += usd;
      });
      if (inW(a.submittedAt)) b(a.branchId).submitted++;
      if (inW(a.authorisedAt)) b(a.branchId).authorised++;
      const out = Reports.outcomeOf(a);
      if (out && inW(Reports.finishedAt(a))) { finished[out] = (finished[out] || 0) + 1; b(a.branchId).finished++; }
      pos.byStatus[a.status] = (pos.byStatus[a.status] || 0) + 1;
      if (Engine.isOpen(a) && a.status !== 'DRAFT') {
        b(a.branchId).open++;
        const t = Engine.totals(a);
        addPos('awaitingFunding', a.currency, t.awaitingFunding);
        addPos('fundedUnpaid', a.currency, t.fundedUnpaid);
        if (ACTIVE_POST_AUTH.includes(a.status)) addPos('unallocated', a.currency, t.unallocated);
      }
    });
    Object.values(money).forEach(r => Object.keys(r).forEach(k => { r[k] = U.round2(r[k]); }));
    Object.values(branches).forEach(r => { r.paidUSD = U.round2(r.paidUSD); });
    const unrec = Engine.unreconciled();
    const messages = {};
    S.outbox.forEach(x => { if (inW(x.at)) messages[x.audience] = (messages[x.audience] || 0) + 1; });
    return {
      from, to, activity, money, finished, branches, messages, positions: pos,
      exceptions: {
        pendingAuth: pos.byStatus.PENDING_AUTH || 0, drafts: pos.byStatus.DRAFT || 0,
        unreconciled: unrec.length, overdue: unrec.filter(a => a.recon.dueDate < today).length,
        aged: S.apps.filter(a => Engine.isOpen(a) && Engine.ageDays(a) > S.settings.agingDays).length,
      },
      openItems: S.apps.filter(a => Engine.isOpen(a) && a.status !== 'DRAFT').map(a => ({ ref: a.ref, customer: a.customer?.name, branch: a.branchId, status: a.status, currency: a.currency, amount: a.amount })),
    };
  },

  windowFor(item, nowISO, prevTo) {
    if (item.kind === 'EOD') {
      const from = prevTo && prevTo < this.endISO(item.key) ? prevTo : this.startISO(item.key);
      const to = item.key < this.today() ? this.endISO(item.key) : nowISO;
      return { from, to };
    }
    if (item.kind === 'EOM') {
      const [y, mo] = item.key.split('-').map(Number);
      return { from: new Date(y, mo - 1, 1).toISOString(), to: [this.endISO(U.dayKey(new Date(y, mo, 0))), nowISO].sort()[0] };
    }
    const y = Number(item.key);
    return { from: new Date(y, 0, 1).toISOString(), to: [this.endISO(`${y}-12-31`), nowISO].sort()[0] };
  },

  /* ---------- run ---------- */
  async run(kind, key, opts = {}, progress = () => {}) {
    const chk = this.check(kind, key);
    if (chk.blockers.length) throw new WorkflowError(chk.blockers[0]);
    if (chk.warnings.length && !opts.acknowledged) throw new WorkflowError('Tick "I have reviewed the warnings" to continue.');
    const u = Store.user();
    progress('Running the reminder scheduler (forfeitures, expiries)…');
    if (Engine.runScheduler()) Store.save();
    const nowISO = Store.now().toISOString();
    const created = [];
    let prevTo = this.latest('EOD')?.to || null;
    for (const item of chk.plan) {
      progress(`Closing ${PERIOD_KINDS[item.kind].toLowerCase()} ${item.kind === 'EOD' ? U.fmtDate(item.key) : item.key}…`);
      const win = this.windowFor(item, nowISO, prevTo);
      if (item.kind === 'EOD') prevTo = win.to;
      const versions = this.list().filter(p => p.kind === item.kind && p.key === item.key).length;
      const rec = {
        id: `${item.kind}-${item.key}${versions ? `-v${versions + 1}` : ''}`, kind: item.kind, key: item.key, version: versions + 1,
        status: 'CLOSED', runAt: nowISO, runBy: u.id, runByName: u.name, from: win.from, to: win.to,
        catchUp: item.kind === 'EOD' && item.key !== key && item.key < this.today(),
        warnings: item === chk.plan[chk.plan.length - 1] ? chk.warnings : [],
        snapshot: this.snapshot(win.from, win.to), backup: null,
      };
      if (item.kind === 'EOY' && opts.restartNumbering) rec.restartNumbering = Number(item.key) + 1;
      this.list().push(rec);
      created.push(rec);
      Store.audit('PERIOD_CLOSED', null, `${PERIOD_KINDS[item.kind]} closed: ${this.label(rec)}${rec.catchUp ? ' (catch-up)' : ''}`);
    }
    const last = created[created.length - 1];
    if (last.restartNumbering) {
      progress('Setting reference numbering for the new year…');
      await this.restartNumbering(last.restartNumbering);
      Store.audit('NUMBERING_RESTART', null, `Application references restart at 00001 from 1 January ${last.restartNumbering}`);
    }
    Store.save();
    if (typeof Live !== 'undefined') {
      await Live.flush();
      const mine = this.list().find(p => p.id === last.id);
      if (!mine || mine.runAt !== nowISO) throw new WorkflowError(`${PERIOD_KINDS[last.kind]} ${this.label(last)} was closed by someone else at the same moment. See History.`);
    }
    if (this.cfg().backupOn.includes(kind)) {
      progress('Backing up…');
      try { last.backup = await Backups.run(`${PERIOD_KINDS[kind]} ${this.label(last)}`, kind, opts.passphrase, opts.prepared); } catch (e) { last.backup = { ok: false, error: e.message, results: [] }; }
      if (!last.backup.ok) last.warnings = [...last.warnings, `Backup problem: ${last.backup.error || 'one or more destinations failed'}`];
      Store.save();
    }
    return created;
  },

  async restartNumbering(year) {
    if (typeof Live !== 'undefined') await Live.api('POST', '/api/period/seq-restart', { year });
    else Store.state.seqRestartYear = year;
  },

  /* Reopen a closed period (to run it again). A month cannot be reopened while its year is closed, nor a day while its month is. */
  async reopen(rec) {
    if (!this.can()) throw new WorkflowError('You do not have the right to reopen periods.');
    const parent = rec.kind === 'EOD' ? this.closed('EOM', this.monthKey(rec.key)) : rec.kind === 'EOM' ? this.closed('EOY', rec.key.slice(0, 4)) : null;
    if (parent) throw new WorkflowError(`Reopen ${PERIOD_KINDS[parent.kind].toLowerCase()} ${this.label(parent)} first.`);
    let reason = '';
    const ok = await new Promise(res => UI.modal({
      title: `Reopen ${PERIOD_KINDS[rec.kind].toLowerCase()} ${this.label(rec)}`,
      body: `<p>The report stays in History, marked as reopened. You can then run this close again; its new report becomes version ${rec.version + 1}.</p><label class="f"><span>Reason (required)</span><textarea name="reason" rows="3"></textarea></label>`,
      actions: [{ label: 'Reopen', cls: 'btn-danger', onClick: el => { reason = UI.formData(el).reason.trim(); if (!reason) { UI.toast('Give a reason.', 'error'); return false; } res(true); } }],
      onOpen: el => el.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => res(false))),
    }));
    if (!ok) return false;
    rec.status = 'REOPENED'; rec.reopenedAt = Store.now().toISOString(); rec.reopenedBy = Store.user().name; rec.reopenReason = reason;
    Store.audit('PERIOD_REOPENED', null, `${PERIOD_KINDS[rec.kind]} ${this.label(rec)} reopened: ${reason}`);
    Store.save();
    return true;
  },

  /* Work after EOD: blocked when the setting says so and today is closed. */
  blocked() { return this.cfg().afterEod === 'block' && !!this.closed('EOD', this.today()); },

  /* ---------- report model (screen and export) ---------- */
  model(rec, interim = false) {
    const s = rec.snapshot, name = UI.branchName.bind(UI);
    const ccys = [...new Set([...Object.keys(s.money), ...Object.keys(s.positions.awaitingFunding), ...Object.keys(s.positions.fundedUnpaid), ...Object.keys(s.positions.unallocated)])].sort();
    const act = [['SUBMITTED', 'Submitted'], ['AUTHORISED', 'Authorised'], ['RETURNED', 'Returned to inputter'], ['REJECTED', 'Rejected'], ['REJECTED_AT_INPUT', 'Rejected at input'],
      ['ALLOCATED', 'Allocations'], ['FUNDING_CONFIRMED', 'Funding confirmed'], ['ALLOCATION_FORFEITED', 'Allocations forfeited'], ['EC_RECOMMENDATION', 'EC recommendations'],
      ['ASSIGNED', 'Assigned'], ['PAYMENT_RECORDED', 'Payments recorded'], ['RECONCILED', 'Reconciled'], ['EXPIRED', 'Closed – not allocated'], ['CREATED', 'Captured']];
    const sections = [
      { heading: 'Summary', columns: [{ label: 'Item' }, { label: 'Value' }], rows: [
        ['Period', `${PERIOD_KINDS[rec.kind]} – ${this.label(rec)}${interim ? ' (interim, not closed)' : ''}`],
        ['Activity covered', `${U.fmtDateTime(s.from)} – ${U.fmtDateTime(s.to)}`],
        ...(interim ? [] : [['Status', rec.status === 'REOPENED' ? `Reopened ${U.fmtDateTime(rec.reopenedAt)} by ${rec.reopenedBy}: ${rec.reopenReason}` : (rec.warnings?.length ? 'Closed with warnings' : 'Closed')],
          ['Run by', `${rec.runByName} on ${U.fmtDateTime(rec.runAt)}`], ['Version', String(rec.version)]]),
        ['Positions as at', U.fmtDateTime(rec.runAt || s.to) + (rec.catchUp ? ' (catch-up day: positions as at the run)' : '')],
        ...(rec.restartNumbering ? [['Numbering', `References restart at 00001 from 1 January ${rec.restartNumbering}`]] : []),
        ...(rec.warnings || []).map((w, i) => [i ? '' : 'Warnings', w]),
      ] },
      { heading: 'Activity in the period', columns: [{ label: 'Action' }, { label: 'Count', num: 0 }], rows: act.filter(([k]) => s.activity[k]).map(([k, l]) => [l, s.activity[k]]) },
      { heading: 'Money by currency', columns: [{ label: 'Currency' }, { label: 'Allocated', num: 2 }, { label: 'Allocated MWK', num: 2 }, { label: 'Forfeited', num: 2 }, { label: 'Paid', num: 2 }, { label: 'Paid MWK', num: 2 }, { label: 'Paid ≈ USD', num: 2 }],
        rows: Object.entries(s.money).sort().map(([c, r]) => [c, r.allocated, r.allocMWK, r.forfeited, r.paid, r.paidMWK, r.paidUSD]) },
      { heading: 'Transactions finished', columns: [{ label: 'Outcome' }, { label: 'Count', num: 0 }],
        rows: Object.entries(Reports.OUTCOMES).map(([k, o]) => [o.label, s.finished[k] || 0]) },
      { heading: 'Positions at close – applications by status', columns: [{ label: 'Status' }, { label: 'Count', num: 0 }],
        rows: Object.entries(s.positions.byStatus).map(([k, v]) => [STATUS[k]?.label || k, v]) },
      { heading: 'Outstanding by currency', columns: [{ label: 'Currency' }, { label: 'Awaiting funding', num: 2 }, { label: 'Funded, not paid', num: 2 }, { label: 'Not yet allocated', num: 2 }],
        rows: ccys.filter(c => s.positions.awaitingFunding[c] || s.positions.fundedUnpaid[c] || s.positions.unallocated[c]).map(c => [c, s.positions.awaitingFunding[c] || 0, s.positions.fundedUnpaid[c] || 0, s.positions.unallocated[c] || 0]) },
      { heading: 'Exceptions at close', columns: [{ label: 'Item' }, { label: 'Count', num: 0 }], rows: [
        ['Waiting for authorisation', s.exceptions.pendingAuth], ['Drafts', s.exceptions.drafts], ['Advance payments not reconciled', s.exceptions.unreconciled],
        ['… of which overdue', s.exceptions.overdue], [`Open over ${Store.state.settings.agingDays} days`, s.exceptions.aged]] },
      { heading: 'By branch', columns: [{ label: 'Branch' }, { label: 'Submitted', num: 0 }, { label: 'Authorised', num: 0 }, { label: 'Payments', num: 0 }, { label: 'Paid ≈ USD', num: 2 }, { label: 'Finished', num: 0 }, { label: 'Open at close', num: 0 }],
        rows: Object.entries(s.branches).sort((x, y) => name(x[0]).localeCompare(name(y[0]))).map(([id, r]) => [name(id), r.submitted, r.authorised, r.payments, r.paidUSD, r.finished, r.open]) },
      { heading: 'Messages generated', columns: [{ label: 'Audience' }, { label: 'Count', num: 0 }], rows: Object.entries(s.messages) },
    ];
    if (rec.backup) sections.push({ heading: 'Backup', columns: [{ label: 'Destination' }, { label: 'Result' }, { label: 'Detail' }],
      rows: rec.backup.results?.length ? rec.backup.results.map(r => [r.target, r.ok ? 'OK' : 'FAILED', r.message || r.file || '']) : [['Backup', rec.backup.ok ? 'OK' : 'FAILED', rec.backup.error || rec.backup.file || '']] });
    if (rec.kind === 'EOY') sections.push({ heading: 'Open items carried into the new year', columns: [{ label: 'Reference' }, { label: 'Customer' }, { label: 'Branch' }, { label: 'Status' }, { label: 'Currency' }, { label: 'Amount', num: 2 }],
      rows: s.openItems.map(o => [o.ref, o.customer, name(o.branch), STATUS[o.status]?.label || o.status, o.currency, o.amount]) });
    return { title: `${PERIOD_KINDS[rec.kind]} report – ${this.label(rec)}`, subtitle: interim ? 'Interim report – period not closed' : `Closed ${U.fmtDateTime(rec.runAt)} by ${rec.runByName}`,
      filename: `${rec.kind}_${rec.key}${rec.version > 1 ? `_v${rec.version}` : ''}${interim ? '_interim' : ''}`, sections };
  },

  modelHtml(model) {
    const cell = (v, c) => (c.num != null && typeof v === 'number' ? U.num(v, c.num) : U.esc(v ?? ''));
    return model.sections.map(s => `<h3 style="margin:16px 0 6px">${U.esc(s.heading)}</h3><div class="table-wrap"><table><thead><tr>${s.columns.map(c => `<th class="${c.num != null ? 'num' : ''}">${U.esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${s.rows.map(r => `<tr>${r.map((v, i) => `<td class="${s.columns[i]?.num != null ? 'num' : ''}">${cell(v, s.columns[i] || {})}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${s.columns.length}" class="empty">None.</td></tr>`}</tbody></table></div>`).join('');
  },

  showReport(rec, interim = false) {
    const model = this.model(rec, interim);
    const m = UI.modal({ title: model.title, wide: true, closeLabel: 'Close', body: `<div class="toolbar"><span class="muted">${U.esc(model.subtitle)}</span><span class="grow"></span>${Export.button()}</div><div class="period-report">${this.modelHtml(model)}</div>` });
    Export.attach(m.el, () => model);
  },

  /* ---------- screen: #/eod/<tab> ---------- */
  tabs() {
    const t = [];
    if (this.can()) t.push(['run', 'Run']);
    if (this.canView()) t.push(['history', 'History']);
    if (this.can()) t.push(['backup', 'Backups']);
    if (Store.user().role === 'ADMIN') t.push(['settings', 'Settings']);
    return t;
  },

  render(tab) {
    const tabs = this.tabs();
    if (!tabs.length) { location.hash = '#/dashboard'; return; }
    if (!tabs.some(t => t[0] === tab)) tab = tabs[0][0];
    UI.setTitle(tabs.find(t => t[0] === tab)[1], 'End of day / month / year');
    document.getElementById('view').innerHTML = `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/eod/${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="eod"></div>`;
    this[`tab_${tab}`]();
  },

  statusCards() {
    const t = this.today(), eod = this.closed('EOD', t), lastE = this.latest('EOD'), lastM = this.latest('EOM'), lastY = this.latest('EOY');
    const missed = this.missedDays(t).length, lb = Backups.last();
    return `<div class="kpis">
      <div class="kpi ${eod ? 'green' : 'amber'}"><div class="v">${eod ? 'Closed' : 'Open'}</div><div class="l">Today (${U.fmtDate(t)})</div></div>
      <div class="kpi ${missed ? 'red' : ''}"><div class="v">${missed}</div><div class="l">Missed business days</div></div>
      <div class="kpi"><div class="v" style="font-size:18px">${lastE ? U.fmtDate(lastE.key) : '–'}</div><div class="l">Last end of day</div></div>
      <div class="kpi"><div class="v" style="font-size:18px">${lastM ? this.monthName(lastM.key) : '–'}</div><div class="l">Last end of month${lastY ? ` · last year end ${lastY.key}` : ''}</div></div>
      <div class="kpi ${lb && !lb.ok ? 'red' : lb ? 'green' : ''}"><div class="v" style="font-size:18px">${lb ? U.fmtDateTime(lb.at) : 'None yet'}</div><div class="l">Last backup${lb ? (lb.ok ? ' – OK' : ' – problem') : ''}</div></div>
    </div>`;
  },

  tab_run() {
    const st = this.runState = this.runState || { kind: 'EOD', date: this.today(), month: this.today().slice(0, 7), year: this.today().slice(0, 4) };
    const key = () => (st.kind === 'EOD' ? st.date : st.kind === 'EOM' ? st.month : st.year);
    const draw = () => {
      const chk = this.check(st.kind, key());
      const needPass = !Backups.isServer() && Backups.dests().some(d => d.encrypt && d.enabled !== false) && this.cfg().backupOn.includes(st.kind);
      U.$('#eod').innerHTML = this.statusCards() + `
        <div class="card"><div class="card-h"><h2>Close a period</h2></div><div class="card-b">
          <div class="pill-group" style="margin-bottom:12px">${Object.entries(PERIOD_KINDS).map(([k, l]) => `<button data-kind="${k}" class="${st.kind === k ? 'on' : ''}">${l}</button>`).join('')}</div>
          <div class="grid g3">
            ${st.kind === 'EOD' ? `<label class="f"><span>Business date</span><input type="date" id="eod-date" value="${st.date}" max="${this.today()}"></label>` : ''}
            ${st.kind === 'EOM' ? `<label class="f"><span>Month</span><input type="month" id="eod-month" value="${st.month}"></label>` : ''}
            ${st.kind === 'EOY' ? `<label class="f"><span>Year</span><input type="number" id="eod-year" value="${st.year}" min="2020" max="2099"></label>` : ''}
          </div>
          ${chk.blockers.length ? `<div class="alert error" style="margin-top:12px"><div><b>Cannot close yet:</b><ul>${chk.blockers.map(b => `<li>${U.esc(b)}</li>`).join('')}</ul></div></div>` : ''}
          ${chk.warnings.length ? `<div class="alert warn" style="margin-top:12px"><div><b>Check before closing:</b><ul>${chk.warnings.map(b => `<li>${U.esc(b)}</li>`).join('')}</ul></div></div>` : ''}
          ${chk.info.length ? `<div class="alert info" style="margin-top:12px"><div><ul style="margin:0">${chk.info.map(b => `<li>${U.esc(b)}</li>`).join('')}</ul></div></div>` : ''}
          ${chk.plan.length && !chk.blockers.length ? `<p style="margin:12px 0 6px"><b>Will close, in order:</b> ${chk.plan.map(p => `${p.kind} ${p.kind === 'EOD' ? U.fmtDate(p.key) : p.key}`).join(' → ')}</p>` : ''}
          ${st.kind === 'EOY' && !chk.blockers.length ? `<label class="btn-row" style="margin-top:8px"><input type="checkbox" id="eod-renum"> Restart application references at 00001 from 1 January ${Number(st.year) + 1}</label>` : ''}
          ${chk.warnings.length && !chk.blockers.length ? `<label class="btn-row" style="margin-top:8px"><input type="checkbox" id="eod-ack"> I have reviewed the warnings</label>` : ''}
          ${needPass && !chk.blockers.length ? `<label class="f" style="margin-top:8px;max-width:360px"><span>Backup passphrase (for encrypted destinations)</span><input type="password" id="eod-pass" autocomplete="new-password"></label>` : ''}
          <div class="btn-row" style="margin-top:14px">
            <button class="btn-primary" id="eod-run" ${chk.blockers.length ? 'disabled' : ''}>Run ${PERIOD_KINDS[st.kind].toLowerCase()}</button>
            ${st.kind !== 'EOD' ? `<button id="eod-interim">Interim ${st.kind === 'EOM' ? 'month' : 'year'}-to-date report</button>` : `<button id="eod-interim">Preview today's figures</button>`}
          </div>
          <div id="eod-progress" class="muted" style="margin-top:10px"></div>
        </div></div>`;
      U.$$('#eod [data-kind]').forEach(b => b.addEventListener('click', () => { st.kind = b.dataset.kind; draw(); }));
      U.$('#eod-date')?.addEventListener('change', e => { st.date = e.target.value; draw(); });
      U.$('#eod-month')?.addEventListener('change', e => { st.month = e.target.value; draw(); });
      U.$('#eod-year')?.addEventListener('change', e => { st.year = e.target.value; draw(); });
      U.$('#eod-interim').addEventListener('click', () => {
        const k = key(), item = { kind: st.kind, key: k };
        const win = this.windowFor(item, Store.now().toISOString(), st.kind === 'EOD' ? this.latest('EOD')?.to : null);
        this.showReport({ kind: st.kind, key: k, runAt: Store.now().toISOString(), snapshot: this.snapshot(win.from, win.to), version: 1 }, true);
      });
      U.$('#eod-run').addEventListener('click', async () => {
        const prep = Backups.isServer() ? null : await Backups.prepareFolders();   // folder permission needs this click
        const out = U.$('#eod-progress'), btn = U.$('#eod-run');
        btn.disabled = true;
        try {
          const recs = await this.run(st.kind, key(), { acknowledged: !!U.$('#eod-ack')?.checked, restartNumbering: !!U.$('#eod-renum')?.checked, passphrase: U.$('#eod-pass')?.value, prepared: prep }, msg => { out.textContent = msg; });
          const last = recs[recs.length - 1];
          UI.toast(`${PERIOD_KINDS[last.kind]} ${this.label(last)} closed${last.warnings.length ? ' with warnings' : ''}.`, last.warnings.length ? 'info' : 'ok');
          App.renderChrome();
          this.render('run');
          this.showReport(last);
        } catch (e) { UI.error(e); btn.disabled = false; out.textContent = ''; }
      });
    };
    draw();
  },

  tab_history() {
    const f = this.histFilter = this.histFilter || { kind: '' };
    const draw = () => {
      const rows = this.list().filter(p => !f.kind || p.kind === f.kind).sort((a, b) => b.runAt.localeCompare(a.runAt));
      U.$('#eod').innerHTML = this.statusCards() + `
        <div class="toolbar"><div class="pill-group"><button data-hk="" class="${!f.kind ? 'on' : ''}">All</button>${Object.entries(PERIOD_KINDS).map(([k, l]) => `<button data-hk="${k}" class="${f.kind === k ? 'on' : ''}">${l}</button>`).join('')}</div><span class="grow"></span><span class="muted">${rows.length} record(s)</span></div>
        <div class="card"><div class="card-b tight"><div class="table-wrap"><table>
          <thead><tr><th>Period</th><th>Type</th><th>Status</th><th>Run</th><th>Backup</th><th></th></tr></thead>
          <tbody>${rows.map(p => `<tr><td><b>${U.esc(this.label(p))}</b>${p.version > 1 ? ` <small>v${p.version}</small>` : ''}${p.catchUp ? ' <small class="muted">catch-up</small>' : ''}</td><td>${PERIOD_KINDS[p.kind]}</td>
            <td>${p.status === 'REOPENED' ? UI.tag('Reopened', 'grey') : p.warnings?.length ? UI.tag('Closed with warnings', 'amber') : UI.tag('Closed', 'green')}</td>
            <td>${U.fmtDateTime(p.runAt)}<br><small>${U.esc(p.runByName)}</small></td>
            <td>${p.backup ? (p.backup.ok ? UI.tag('OK', 'green') : UI.tag('Problem', 'red')) : '<span class="muted">–</span>'}</td>
            <td class="nowrap"><button class="btn-sm" data-rep="${p.id}">Report</button>${this.can() && p.status !== 'REOPENED' ? ` <button class="btn-sm" data-reopen="${p.id}">Reopen…</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No periods closed yet.</td></tr>'}</tbody>
        </table></div></div></div>`;
      U.$$('#eod [data-hk]').forEach(b => b.addEventListener('click', () => { f.kind = b.dataset.hk; draw(); }));
      U.$$('#eod [data-rep]').forEach(b => b.addEventListener('click', () => this.showReport(this.list().find(p => p.id === b.dataset.rep))));
      U.$$('#eod [data-reopen]').forEach(b => b.addEventListener('click', async () => {
        try { if (await this.reopen(this.list().find(p => p.id === b.dataset.reopen))) { UI.toast('Period reopened.', 'ok'); App.renderChrome(); draw(); } } catch (e) { UI.error(e); }
      }));
    };
    draw();
  },

  tab_backup() { Backups.render(U.$('#eod')); },

  tab_settings() {
    const c = this.cfg();
    U.$('#eod').innerHTML = `<div class="card"><div class="card-h"><h2>End-of-period settings</h2></div><div class="card-b">
      <label class="btn-row"><input type="checkbox" id="es-weekends" ${c.closeWeekends ? 'checked' : ''}> Weekends are business days (close them too)</label>
      <label class="f" style="margin-top:10px"><span>Public holidays – one per line as YYYY-MM-DD, optionally followed by a name</span><textarea id="es-hol" rows="6" placeholder="2026-12-25 Christmas Day">${U.esc(c.holidays.join('\n'))}</textarea>
        <div class="hint">Holidays are not business days: they are not expected to be closed and are skipped when finding the last business day of a month or year.</div></label>
      <label class="f" style="margin-top:10px;max-width:520px"><span>Work after end of day</span><select id="es-after">
        <option value="allow" ${c.afterEod === 'allow' ? 'selected' : ''}>Allow – it counts towards the next day's figures</option>
        <option value="block" ${c.afterEod === 'block' ? 'selected' : ''}>Block workflow actions until the next business day (reopen the day to work)</option></select></label>
      <label class="btn-row" style="margin-top:10px"><input type="checkbox" id="es-remind" ${c.remind ? 'checked' : ''}> Show a reminder in the menu when business days were not closed</label>
      <div style="margin-top:10px"><b>Back up automatically after:</b> ${Object.entries(PERIOD_KINDS).map(([k, l]) => `<label class="btn-row" style="display:inline-flex;margin-right:12px"><input type="checkbox" data-bon="${k}" ${c.backupOn.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      <div class="btn-row" style="margin-top:14px"><button class="btn-primary" id="es-save">Save settings</button></div></div></div>`;
    U.$('#es-save').addEventListener('click', () => {
      const hol = U.$('#es-hol').value.split(/\n+/).map(x => x.trim()).filter(Boolean);
      const bad = hol.filter(h => !/^\d{4}-\d\d-\d\d\b/.test(h));
      if (bad.length) { UI.toast(`Use YYYY-MM-DD for: ${bad.join(', ')}`, 'error'); return; }
      Store.state.settings = Object.assign({}, Store.state.settings, { eod: { closeWeekends: U.$('#es-weekends').checked, holidays: hol.sort(), afterEod: U.$('#es-after').value, remind: U.$('#es-remind').checked, backupOn: U.$$('[data-bon]').filter(x => x.checked).map(x => x.dataset.bon) } });
      Store.audit('SETTINGS_UPDATED', null, 'End-of-period settings updated');
      Store.save();
      UI.toast('Settings saved.', 'ok');
      App.renderChrome();
    });
  },
};

/* =====================================================================================================
   Backups
   ===================================================================================================== */
const Backups = {
  isServer() { return typeof Live !== 'undefined'; },
  log() { Store.state.backupLog = Store.state.backupLog || []; return Store.state.backupLog; },
  last() { return this.isServer() ? this.serverLast : this.log()[0]; },
  serverLast: null,

  summary(kind) {
    if (!Periods.cfg().backupOn.includes(kind)) return 'off for this kind of close';
    if (this.isServer()) return 'the server backs up and copies to its destinations';
    const d = this.dests().filter(x => x.enabled !== false && (x.on || ['EOD', 'EOM', 'EOY']).includes(kind));
    return d.length ? d.map(x => x.name).join(', ') : 'no destinations set up (Backups tab)';
  },

  /* ---------- prototype: browser backups ---------- */
  dests() {
    const s = Store.state.settings.backup || {};
    return s.destinations || [{ id: 'download', type: 'download', name: 'Download to this PC', enabled: true, on: ['EOD', 'EOM', 'EOY', 'MANUAL'], encrypt: false }];
  },
  saveDests(list) { Store.state.settings = Object.assign({}, Store.state.settings, { backup: { destinations: list } }); Store.save(); },

  handles: null,
  db() {
    return new Promise((res, rej) => { const r = indexedDB.open('cbm-forex-backup', 1); r.onupgradeneeded = () => r.result.createObjectStore('handles'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  },
  async handle(id, value) {
    const db = await this.db();
    return new Promise((res, rej) => {
      const tx = db.transaction('handles', value === undefined ? 'readonly' : 'readwrite');
      const st = tx.objectStore('handles');
      const r = value === undefined ? st.get(id) : value === null ? st.delete(id) : st.put(value, id);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  },
  folderSupported() { return typeof window.showDirectoryPicker === 'function'; },

  /* Ask the browser for folder permission while we still have the user's click. */
  async prepareFolders() {
    const out = {};
    for (const d of this.dests().filter(x => x.type === 'folder' && x.enabled !== false)) {
      try {
        const h = await this.handle(d.id);
        if (!h) { out[d.id] = 'Folder not connected'; continue; }
        let p = await h.queryPermission({ mode: 'readwrite' });
        if (p !== 'granted') p = await h.requestPermission({ mode: 'readwrite' });
        out[d.id] = p === 'granted' ? h : 'Permission to write to the folder was not given';
      } catch (e) { out[d.id] = e.message; }
    }
    return out;
  },

  async b64(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(blob); }); },

  async buildBlob(reason, kind) {
    const S = Store.state, files = [];
    const ids = new Set(S.apps.flatMap(a => (a.documents || []).filter(d => !d.sample).map(d => d.id)));
    for (const id of ids) {
      const blob = await FileStore.get(id);
      if (blob) files.push({ id, name: blob.name || id, mime: blob.type, data: await this.b64(blob) });
    }
    const body = JSON.stringify({ format: 'forex-backup', version: 1, environment: 'prototype', createdAt: Store.now().toISOString(), reason, kind, state: S, files });
    return new Blob([body], { type: 'application/json' });
  },

  async key(pass, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 200000 }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },
  async encrypt(blob, pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this.key(pass, salt), await blob.arrayBuffer());
    const hex = a => [...a].map(x => x.toString(16).padStart(2, '0')).join('');
    return new Blob([JSON.stringify({ format: 'forex-backup-encrypted', version: 1, kdf: 'PBKDF2-SHA256-200000', cipher: 'AES-256-GCM', salt: hex(salt), iv: hex(iv), data: await this.b64(new Blob([data])) })], { type: 'application/json' });
  },
  async decrypt(obj, pass) {
    const un = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
    const bin = Uint8Array.from(atob(obj.data), c => c.charCodeAt(0));
    try { return new Blob([await crypto.subtle.decrypt({ name: 'AES-GCM', iv: un(obj.iv) }, await this.key(pass, un(obj.salt)), bin)]); } catch (e) { throw new WorkflowError('Wrong passphrase, or the backup file is damaged.'); }
  },

  async browserRun(reason, kind, passphrase, prepared) {
    const dests = this.dests().filter(d => d.enabled !== false && (kind === 'MANUAL' || (d.on || []).includes(kind)));
    if (!dests.length) throw new WorkflowError('No backup destinations are set up for this. Add one under End of day → Backups.');
    if (dests.some(d => d.encrypt) && !passphrase) throw new WorkflowError('Enter the backup passphrase for the encrypted destinations.');
    prepared = prepared || await this.prepareFolders();
    const stamp = Store.now().toISOString().slice(0, 19).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');
    const plain = await this.buildBlob(reason, kind);
    let enc = null;
    const results = [];
    for (const d of dests) {
      const t0 = Date.now();
      try {
        const blob = d.encrypt ? (enc = enc || await this.encrypt(plain, passphrase)) : plain;
        const name = `forex-backup-${kind.toLowerCase()}-${stamp}${d.encrypt ? '.enc' : ''}.json`;
        if (d.type === 'download') { DocView.save(blob, name); results.push({ target: d.name, ok: true, file: name, message: `Downloaded ${U.fileSize(blob.size)}` }); continue; }
        const h = prepared[d.id];
        if (!h || typeof h === 'string') throw new Error(h || 'Folder not connected');
        const fh = await h.getFileHandle(name, { create: true });
        const w = await fh.createWritable(); await w.write(blob); await w.close();
        const check = await (await h.getFileHandle(name)).getFile();
        if (check.size !== blob.size) throw new Error('The written file does not match (size differs).');
        let removed = 0;
        if (d.keep > 0) {
          const names = [];
          for await (const [n, e] of h.entries()) if (e.kind === 'file' && /^forex-backup-.*\.json$/.test(n)) names.push(n);
          for (const n of names.sort().reverse().slice(d.keep)) { await h.removeEntry(n); removed++; }
        }
        results.push({ target: d.name, ok: true, file: name, message: `${U.fileSize(blob.size)} written and checked${removed ? `; ${removed} old backup(s) removed` : ''}`, ms: Date.now() - t0 });
      } catch (e) { results.push({ target: d.name, ok: false, message: e.message }); }
    }
    const ok = results.every(r => r.ok);
    const entry = { at: Store.now().toISOString(), reason, kind, ok, size: plain.size, results, by: Store.user().name };
    this.log().unshift(entry); this.log().splice(100);
    Store.audit(ok ? 'BACKUP_RUN' : 'BACKUP_FAILED', null, `${reason}: ${results.map(r => `${r.target} ${r.ok ? 'OK' : `FAILED (${r.message})`}`).join('; ')}`);
    Store.save();
    return { ok, results, error: ok ? null : 'one or more destinations failed' };
  },

  async run(reason, kind, passphrase, prepared) {
    if (!this.isServer()) return this.browserRun(reason, kind, passphrase, prepared);
    const r = await Live.api('POST', kind === 'MANUAL' ? '/api/admin/backup' : '/api/backup/run', { reason, kind });
    this.serverLast = { at: new Date().toISOString(), ok: r.ok };
    return r;
  },

  /* ---------- Backups tab ---------- */
  render(root) { return this.isServer() ? this.renderServer(root) : this.renderBrowser(root); },

  renderBrowser(root) {
    const dests = this.dests(), admin = Store.user().role === 'ADMIN';
    const kinds = ['EOD', 'EOM', 'EOY', 'MANUAL'];
    root.innerHTML = `
      <div class="alert info" style="margin-bottom:12px"><div>A backup is one file with all data and uploaded documents. Save it to as many places as you like:
        <ul><li><b>Download</b> – the browser asks where to save (another drive, USB stick, network folder);</li>
        <li><b>Folder</b> – written automatically to a folder you choose once: another drive, an external or USB drive (offline), a mapped network share, or a OneDrive / Google Drive / Dropbox folder (online, synced by that app).</li></ul>
        ${this.folderSupported() ? '' : '<b>This browser cannot write to folders directly; use Chrome or Edge for folder destinations, or Download.</b>'}</div></div>
      <div class="card" style="margin-bottom:16px"><div class="card-h"><h2>Destinations</h2>${this.folderSupported() ? '<button class="btn-sm" id="bk-add">+ Add folder…</button>' : ''}</div><div class="card-b tight"><div class="table-wrap"><table>
        <thead><tr><th>Destination</th><th>Encrypt</th><th>Keep</th>${kinds.map(k => `<th class="c">${k === 'MANUAL' ? 'Manual' : k}</th>`).join('')}<th>On</th><th></th></tr></thead>
        <tbody>${dests.map((d, i) => `<tr><td><b>${U.esc(d.name)}</b><br><small class="muted">${d.type === 'download' ? 'Browser download' : `Folder: ${U.esc(d.folder || '?')}`}</small></td>
          <td><input type="checkbox" data-i="${i}" data-f="encrypt" ${d.encrypt ? 'checked' : ''}></td>
          <td>${d.type === 'folder' ? `<input type="number" min="0" style="width:70px" data-i="${i}" data-f="keep" value="${d.keep || 0}" title="0 = keep all">` : '–'}</td>
          ${kinds.map(k => `<td class="c"><input type="checkbox" data-i="${i}" data-on="${k}" ${(d.on || []).includes(k) ? 'checked' : ''}></td>`).join('')}
          <td><input type="checkbox" data-i="${i}" data-f="enabled" ${d.enabled !== false ? 'checked' : ''}></td>
          <td class="nowrap">${d.type === 'folder' ? `<button class="btn-sm" data-reconnect="${i}">Reconnect</button> <button class="btn-sm btn-danger" data-del="${i}">✕</button>` : ''}</td></tr>`).join('')}</tbody>
      </table></div></div></div>
      <div class="card" style="margin-bottom:16px"><div class="card-h"><h2>Back up now</h2></div><div class="card-b">
        <label class="f" style="max-width:360px"><span>Passphrase (needed if a destination is encrypted – keep it safe, it cannot be recovered)</span><input type="password" id="bk-pass" autocomplete="new-password"></label>
        <div class="btn-row" style="margin-top:10px"><button class="btn-primary" id="bk-now">Back up now</button></div><div id="bk-out" class="muted" style="margin-top:8px"></div></div></div>
      ${admin ? `<div class="card" style="margin-bottom:16px"><div class="card-h"><h2>Restore</h2></div><div class="card-b">
        <p style="margin-top:0">Replaces <b>all</b> data in this browser with a backup file (encrypted files ask for the passphrase). Take a backup first.</p>
        <label class="btn upload-btn">⇪ Choose backup file…<input type="file" id="bk-restore" accept=".json,application/json"></label></div></div>` : ''}
      <div class="card"><div class="card-h"><h2>Backup log</h2></div><div class="card-b tight"><div class="table-wrap"><table><thead><tr><th>When</th><th>Reason</th><th>Result</th><th>Details</th></tr></thead><tbody>
        ${this.log().slice(0, 30).map(e => `<tr><td class="nowrap">${U.fmtDateTime(e.at)}</td><td>${U.esc(e.reason)}<br><small>${U.esc(e.by || '')}</small></td><td>${e.ok ? UI.tag('OK', 'green') : UI.tag('Problem', 'red')}</td><td>${e.results.map(r => `<div>${r.ok ? '✓' : '✕'} ${U.esc(r.target)}: ${U.esc(r.message || '')}</div>`).join('')}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No backups yet.</td></tr>'}
      </tbody></table></div></div></div>`;
    const list = () => this.dests().map(x => Object.assign({}, x));
    root.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener('change', () => {
      const l = list(), d = l[inp.dataset.i];
      d[inp.dataset.f] = inp.type === 'checkbox' ? inp.checked : Math.max(0, Number(inp.value) || 0);
      this.saveDests(l);
    }));
    root.querySelectorAll('[data-on]').forEach(inp => inp.addEventListener('change', () => {
      const l = list(), d = l[inp.dataset.i];
      d.on = kinds.filter(k => (k === inp.dataset.on ? inp.checked : (d.on || []).includes(k)));
      this.saveDests(l);
    }));
    root.querySelector('#bk-add')?.addEventListener('click', async () => {
      try {
        const h = await window.showDirectoryPicker({ mode: 'readwrite' });
        const name = prompt('Name this destination (e.g. "USB drive E:", "OneDrive folder", "Server share")', h.name) || h.name;
        const id = U.uid('bkd');
        await this.handle(id, h);
        this.saveDests([...list(), { id, type: 'folder', name, folder: h.name, enabled: true, encrypt: false, keep: 30, on: ['EOD', 'EOM', 'EOY', 'MANUAL'] }]);
        Store.audit('SETTINGS_UPDATED', null, `Backup destination added: ${name}`); Store.save();
        this.renderBrowser(root);
      } catch (e) { if (e.name !== 'AbortError') UI.error(e); }
    });
    root.querySelectorAll('[data-reconnect]').forEach(b => b.addEventListener('click', async () => {
      const d = list()[b.dataset.reconnect];
      try {
        const h = await window.showDirectoryPicker({ mode: 'readwrite' });
        await this.handle(d.id, h);
        const l = list(); l[b.dataset.reconnect].folder = h.name; this.saveDests(l);
        UI.toast('Folder connected.', 'ok'); this.renderBrowser(root);
      } catch (e) { if (e.name !== 'AbortError') UI.error(e); }
    }));
    root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      const l = list(), d = l[b.dataset.del];
      if (!await UI.confirm('Remove destination?', `<p>${U.esc(d.name)} will no longer receive backups. Files already there are kept.</p>`, 'Remove', 'btn-danger')) return;
      await this.handle(d.id, null);
      l.splice(b.dataset.del, 1); this.saveDests(l); this.renderBrowser(root);
    }));
    root.querySelector('#bk-now').addEventListener('click', async () => {
      const prep = await this.prepareFolders();
      const out = root.querySelector('#bk-out'); out.textContent = 'Backing up…';
      try {
        const r = await this.browserRun('Manual backup', 'MANUAL', root.querySelector('#bk-pass').value, prep);
        UI.toast(r.ok ? 'Backup complete.' : 'Backup finished with problems – see the log.', r.ok ? 'ok' : 'error');
      } catch (e) { UI.error(e); }
      this.renderBrowser(root);
    });
    root.querySelector('#bk-restore')?.addEventListener('change', async e => {
      const f = e.target.files[0];
      if (f) try { await this.restore(f); } catch (err) { UI.error(err); }
      e.target.value = '';
    });
  },

  async restore(file) {
    let obj;
    try { obj = JSON.parse(await file.text()); } catch (e) { throw new WorkflowError('This is not a Forex Applications backup file.'); }
    if (obj.format === 'forex-backup-encrypted') {
      let pass = '';
      const ok = await new Promise(res => UI.modal({ title: 'Encrypted backup', body: '<label class="f"><span>Passphrase</span><input type="password" name="p" autocomplete="off"></label>', actions: [{ label: 'Decrypt', onClick: el => { pass = UI.formData(el).p; res(true); } }], onOpen: el => el.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => res(false))) }));
      if (!ok) return;
      obj = JSON.parse(await (await this.decrypt(obj, pass)).text());
    }
    if (obj.format !== 'forex-backup' || !obj.state?.apps) throw new WorkflowError('This file is not a Forex Applications prototype backup.');
    if (!await UI.confirm('Restore this backup?', `<p>Backup taken <b>${U.fmtDateTime(obj.createdAt)}</b> (${U.esc(obj.reason || '')}) with ${obj.state.apps.length} applications and ${obj.files.length} document file(s).</p><div class="alert error"><div>All data currently in this browser will be replaced.</div></div>`, 'Restore', 'btn-danger')) return;
    // Every document in the backup gets the upload security check first, so a bad file stops the restore before
    // anything is replaced (filescan.js).
    const restored = obj.files.map(f => ({ id: f.id, file: new File([Uint8Array.from(atob(f.data), c => c.charCodeAt(0))], f.name, { type: f.mime || 'application/octet-stream' }) }));
    for (const r of restored) {
      const why = await FileScan.problem(r.file).catch(() => 'it could not be checked');
      if (why) FileScan.refuse(`Backup document ${r.file.name}`, `${why} - nothing was restored`);
    }
    await FileStore.clear();
    for (const r of restored) await FileStore.put(r.id, r.file);
    const me = Store.user();
    Store.state = obj.state;
    Store.state.currentUserId = me && Store.userById(me.id) ? me.id : null;
    Store.audit('DATA_RESTORED', null, `Data restored from a backup taken ${U.fmtDateTime(obj.createdAt)}`);
    Store.save();
    UI.toast('Backup restored. Reloading…', 'ok');
    setTimeout(() => location.reload(), 800);
  },

  /* ---------- server versions ---------- */
  /* AES-256-GCM with a PBKDF2-SHA256 key (200,000 rounds): MAGIC "FXBK1\n", salt, iv, data and tag – the format of the
     servers' encrypted copies, so tools\backup_tool.py decrypt / Backup decrypt / tools\backup_export.py open it. */
  async encryptFile(buf, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buf);
    return new Blob([new TextEncoder().encode('FXBK1\n'), salt, iv, new Uint8Array(data)], { type: 'application/octet-stream' });
  },

  async renderServer(root) {
    root.innerHTML = '<div class="card"><div class="card-b muted">Loading…</div></div>';
    const admin = Store.user().role === 'ADMIN';
    let cfg = null, log;
    try {
      log = await Live.api('POST', '/api/backup/log', {});
      if (admin) cfg = await Live.api('POST', '/api/admin/backup-config', {});
    } catch (e) { UI.error(e); return; }
    this.serverLast = log.entries[0] || null;
    const kinds = ['EOD', 'EOM', 'EOY', 'DAILY', 'MANUAL'];
    const T = { folder: 'Folder (this machine, another drive, USB / external drive, mapped or UNC network share \\\\server\\share)', webdav: 'Online – HTTPS / WebDAV upload (e.g. Nextcloud, SharePoint, a backup service URL)' };
    root.innerHTML = `
      <div class="alert info" style="margin-bottom:12px"><div>The server backs up the whole database (including uploaded documents) to <span class="mono">data\\backups</span> and copies it to every destination below.
        Copies are checked after writing. Destinations that fail are reported without stopping the others.</div></div>
      ${admin ? `<div class="card" style="margin-bottom:16px"><div class="card-h"><h2>Destinations</h2><button class="btn-sm" id="sb-add">+ Add destination…</button></div><div class="card-b tight"><div class="table-wrap"><table>
        <thead><tr><th>Destination</th><th>Where</th><th>Encrypt</th><th>Keep</th><th>When</th><th>On</th><th></th></tr></thead>
        <tbody>${cfg.targets.map((t, i) => `<tr><td><b>${U.esc(t.name)}</b><br><small>${t.type === 'webdav' ? 'Online (HTTPS)' : 'Folder'}</small></td><td class="mono" style="word-break:break-all">${U.esc(t.type === 'webdav' ? t.url : t.path)}</td>
          <td>${t.encrypt ? 'Yes' : 'No'}</td><td>${t.type === 'folder' ? (t.keep || 'All') : '–'}</td><td>${(t.on || []).join(', ')}</td><td>${t.enabled !== false ? UI.tag('On', 'green') : UI.tag('Off', 'grey')}</td>
          <td class="nowrap"><button class="btn-sm" data-edit="${i}">Edit</button> <button class="btn-sm" data-test="${i}">Test</button> <button class="btn-sm btn-danger" data-del="${i}">✕</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No destinations yet – backups stay in data\\backups on the server only.</td></tr>'}</tbody>
      </table></div></div></div>
      <div class="card" style="margin-bottom:16px"><div class="card-h"><h2>Schedule and options</h2></div><div class="card-b grid g3">
        <label class="btn-row"><input type="checkbox" id="sb-auto" ${cfg.autoDaily ? 'checked' : ''}> Automatic daily backup (even if nobody is signed in)</label>
        <label class="f"><span>At (server time)</span><input type="time" id="sb-time" value="${U.esc(cfg.autoTime || '18:30')}"></label>
        <label class="f"><span>Keep in data\\backups (0 = all)</span><input type="number" id="sb-keep" min="0" value="${cfg.keepLocal ?? 60}"></label>
        <label class="btn-row"><input type="checkbox" id="sb-json" ${cfg.jsonDump ? 'checked' : ''}> Also write a portable JSON data dump</label>
        <div class="span-all"><b>Encryption passphrase</b> (for destinations marked Encrypt):
          ${cfg.passphraseSource === 'app' ? UI.tag('set on this screen', 'green') : cfg.passphraseSource === 'server.properties' ? UI.tag('set in server.properties', 'green') : UI.tag('not set', 'amber')}
          <button class="btn-sm" id="sb-pass">${cfg.passphraseSource === 'app' ? 'Change passphrase…' : 'Set passphrase…'}</button>
          ${cfg.passphraseSource === 'app' ? '<button class="btn-sm btn-danger" id="sb-pass-clear">Remove</button>' : ''}
          ${cfg.encryptionAvailable === false ? `<div class="alert warn" style="margin-top:6px"><div>Encryption on this server needs the <span class="mono">cryptography</span> package: run <span class="mono">pip install cryptography</span> on the server and restart it.</div></div>` : ''}
          <div class="hint">Keep the passphrase somewhere safe outside this system: without it an encrypted backup cannot be opened.</div></div>
        <div><button class="btn-primary" id="sb-save">Save</button></div></div></div>` : ''}
      <div class="card" style="margin-bottom:16px"><div class="card-h"><h2>Back up now</h2></div><div class="card-b">
        <div class="btn-row"><button class="btn-primary" id="sb-now" ${admin ? '' : 'disabled title="Administrators only"'}>Back up now (all destinations)</button></div><div id="sb-out" class="muted" style="margin-top:8px"></div></div></div>
      <div class="card" style="margin-bottom:16px"><div class="card-h"><h2>Backup log</h2></div><div class="card-b tight"><div class="table-wrap"><table><thead><tr><th>When</th><th>Reason</th><th>Result</th><th>Details</th></tr></thead><tbody>
        ${log.entries.slice(0, 40).map(e => `<tr><td class="nowrap">${U.fmtDateTime(e.at)}</td><td>${U.esc(e.reason)}<br><small>${U.esc(e.by || '')}</small></td><td>${e.ok ? UI.tag('OK', 'green') : UI.tag('Problem', 'red')}</td><td><div class="mono">${U.esc(e.file || '')}</div>${(e.results || []).map(r => `<div>${r.ok ? '✓' : '✕'} ${U.esc(r.target)}: ${U.esc(r.message || '')}</div>`).join('')}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No backups yet.</td></tr>'}
      </tbody></table></div></div></div>
      <div class="card"><div class="card-h"><h2>Backups on the server · restore</h2></div><div class="card-b">
        ${log.engine === 'python' ? `<p style="margin-top:0">To restore: stop the server (root password), then from the server's folder run
        <span class="mono">python tools\\backup_tool.py restore data\\backups\\&lt;backup&gt;.zip</span> and start the server. The current database is kept aside first.
        Encrypted copies (<span class="mono">.enc</span>) are decrypted first with <span class="mono">python tools\\backup_tool.py decrypt &lt;file.enc&gt; &lt;out.zip&gt;</span>.</p>
        <p>To read a backup in Excel: <span class="mono">python tools\\backup_export.py data\\backups\\&lt;backup&gt;.zip</span> (applications, users, audit trail, messages, central bank list and more, one sheet each).</p>`
        : `<p style="margin-top:0">To restore: stop the server (root password), move <span class="mono">data\\forexdb.mv.db</span> aside, run
        <span class="mono">java -cp lib\\h2-2.2.224.jar org.h2.tools.Restore -file data\\backups\\&lt;backup&gt;.zip -dir data</span>, and start the server.
        Encrypted copies (<span class="mono">.enc</span>) are decrypted first with <span class="mono">java -cp build Backup decrypt &lt;file.enc&gt; &lt;out.zip&gt;</span>.</p>
        <p>To read a backup in Excel: tick <b>Also write a portable JSON data dump</b> above, then run <span class="mono">python tools\\backup_export.py data\\backups\\&lt;dump&gt;.json</span> (needs Python on that PC).</p>`}
        <div class="table-wrap"><table><thead><tr><th>File</th><th class="num">Size</th><th>Created</th><th></th></tr></thead><tbody>
        ${log.files.map(f => `<tr><td class="mono">${U.esc(f.name)}</td><td class="num">${U.fileSize(f.size)}</td><td>${U.fmtDateTime(f.at)}</td><td class="nowrap">${admin ? `<button class="btn-sm" data-dl="${U.esc(f.name)}">⇩ Download to this PC</button>${/\.enc$/.test(f.name) ? '' : ` <button class="btn-sm" data-dlenc="${U.esc(f.name)}">🔒 Download encrypted…</button>`}` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">None.</td></tr>'}
        </tbody></table></div></div></div>`;
    if (!admin) return;
    const save = async () => {
      cfg.autoDaily = root.querySelector('#sb-auto').checked; cfg.autoTime = root.querySelector('#sb-time').value || '18:30';
      cfg.keepLocal = Math.max(0, Number(root.querySelector('#sb-keep').value) || 0); cfg.jsonDump = root.querySelector('#sb-json').checked;
      cfg = await Live.api('POST', '/api/admin/backup-config', { config: cfg });
    };
    const edit = (i) => {
      const t = i == null ? { id: U.uid('bkt'), type: 'folder', name: '', path: '', url: '', username: '', encrypt: false, keep: 30, on: ['EOD', 'EOM', 'EOY', 'MANUAL'], enabled: true } : Object.assign({}, cfg.targets[i]);
      UI.modal({
        title: i == null ? 'Add backup destination' : `Edit ${t.name}`, wide: true,
        body: `<div class="grid g2">
          <label class="f span-all"><span>Type</span><select name="type">${Object.entries(T).map(([k, l]) => `<option value="${k}" ${t.type === k ? 'selected' : ''}>${U.esc(l)}</option>`).join('')}</select></label>
          <label class="f"><span>Name</span><input name="name" value="${U.esc(t.name)}" placeholder="e.g. USB drive E:, DR server share, Nextcloud"></label>
          <label class="f" data-for="folder"><span>Folder path on the server</span><input name="path" value="${U.esc(t.path || '')}" placeholder="D:\\ForexBackups  or  \\\\dr-server\\backups\\forex"></label>
          <label class="f span-all" data-for="webdav"><span>Upload folder URL (HTTPS)</span><input name="url" value="${U.esc(t.url || '')}" placeholder="https://cloud.example.com/remote.php/dav/files/forex/backups/"></label>
          <label class="f" data-for="webdav"><span>User name</span><input name="username" value="${U.esc(t.username || '')}" autocomplete="off"></label>
          <label class="f" data-for="webdav"><span>Password or app token ${t.hasPassword ? '(leave blank to keep)' : ''}</span><input type="password" name="password" autocomplete="new-password"></label>
          <label class="f" data-for="folder"><span>Keep the newest (0 = all)</span><input type="number" name="keep" min="0" value="${t.keep ?? 30}"></label>
          <label class="btn-row"><input type="checkbox" name="encrypt" ${t.encrypt ? 'checked' : ''}> Encrypt (AES-256; recommended for online and removable destinations)</label>
          <div class="span-all"><b>Copy after:</b> ${kinds.map(k => `<label class="btn-row" style="display:inline-flex;margin-right:12px"><input type="checkbox" data-on="${k}" ${(t.on || []).includes(k) ? 'checked' : ''}> ${k === 'DAILY' ? 'Automatic daily' : k === 'MANUAL' ? 'Manual' : k}</label>`).join('')}</div>
          <label class="btn-row"><input type="checkbox" name="enabled" ${t.enabled !== false ? 'checked' : ''}> On</label></div>`,
        onOpen: el => {
          const sync = () => { const ty = el.querySelector('[name=type]').value; el.querySelectorAll('[data-for]').forEach(x => { x.hidden = x.dataset.for !== ty; }); };
          el.querySelector('[name=type]').addEventListener('change', sync); sync();
        },
        actions: [{ label: 'Save destination', onClick: async el => {
          const d = UI.formData(el);
          Object.assign(t, { type: d.type, name: d.name.trim(), path: d.path.trim(), url: d.url.trim(), username: d.username.trim(), keep: Math.max(0, Number(d.keep) || 0),
            encrypt: el.querySelector('[name=encrypt]').checked, enabled: el.querySelector('[name=enabled]').checked, on: kinds.filter(k => el.querySelector(`[data-on="${k}"]`).checked) });
          if (d.password) t.password = d.password;
          if (!t.name || (t.type === 'folder' ? !t.path : !/^https:\/\//i.test(t.url))) { UI.toast(t.type === 'folder' ? 'Give a name and a folder path.' : 'Give a name and an https:// URL.', 'error'); return false; }
          if (i == null) cfg.targets.push(t); else cfg.targets[i] = t;
          await save(); UI.toast('Destination saved.', 'ok'); this.renderServer(root);
        } }],
      });
    };
    root.querySelector('#sb-add').addEventListener('click', () => edit(null));
    root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => edit(Number(b.dataset.edit))));
    root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      const t = cfg.targets[b.dataset.del];
      if (!await UI.confirm('Remove destination?', `<p>${U.esc(t.name)} will no longer receive backups. Files already there are kept.</p>`, 'Remove', 'btn-danger')) return;
      cfg.targets.splice(b.dataset.del, 1); await save(); this.renderServer(root);
    }));
    root.querySelectorAll('[data-test]').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true;
      try { const r = await Live.api('POST', '/api/admin/backup-test', { id: cfg.targets[b.dataset.test].id }); UI.toast(`${r.ok ? '✓' : '✕'} ${r.message}`, r.ok ? 'ok' : 'error'); } catch (e) { UI.error(e); }
      b.disabled = false;
    }));
    root.querySelector('#sb-save').addEventListener('click', async () => { try { await save(); UI.toast('Saved.', 'ok'); this.renderServer(root); } catch (e) { UI.error(e); } });
    root.querySelector('#sb-now').addEventListener('click', async () => {
      const out = root.querySelector('#sb-out'); out.textContent = 'Backing up… (large databases and online destinations can take a few minutes)';
      try { const r = await this.run('Manual backup', 'MANUAL'); UI.toast(r.ok ? 'Backup complete.' : 'Backup finished with problems – see the log.', r.ok ? 'ok' : 'error'); } catch (e) { UI.error(e); }
      this.renderServer(root);
    });
    root.querySelectorAll('[data-dl]').forEach(b => b.addEventListener('click', async () => {
      try {
        const r = await fetch(`/api/backup/download?file=${encodeURIComponent(b.dataset.dl)}`, { headers: { 'X-Session': Live.token } });
        if (!r.ok) throw new WorkflowError((await r.json().catch(() => ({}))).error || `Download failed (${r.status}).`);
        DocView.save(await r.blob(), b.dataset.dl);
      } catch (e) { UI.error(e); }
    }));
    // Encrypted with a password typed now (AES-256-GCM, the format of encrypted destinations; decrypt with the backup tool).
    root.querySelectorAll('[data-dlenc]').forEach(b => b.addEventListener('click', () => {
      const name = b.dataset.dlenc;
      UI.modal({ title: `Download ${name} encrypted`,
        body: `<p style="margin-top:0">The file is encrypted with this password before it reaches this PC. Keep the password safe: without it the backup cannot be opened.</p>
          <div class="grid g2"><label class="f"><span>Password (12+ characters)</span><input type="password" name="p1" autocomplete="new-password"></label>
          <label class="f"><span>Repeat</span><input type="password" name="p2" autocomplete="new-password"></label></div>`,
        actions: [{ label: 'Encrypt & download', onClick: async el => {
          const d = UI.formData(el);
          if ((d.p1 || '').length < 12) { UI.toast('Use a password of at least 12 characters.', 'error'); return false; }
          if (d.p1 !== d.p2) { UI.toast('The passwords do not match.', 'error'); return false; }
          try {
            let blob;
            if (cfg.encryptionAvailable !== false) {      // the server encrypts it
              const r = await fetch(`/api/backup/download?file=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'X-Session': Live.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: d.p1 }) });
              if (!r.ok) throw new WorkflowError((await r.json().catch(() => ({}))).error || `Download failed (${r.status}).`);
              blob = await r.blob();
            } else {                                      // this browser encrypts it, in the same format
              if (!window.crypto?.subtle) throw new WorkflowError('This browser cannot encrypt here (it needs an https:// address or the server PC), and the server has no cryptography package (pip install cryptography).');
              const r = await fetch(`/api/backup/download?file=${encodeURIComponent(name)}`, { headers: { 'X-Session': Live.token } });
              if (!r.ok) throw new WorkflowError((await r.json().catch(() => ({}))).error || `Download failed (${r.status}).`);
              blob = await this.encryptFile(await r.arrayBuffer(), d.p1);
            }
            DocView.save(blob, `${name}.enc`);
            UI.toast('Encrypted backup downloaded.', 'ok');
          } catch (e) { UI.error(e); return false; }
        } }] });
    }));
    const setPass = async body => { cfg = await Live.api('POST', '/api/admin/backup-config', body); this.renderServer(root); };
    root.querySelector('#sb-pass')?.addEventListener('click', () => UI.modal({ title: 'Backup encryption passphrase',
      body: `<p style="margin-top:0">Used for every destination marked <b>Encrypt</b>. The server keeps it and never shows it again. Backups already encrypted keep the passphrase they were made with.</p>
        <div class="grid g2"><label class="f"><span>Passphrase (12+ characters)</span><input type="password" name="p1" autocomplete="new-password"></label>
        <label class="f"><span>Repeat</span><input type="password" name="p2" autocomplete="new-password"></label></div>`,
      actions: [{ label: 'Save passphrase', onClick: async el => {
        const d = UI.formData(el);
        if ((d.p1 || '').length < 12) { UI.toast('Use a passphrase of at least 12 characters.', 'error'); return false; }
        if (d.p1 !== d.p2) { UI.toast('The passphrases do not match.', 'error'); return false; }
        try { await setPass({ passphrase: d.p1 }); UI.toast('Passphrase saved.', 'ok'); } catch (e) { UI.error(e); return false; }
      } }] }));
    root.querySelector('#sb-pass-clear')?.addEventListener('click', async () => {
      if (!await UI.confirm('Remove the passphrase?', '<p>Destinations marked Encrypt will fail until a passphrase is set again (here or in server.properties).</p>', 'Remove', 'btn-danger')) return;
      try { await setPass({ clearPassphrase: true }); UI.toast('Passphrase removed.', 'ok'); } catch (e) { UI.error(e); }
    });
  },
};

/* ---------- hooks into the shared screens ---------- */
(() => {
  App.routes.push([/^#\/eod(?:\/(\w+))?$/, tab => Periods.render(tab)]);
  const baseChrome = App.renderChrome.bind(App);
  App.renderChrome = function () {
    baseChrome();
    const u = Store.user();
    if (!u || !Periods.canView(u)) return;
    const missed = Periods.can(u) && Periods.cfg().remind ? Periods.missedDays(Periods.today()).length : 0;
    const active = location.hash.startsWith('#/eod');
    const link = `<div class="nav-group">Operations</div><a href="#/eod" class="${active ? 'active' : ''}"><span>End of day / backups</span>${missed ? `<span class="count" style="background:var(--red)" title="Business days not closed">${missed}</span>` : ''}</a>`;
    const nav = document.getElementById('nav');
    const comm = [...nav.querySelectorAll('.nav-group')].find(g => g.textContent === 'Communication');
    if (comm) comm.insertAdjacentHTML('beforebegin', link); else nav.insertAdjacentHTML('beforeend', link);
  };
  // Work after end of day (setting "Block"): workflow actions are unavailable until the next business day.
  const baseCan = Engine.can.bind(Engine);
  Engine.can = function (action, app, user) { if (action !== 'view' && Periods.blocked()) return false; return baseCan(action, app, user); };
  const baseGuard = Engine.guard.bind(Engine);
  Engine.guard = function (action, app) {
    if (action !== 'view' && Periods.blocked()) throw new WorkflowError(`End of day for ${U.fmtDate(Periods.today())} has been run, so changes are blocked until the next business day. An administrator can reopen the day.`);
    return baseGuard(action, app);
  };
  const baseLabel = Views.actionLabel.bind(Views);
  Views.actionLabel = a => ({ PERIOD_CLOSED: 'Period closed', PERIOD_REOPENED: 'Period reopened', BACKUP_RUN: 'Backup', BACKUP_FAILED: 'Backup failed', DATA_RESTORED: 'Data restored', NUMBERING_RESTART: 'Numbering restart set' })[a] || baseLabel(a);
})();
