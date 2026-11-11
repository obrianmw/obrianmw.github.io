'use strict';

/* Treasury allocation in any currency, Treasury corrections before funding, and payments per allocation.
   Projections shown while allocating: amount in the allocated currency, its equivalent in the applied currency,
   MWK the client must fund, and the balance still to allocate / outstanding afterwards (part allocations).
   The business rules are in Engine.allocCalc / allocate / editAllocation / recordPayment and Rules (invoices). */

const Allocation = {
  ccys(app) { return CURRENCIES.filter(c => c !== 'MWK').sort((a, b) => (a === app.currency ? -1 : b === app.currency ? 1 : a.localeCompare(b))); },

  /* Suggested cross rate: units of `to` per 1 unit of `from`, from the indicative rates (MWK per unit). */
  suggestCross(from, to) {
    const r = Store.state.settings.rates;
    return from === to || !r[from] || !r[to] ? 1 : Math.round(r[from] / r[to] * 1e6) / 1e6;
  },

  /* Balances card on the application page. */
  summary(app) {
    const t = Engine.totals(app), c = app.currency, m = v => U.money(v, c);
    const u = Rules.invoiceUsage(app);
    const box = (label, v, cls = '') => `<div class="kpi ${cls}"><div class="v" style="font-size:17px">${v}</div><div class="l">${label}</div></div>`;
    return `<div class="kpis" style="margin:12px">
        ${box('Applied', m(app.amount))}
        ${box('Allocated', m(t.allocated), t.allocated ? 'violet' : '')}
        ${box('Paid', m(t.paid), t.paid ? 'green' : '')}
        ${box('Outstanding balance', m(t.balance), t.balance > 0.005 && t.paid > 0 ? 'amber' : '')}
        ${box('Still to allocate', m(t.unallocated))}
      </div>
      ${u && u.invoice ? `<div class="alert ${u.paidElsewhere + t.paid > u.invoice - 0.005 ? 'warn' : 'info'}" style="margin:0 12px 12px"><div>Invoice <b>${U.esc(u.number)}</b>: ${m(u.invoice)}${u.others.length ? ` · also on ${u.others.map(o => `${U.esc(o.ref)} (${m(o.used)})`).join(', ')}` : ''} · paid on this invoice so far ${m(u.paidElsewhere + t.paid)} · can still be paid ${m(Math.max(0, u.invoice - u.paidElsewhere - t.paid))}</div></div>` : ''}`;
  },

  table(app) {
    const e = U.esc;
    return `<div class="table-wrap"><table><thead><tr><th>Allocated</th><th class="num">Amount allocated</th><th class="num">≈ ${e(app.currency)}</th><th class="num">Rate (MWK/${e(app.currency)})</th><th class="num">Cross rate</th><th class="num">MWK to fund</th><th class="num">Paid</th><th>Fund by</th><th>Status</th></tr></thead><tbody>
      ${app.allocations.map(a => {
        const i = Engine.allocInfo(app, a);
        return `<tr><td>${U.fmtDateTime(a.at)}<br><small>${e(UI.userName(a.by))}${a.advisedByName ? ` · on advice of ${e(a.advisedByName)}` : ''}${a.editedAt ? ` · changed ${U.fmtDateTime(a.editedAt)}` : ''}</small></td>
          <td class="num"><b>${U.money(i.amt, i.ccy)}</b>${a.released ? `<br><small>${U.num(a.released)} released</small>` : ''}</td>
          <td class="num">${i.same ? '<span class="muted">same</span>' : U.num(a.amount)}</td>
          <td class="num">${U.num(a.rate, 4)}</td>
          <td class="num">${i.same ? (a.crossRate ? `<small class="muted">${U.num(a.crossRate, 4)}</small>` : '—') : `${U.num(i.cross, 6)}<br><small>${e(i.ccy)} per ${e(app.currency)}</small>`}</td>
          <td class="num">${U.num(a.amount * a.rate)}</td>
          <td class="num">${i.paid ? U.money(i.paid, i.ccy) : '—'}</td>
          <td class="nowrap">${U.fmtDateTime(a.deadline)}</td>
          <td>${{ AWAITING_FUNDING: UI.tag('Awaiting funding', 'violet'), FUNDED: UI.tag(a.amount - a.paid > 0.005 ? 'Funded' : 'Paid', 'green'), FORFEITED: UI.tag('Forfeited', 'red'), CANCELLED: UI.tag('Cancelled – client request', 'grey') }[a.status]}</td></tr>
          ${a.note ? `<tr><td colspan="9"><small>Note: ${e(a.note)}</small></td></tr>` : ''}`;
      }).join('')}
    </tbody></table></div>`;
  },

  /* Allocation form used for a new allocation and for corrections. */
  form(app, current) {
    const t = Engine.totals(app);
    const room = U.round2(t.unallocated + (current ? current.amount : 0));
    const i = current ? Engine.allocInfo(app, current) : { ccy: app.currency, same: true, amt: room, cross: 1 };
    const rate = current ? current.rate : (Store.state.settings.rates[app.currency] || '');
    // Exchange Control entering this on Treasury's advice (Treasury officer working remotely) must name the officer.
    const onBehalf = Engine.requiresAdvisedBy();
    const treasury = Store.state.users.filter(u => u.role === 'TREASURY' && u.active !== false).sort((x, y) => x.name.localeCompare(y.name));
    const advHtml = onBehalf ? `<label class="f span-all"><span>Treasury officer who advised this allocation <b class="req">*</b></span>
        <select name="advisedBy"><option value="">Select…</option>${treasury.map(u => `<option value="${u.id}" ${current && current.advisedBy === u.id ? 'selected' : ''}>${U.esc(u.name)}</option>`).join('')}</select>
        <div class="hint">You are entering this on Treasury's behalf; the officer and your name are recorded in the audit trail.</div></label>` : '';
    return { room, html: `<div class="grid g2">
        ${advHtml}
        <label class="f"><span>Currency to allocate <b class="req">*</b></span><select name="allocCurrency">${this.ccys(app).map(c => `<option ${c === i.ccy ? 'selected' : ''}>${c}</option>`).join('')}</select>
          <div class="hint">Applied for in ${U.esc(app.currency)}. Choose another currency to allocate it instead; a cross rate is then required.</div></label>
        <label class="f"><span>Amount to allocate (<span data-ccy>${U.esc(i.ccy)}</span>) <b class="req">*</b></span><input name="amount" type="number" step="0.01" min="0" value="${U.round2(i.amt)}">
          <div class="hint"><a href="#" data-full>Allocate the full balance</a></div></label>
        <label class="f"><span>Rate – MWK per 1 ${U.esc(app.currency)} <b class="req">*</b></span><input name="rate" type="number" step="0.0001" min="0" value="${rate}">
          <div class="hint">Indicative: ${U.num(Store.state.settings.rates[app.currency] || 0, 4)}</div></label>
        <label class="f" data-cross><span>Cross rate – <span data-ccy>${U.esc(i.ccy)}</span> per 1 ${U.esc(app.currency)} <b class="req">*</b></span><input name="crossRate" type="number" step="0.000001" min="0" value="${i.same ? '' : i.cross}">
          <div class="hint" data-cross-hint></div></label>
        ${current ? '' : `<label class="f"><span>Value date</span><input name="valueDate" type="date" value="${U.dayKey(Store.now())}"></label>`}
        <label class="f ${current ? 'span-all' : ''}"><span>${current ? 'Reason for the change' : 'Note'}</span><input name="note"></label>
      </div>
      <div id="al-prev" style="margin-top:12px"></div>` };
  },

  bindForm(el, app, room, deadline) {
    const q = n => el.querySelector(`[name=${n}]`);
    let lastCcy = q('allocCurrency').value;
    const upd = () => {
      const ccy = q('allocCurrency').value, same = ccy === app.currency;
      if (ccy !== lastCcy) {   // currency changed: suggest the cross rate and convert the amount
        const cross = this.suggestCross(app.currency, ccy);
        q('crossRate').value = same ? '' : cross;
        q('amount').value = U.round2(room * (same ? 1 : cross));
        lastCcy = ccy;
      }
      el.querySelectorAll('[data-ccy]').forEach(s => { s.textContent = ccy; });
      const crossBox = el.querySelector('[data-cross]');
      crossBox.style.opacity = same ? 0.5 : 1;
      q('crossRate').disabled = same;
      el.querySelector('[data-cross-hint]').textContent = same ? 'Not needed: allocating in the applied currency.' : `Indicative: ${U.num(this.suggestCross(app.currency, ccy), 6)}. Mandatory when the currencies differ.`;
      const amt = Number(q('amount').value) || 0, rate = Number(q('rate').value) || 0, cross = same ? 1 : Number(q('crossRate').value) || 0;
      const box = el.querySelector('#al-prev');
      if (!same && !(cross > 0)) { box.innerHTML = `<div class="alert error"><div>Enter the cross rate: how many ${U.esc(ccy)} equal 1 ${U.esc(app.currency)}.</div></div>`; return; }
      const equiv = same ? amt : U.round2(amt / cross), tol = 0.005 + (same ? 0 : 0.01 / cross);
      const over = equiv > room + tol, left = Math.max(0, U.round2(room - equiv)), mwk = equiv * rate;
      box.innerHTML = `<div class="alert ${over ? 'error' : 'info'}"><div>
        <table class="proj"><tbody>
          <tr><td>Allocating</td><td class="num"><b>${U.money(amt, ccy)}</b></td></tr>
          ${same ? '' : `<tr><td>Equivalent in the applied currency</td><td class="num"><b>${U.money(equiv, app.currency)}</b> <small>(${U.num(amt)} ÷ ${U.num(cross, 6)})</small></td></tr>
          <tr><td>Implied rate</td><td class="num">MWK ${U.num(rate / cross, 4)} per ${U.esc(ccy)}</td></tr>`}
          <tr><td>Client must fund</td><td class="num"><b>MWK ${U.num(mwk)}</b></td></tr>
          <tr><td>Still to allocate after this</td><td class="num">${U.money(left, app.currency)}${same || !left ? '' : ` <small>(≈ ${U.money(left * cross, ccy)})</small>`}</td></tr>
          <tr><td>Outstanding balance on the application</td><td class="num">${U.money(Engine.totals(app).balance, app.currency)} <small>(reduces as payments are made)</small></td></tr>
        </tbody></table>
        ${over ? `<b>Too much:</b> at most ${U.money(room, app.currency)}${same ? '' : ` (≈ ${U.money(room * cross, ccy)})`} can be allocated.` : (left > 0.005 ? '<b>Part allocation:</b> the rest stays open for a further allocation.' : '')}
        ${deadline ? `<div style="margin-top:6px">Fund account ${U.esc(app.customer.account)} by <b>${U.fmtDateTime(deadline)}</b>, or the allocation is forfeited. The client is notified now.</div>` : '<div style="margin-top:6px">The client is sent the corrected allocation.</div>'}
      </div></div>`;
    };
    el.querySelectorAll('input, select').forEach(x => { x.addEventListener('input', upd); x.addEventListener('change', upd); });
    el.querySelector('[data-full]').addEventListener('click', ev => {
      ev.preventDefault();
      const ccy = q('allocCurrency').value, cross = ccy === app.currency ? 1 : Number(q('crossRate').value) || this.suggestCross(app.currency, ccy);
      q('amount').value = U.round2(room * cross);
      upd();
    });
    upd();
  },

  allocate(app) {
    const f = this.form(app, null), deadline = Engine.fundingDeadline();
    UI.modal({
      title: `Allocate forex – ${app.ref}`, wide: true, body: (typeof Funding !== 'undefined' ? Funding.note(app) : '') + f.html,
      onOpen: el => this.bindForm(el, app, f.room, deadline),
      actions: [{ label: 'Allocate & notify client', onClick: el => {
        const d = UI.formData(el);
        const a = Engine.allocate(app, d);
        Actions.done(a.autoFunded
          ? `Forex allocated. The account has sufficient funds: funded automatically (debited MWK ${U.num(a.autoFunded.totalMWK)} incl. charges) and the client told it will be processed shortly.`
          : `Forex allocated${d.allocCurrency !== app.currency ? ` in ${d.allocCurrency}` : ''}. The client has been asked to fund the account.`);
      } }],
    });
  },

  editAllocation(app) {
    const a = app.allocations.find(x => x.status === 'AWAITING_FUNDING');
    const f = this.form(app, a);
    UI.modal({
      title: `Change allocation – ${app.ref}`, wide: true,
      body: `<div class="alert warn" style="margin-bottom:12px"><div>Correct the currency, rate, cross rate or amount before the client funds the account. The funding deadline stays ${U.fmtDateTime(a.deadline)}; the change is in the audit trail.</div></div>${f.html}`,
      onOpen: el => this.bindForm(el, app, f.room, null),
      actions: [{ label: 'Save & re-advise client', onClick: el => { Engine.editAllocation(app, a.id, UI.formData(el)); Actions.done('Allocation changed. The client has been sent the new amounts.'); } }],
    });
  },

  /* Payment against one funded allocation, in that allocation's currency. */
  pay(app) {
    const funded = app.allocations.filter(a => a.status === 'FUNDED' && a.amount - a.paid > 0.005);
    const t = Engine.totals(app);
    const opt = a => { const i = Engine.allocInfo(app, a); return `<option value="${a.id}">${U.money(U.round2(i.amt - i.paid), i.ccy)} left of ${U.money(i.amt, i.ccy)} allocated ${U.fmtDate(a.at)}</option>`; };
    UI.modal({
      title: `Record payment – ${app.ref}`, wide: true,
      body: `<div class="grid g2">
          <label class="f span-all"><span>Pay against allocation</span><select name="allocationId">${funded.map(opt).join('')}</select></label>
          <label class="f"><span>Amount paid (<span data-ccy></span>) <b class="req">*</b></span><input name="amount" type="number" step="0.01" min="0"><div class="hint" data-left></div></label>
          <label class="f"><span>Value date</span><input name="valueDate" type="date" value="${U.dayKey(Store.now())}"></label>
          <label class="f"><span>Payment reference (e.g. MT103) <b class="req">*</b></span><input name="reference"></label>
          <label class="f"><span>Correspondent bank</span><select name="correspondentId"><option value="">—</option>${Store.state.correspondents.map(c => `<option value="${c.id}">${U.esc(c.name)} (${U.esc(c.currencies)})</option>`).join('')}</select></label>
          <div class="span-all"><b>Outcome</b><div class="radio-row" style="margin-top:6px">
            <label class="radio-card"><input type="radio" name="outcome" value="PART"><span><b>Partly paid</b><small>The rest of the balance stays outstanding for a further payment or allocation.</small></span></label>
            <label class="radio-card"><input type="radio" name="outcome" value="FULL"><span><b>Fully paid – close</b><small>Closes the application; anything not paid is cancelled (close short).</small></span></label></div></div>
          <label class="f span-all"><span>Comment</span><textarea name="comment"></textarea></label>
        </div>
        <div id="pay-prev" style="margin-top:10px"></div>
        ${app.type === 'ADVANCE' ? `<div class="alert info" style="margin-top:10px">Advance payment: once fully paid, the reconciliation date is set to ${Store.state.settings.reconDays} days from today and reminders are scheduled.</div>` : ''}`,
      onOpen: el => {
        const q = n => el.querySelector(`[name=${n}]`);
        let lastAl = null, outcomeTouched = false;
        el.querySelectorAll('[name=outcome]').forEach(r => r.addEventListener('change', () => { outcomeTouched = true; upd(); }));
        const upd = () => {
          const a = funded.find(x => x.id === q('allocationId').value), i = Engine.allocInfo(app, a), leftAlloc = U.round2(i.amt - i.paid);
          if (a.id !== lastAl) { q('amount').value = leftAlloc; lastAl = a.id; }
          el.querySelector('[data-ccy]').textContent = i.ccy;
          el.querySelector('[data-left]').textContent = `Left on this allocation: ${U.money(leftAlloc, i.ccy)}`;
          const amt = Number(q('amount').value) || 0;
          const equiv = amt >= leftAlloc - 0.005 ? U.round2(a.amount - a.paid) : U.round2(amt / i.cross);
          const balAfter = Math.max(0, U.round2(t.balance - equiv));
          if (!outcomeTouched) el.querySelector(`[name=outcome][value=${balAfter <= 0.005 ? 'FULL' : 'PART'}]`).checked = true;
          const full = UI.formData(el).outcome === 'FULL';
          const u = Rules.invoiceUsage(app);
          const invLeft = u && u.invoice ? U.round2(u.invoice - u.paidElsewhere - t.paid) : null;
          const over = amt > leftAlloc + 0.005 || equiv > t.balance + 0.005 || (invLeft != null && equiv > invLeft + 0.005);
          el.querySelector('#pay-prev').innerHTML = `<div class="alert ${over ? 'error' : full && balAfter > 0.005 ? 'warn' : 'info'}"><div><table class="proj"><tbody>
            <tr><td>Paying</td><td class="num"><b>${U.money(amt, i.ccy)}</b>${i.same ? '' : ` <small>≈ ${U.money(equiv, app.currency)}</small>`}</td></tr>
            <tr><td>Outstanding balance now</td><td class="num">${U.money(t.balance, app.currency)}</td></tr>
            <tr><td>Balance after this payment</td><td class="num"><b>${U.money(balAfter, app.currency)}</b></td></tr>
            ${invLeft != null ? `<tr><td>Invoice ${U.esc(u.number)} – can still be paid</td><td class="num">${U.money(Math.max(0, invLeft), app.currency)}</td></tr>` : ''}
          </tbody></table>
          ${over ? '<b>Not allowed:</b> the payment is more than is left on the allocation, the balance or the invoice.' : full && balAfter > 0.005 ? `<b>Close short:</b> ${U.money(balAfter, app.currency)} will be cancelled.` : balAfter > 0.005 ? (leftAlloc - amt > 0.005 ? `The balance stays open: ${U.money(U.round2(leftAlloc - amt), i.ccy)} is still available on this allocation for a further payment.` : 'The balance stays open: a further allocation is needed to pay it.') : 'This pays the application in full.'}</div></div>`;
        };
        q('allocationId').addEventListener('change', upd);
        q('amount').addEventListener('input', upd);
        upd();
      },
      actions: [{ label: 'Record payment & notify', onClick: async el => {
        const d = UI.formData(el);
        const a = funded.find(x => x.id === d.allocationId), i = Engine.allocInfo(app, a);
        const leftAlloc = U.round2(i.amt - i.paid), amt = Number(d.amount) || 0;
        const equiv = amt >= leftAlloc - 0.005 ? U.round2(a.amount - a.paid) : U.round2(amt / i.cross);
        const after = U.round2(t.balance - equiv);
        if (d.outcome === 'FULL' && after > 0.005) {
          const ok = await UI.confirm('Close short?', `<p>After this payment ${U.money(after, app.currency)} of the ${U.money(app.amount, app.currency)} applied is still unpaid. Closing cancels it.</p>`, 'Close short', 'btn-danger');
          if (!ok) return false;
        }
        Engine.recordPayment(app, d);
        Actions.done(after > 0.005 && d.outcome !== 'FULL' ? `Part payment recorded. Balance ${U.money(after, app.currency)} outstanding.` : 'Payment recorded. Client, inputter and branch notified.');
      } }],
    });
  },
};

/* ---------- hooks ---------- */
(() => {
  Actions.allocate = app => Allocation.allocate(app);
  Actions.editAllocation = app => Allocation.editAllocation(app);
  Actions.pay = app => Allocation.pay(app);
  const baseButtons = Views.actionButtons.bind(Views);
  Views.actionButtons = function (app) {
    let html = baseButtons(app);
    if (Engine.can('editAllocation', app)) {
      const btn = '<button class="" data-action="editAllocation" style="width:100%;justify-content:center">Change allocation (rate / cross rate / amount)</button>';
      html = html.replace('<div style="display:flex;flex-direction:column;gap:8px">', `<div style="display:flex;flex-direction:column;gap:8px">${btn}`);
    }
    return html;
  };
  const baseLabel = Views.actionLabel.bind(Views);
  Views.actionLabel = a => ({ ALLOCATION_EDITED: 'Allocation changed' })[a] || baseLabel(a);
})();
