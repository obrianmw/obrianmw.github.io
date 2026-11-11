'use strict';

/* Automatic funds check at allocation, and up-to-date balances.

   When Treasury opens the allocation, the client's available balance is refreshed from the core banking system
   (CBS). On allocating, the total to pay – MWK equivalent of the allocation plus the charges (js/charges.js) – is
   compared with that balance, in the account's currency:
     · enough funds → the "awaiting funding" stage is skipped: the allocation is marked funded (by the system), the
       account is debited (the balance on the application goes down), Exchange Control / the assignee (the branch for
       travel) are told it is ready, and the client is told the transaction will be processed shortly;
     · not enough → as before: the client is asked to fund the account by the cut-off.
   The check needs a balance refreshed within the last 10 minutes; if the CBS can't be reached the normal funding
   stage applies. Charges on allocations still awaiting funding follow the current tariff; once funded they are fixed.
   The Balances card shows the account balance, the charges and the total to pay, recalculated on every view. */

Object.assign(DEFAULT_TEMPLATES, {
  FUNDS_SUFFICIENT_CLIENT: {
    name: 'Forex allocated – sufficient funds', audience: 'Client', trigger: 'Treasury allocates and the account already has enough funds',
    subject: 'Foreign currency allocated – your transaction will be processed shortly',
    body: 'Dear {{customerName}},\n\nWe are pleased to advise that {{currency}} {{allocatedAmount}} has been allocated to your application {{ref}} at a rate of {{rate}}.\n\nYour account {{account}} has sufficient funds, so no further action is needed: MWK {{mwkEquivalent}} plus bank charges of MWK {{chargesTotal}} ({{chargesText}}) – a total of MWK {{totalToFund}} – will be debited.\n\nYour transaction will be processed shortly. We will confirm once the payment has been made.\n\nYours faithfully,\n{{bankName}}',
  },
});

const Funding = {
  fresh: {},                       // appId → time (ms) the balance was last refreshed from the CBS
  FRESH_MS: 10 * 60 * 1000,

  /* Refresh the available balance from the CBS (async in the live version). */
  async refresh(app) {
    const rec = await CBS.lookup(app.customer.account);
    this.applyBalance(app, rec);
  },
  /* Same, from the simulated CBS (test-data generator). */
  refreshSync(app) { const rec = CBS.simulated(app.customer.account); if (rec) this.applyBalance(app, rec); return !!rec; },

  applyBalance(app, rec) {
    const before = `${app.balanceCurrency} ${U.num(app.balance)}`;
    app.balance = rec.availableBalance;
    app.balanceCurrency = rec.currency;
    app.balanceAt = Store.now().toISOString();
    if (app.customer.cbs) Object.assign(app.customer.cbs, { balance: rec.availableBalance, currency: rec.currency, balanceAt: Store.now().toISOString() });
    this.fresh[app.id] = Date.now();
    const after = `${rec.currency} ${U.num(rec.availableBalance)}`;
    if (before !== after) Store.audit('BALANCE_REFRESHED', app, `Available balance refreshed from ${rec.source}: ${before} → ${after}`);
  },
  isFresh(app) { return Date.now() - (this.fresh[app.id] || 0) < this.FRESH_MS; },

  /* MWK value of one unit of the account currency, using the allocation's own rates where they apply. */
  perUnit(app, alloc, ccy) {
    if (ccy === 'MWK') return 1;
    if (alloc && ccy === (alloc.allocCurrency || app.currency)) return alloc.rate / (alloc.crossRate || 1);
    if (alloc && ccy === app.currency) return alloc.rate;
    return Rules.toMWK(1, ccy);
  },

  /* Allocation + charges against the available balance, in the account's currency. */
  check(app, alloc) {
    const ch = Charges.forAlloc(app, alloc);
    const mwk = U.round2(alloc.amount * alloc.rate), totalMWK = U.round2(mwk + ch.total);
    const ccy = app.balanceCurrency || 'MWK', unit = this.perUnit(app, alloc, ccy);
    const need = U.round2(totalMWK / unit), have = Number(app.balance) || 0;
    return { mwk, charges: ch.total, totalMWK, ccy, need, have, ok: have >= need - 0.005 };
  },

  /* Called by Engine.allocate before the client is advised. Returns true when the funding stage was skipped. */
  autoFund(app, alloc) {
    if (!this.isFresh(app)) { Store.audit('FUNDS_CHECK', app, 'Available balance could not be confirmed from the CBS just now – the client is asked to fund the account as usual'); return false; }
    const c = this.check(app, alloc);
    if (!c.ok) {
      Store.audit('FUNDS_CHECK', app, `Insufficient funds: available ${c.ccy} ${U.num(c.have)}, needed ${c.ccy} ${U.num(c.need)} (MWK ${U.num(c.totalMWK)} incl. charges) – client asked to fund by the cut-off`);
      return false;
    }
    const now = Engine.nowISO();
    Object.assign(alloc, { status: 'FUNDED', fundedAt: now, fundedBy: 'system',
      autoFunded: { at: now, currency: c.ccy, balanceBefore: c.have, debit: c.need, balanceAfter: U.round2(c.have - c.need), mwk: c.mwk, charges: c.charges, totalMWK: c.totalMWK } });
    app.balance = U.round2(c.have - c.need);
    app.balanceAt = now;                         // the balance after this debit
    if (app.customer.cbs) Object.assign(app.customer.cbs, { balance: app.balance, balanceAt: now });
    app.status = Engine.deriveStatus(app);
    Engine.addComment(app, 'Funds verified automatically', `Available ${c.ccy} ${U.num(c.have)} covers ${c.ccy} ${U.num(c.need)} (MWK ${U.num(c.mwk)} + charges MWK ${U.num(c.charges)}). Funding stage skipped.`);
    Store.audit('FUNDS_VERIFIED_AUTO', app, `Sufficient funds – funding stage skipped: account debited ${c.ccy} ${U.num(c.need)} (MWK ${U.num(c.totalMWK)} incl. charges MWK ${U.num(c.charges)}); balance now ${c.ccy} ${U.num(app.balance)}`);
    Engine.notify('FUNDS_SUFFICIENT_CLIENT', app, ['client'], Engine.allocVars(app, alloc));
    const recipients = [{ role: 'EC' }];
    if (Rules.isTravel(app)) recipients.push({ branchId: app.branchId });
    if (app.assignment?.kind === 'USER' && Store.userById(app.assignment.userId)?.role !== 'EC') recipients.push({ userId: app.assignment.userId });
    if (app.assignment?.kind === 'BRANCH') recipients.push({ branchId: app.assignment.branchId });
    Engine.notify('FUNDED_INTERNAL', app, recipients, { comment: `Sufficient funds verified automatically from the CBS; account debited MWK ${U.num(c.totalMWK)} incl. charges.`, confirmedBy: 'System (CBS balance check)' });
    return true;
  },

  /* Debits already taken by automatic funding on this account after `since` (for the simulated CBS balance). */
  debitsSince(account, since, ccy) {
    const acct = Engine.normAccount(account);
    let total = 0;
    Store.state.apps.forEach(a => {
      if (Engine.normAccount(a.customer?.account) !== acct) return;
      (a.allocations || []).forEach(al => { const d = al.autoFunded; if (d && d.at > since && d.currency === ccy) total += d.debit; });
    });
    return U.round2(total);
  },

  /* Extra rows for the Balances card (allocation.js), recalculated on every view. */
  summaryHtml(app) {
    if (!app.type || !(Number(app.amount) > 0)) return '';
    const t = Engine.totals(app), e = U.esc;
    const waiting = (app.allocations || []).filter(a => a.status === 'AWAITING_FUNDING').map(a => ({ a, c: this.check(app, a) }));
    const openAllocs = (app.allocations || []).filter(a => a.status === 'FUNDED' && a.amount - a.paid > 0.005);
    const unallocMWK = U.round2(Rules.toMWK(t.unallocated, app.currency));
    const est = Charges.calc(app.type, app.currency, t.unallocated);
    const allocMWK = U.sum(waiting, w => w.c.mwk), allocCh = U.sum(waiting, w => w.c.charges);
    const total = U.round2(allocMWK + allocCh + unallocMWK + est.total);
    const auto = (app.allocations || []).filter(a => a.autoFunded);
    const k = app.customer?.cbs;
    const row = (l, v, strong) => `<tr><td>${l}</td><td class="num">${strong ? `<b>${v}</b>` : v}</td></tr>`;
    return `<div style="margin:0 12px 12px"><table class="proj"><tbody>
      ${row(`Account balance${k?.balanceAt || k?.at ? ` <small class="muted">(CBS, ${U.fmtDateTime(k.balanceAt || k.at)})</small>` : ' <small class="muted">(as captured)</small>'}`, U.money(app.balance, app.balanceCurrency))}
      ${waiting.map(w => row(`To fund now – ${U.money(w.a.allocAmount ?? w.a.amount, w.a.allocCurrency || app.currency)} by ${U.fmtDateTime(w.a.deadline)}`, `MWK ${U.num(w.c.mwk)} + charges MWK ${U.num(w.c.charges)} = MWK ${U.num(w.c.totalMWK)}`)).join('')}
      ${t.unallocated > 0.005 ? row(`Still to allocate ${U.money(t.unallocated, app.currency)} <small class="muted">(indicative rate)</small>`, `≈ MWK ${U.num(unallocMWK)} + charges ≈ MWK ${U.num(est.total)}`) : ''}
      ${waiting.length || t.unallocated > 0.005 ? row('Total still to be paid by the client, incl. charges', `≈ MWK ${U.num(total)}`, true) : ''}
      ${openAllocs.length ? row('Funded, waiting to be paid out', U.money(U.sum(openAllocs, a => a.amount - a.paid), app.currency)) : ''}
      ${auto.map(a => row(`<span class="badge plain t-green">Funds verified automatically</span> ${U.fmtDateTime(a.autoFunded.at)}`, `debited ${e(a.autoFunded.currency)} ${U.num(a.autoFunded.debit)} · balance after ${e(a.autoFunded.currency)} ${U.num(a.autoFunded.balanceAfter)}`)).join('')}
    </tbody></table></div>`;
  },

  /* Note at the top of the allocation dialog. */
  note(app) {
    const ok = this.isFresh(app), k = app.customer?.cbs;
    return `<div class="alert ${ok ? 'info' : 'warn'}" style="margin-bottom:12px"><div>${ok
      ? `Available balance from the CBS just now: <b>${U.money(app.balance, app.balanceCurrency)}</b>. If it covers the MWK equivalent plus charges, the funding stage is skipped: the account is debited, Exchange Control is told it is ready and the client that it will be processed shortly. Otherwise the client is asked to fund by the cut-off.`
      : `The balance could not be refreshed from the CBS${k ? ` (last known ${U.money(app.balance, app.balanceCurrency)})` : ''}, so the client will be asked to fund the account by the cut-off as usual.`}</div></div>`;
  },
};

/* ---------- hooks ---------- */
(() => {
  // Refresh the balance from the CBS before Treasury allocates.
  const baseAllocate = Actions.allocate;
  Actions.allocate = async app => {
    try { await Funding.refresh(app); Store.save(); } catch (e) { UI.toast(`Balance not refreshed from the CBS: ${e.message}`, 'error'); }
    baseAllocate(app);
  };
  const baseSummary = Allocation.summary.bind(Allocation);
  Allocation.summary = app => baseSummary(app) + Funding.summaryHtml(app);
  const baseLabel = Views.actionLabel.bind(Views);
  Views.actionLabel = x => ({ FUNDS_VERIFIED_AUTO: 'Funds verified automatically', FUNDS_CHECK: 'Funds check', BALANCE_REFRESHED: 'Balance refreshed from CBS' })[x] || baseLabel(x);
})();
