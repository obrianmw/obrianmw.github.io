'use strict';

/* Bank charges by transaction type and currency.

   A tariff is a list of charge rules. Each rule:
     · applies only to the transaction types ticked on it (types are attached explicitly – a rule with no type
       applies to nothing), and optionally only to applications in some currencies (none ticked = any currency);
     · is a percentage of the transaction amount or a fixed amount;
     · is expressed in MWK (local currency), USD, EUR or the currency applied for. Minimum and maximum (for a
       percentage) are in the same currency.
   Conversion to MWK, for every line:
     · MWK – as is;
     · the currency applied for – at the allocation rate (MWK per unit); before allocation, the indicative rate;
     · USD / EUR when it is the allocated currency – allocation rate ÷ allocation cross rate;
     · USD / EUR otherwise – allocation rate ÷ the cross rate from the indicative rates (units per unit applied);
       before allocation, the indicative rate.
   Each line keeps its currency amount, the rate used and the MWK amount, so the client advice, the Balances card,
   the automatic debit (js/funding.js) and the reports all use the same figures. Charges on an allocation follow the
   tariff until it is funded, then stay fixed.
   Kept in Store.state.charges (Live: config document "charges"). Maintained by Administrator, Treasury and Exchange
   Control (access right "Maintain charges"); everyone can view it. The figures in DEFAULT_CHARGES are samples – set
   the bank's own tariff before go-live. */

const CHARGE_BASES = { PERCENT: 'Percentage of the amount', FIXED: 'Fixed amount' };
const CHARGE_CCYS = { MWK: 'MWK (local currency)', USD: 'USD', EUR: 'EUR', APPLIED: 'Currency applied for' };
const ALL_TYPES = () => Object.keys(TXN_TYPES);
const NON_TRAVEL = ['ADVANCE', 'FREIGHT', 'OPEN_ACCOUNT', 'GIFTS', 'STUDENT_FEES', 'MAINTENANCE'];

const DEFAULT_CHARGES = [
  { id: 'chg_comm', name: 'Commission', types: Object.keys(TXN_TYPES), currencies: [], basis: 'PERCENT', ccy: 'MWK', value: 1, min: 5000, max: 750000, active: true },
  { id: 'chg_swift', name: 'SWIFT transfer fee', types: NON_TRAVEL, currencies: [], basis: 'FIXED', ccy: 'USD', value: 20, min: 0, max: 0, active: true },
  { id: 'chg_cash', name: 'Cash handling fee', types: ['CASH'], currencies: [], basis: 'PERCENT', ccy: 'APPLIED', value: 0.5, min: 5, max: 0, active: true },
  { id: 'chg_card', name: 'Cash passport card fee', types: ['CASH_PASSPORT'], currencies: [], basis: 'FIXED', ccy: 'MWK', value: 20000, min: 0, max: 0, active: true },
  { id: 'chg_exotic', name: 'Minor currency surcharge', types: Object.keys(TXN_TYPES), currencies: ['CNY', 'INR', 'AED', 'ZMW', 'TZS', 'KES'], basis: 'PERCENT', ccy: 'MWK', value: 0.5, min: 10000, max: 0, active: true },
  { id: 'chg_cny', name: 'CNY correspondent fee', types: ['ADVANCE', 'OPEN_ACCOUNT'], currencies: ['CNY'], basis: 'FIXED', ccy: 'USD', value: 10, min: 0, max: 0, active: true },
  { id: 'chg_eur', name: 'EUR correspondent fee', types: NON_TRAVEL, currencies: ['EUR'], basis: 'FIXED', ccy: 'EUR', value: 7.5, min: 0, max: 0, active: true },
];

ACCESS_FIXED.push(['act.charges', 'Actions', 'Maintain charges', 'Define the charges per transaction type and the extra charges for some currencies.', ['ADMIN', 'TREASURY', 'EC']]);

const Charges = {
  /* The tariff; rules saved in the earlier format are converted (no type ticked used to mean all types). */
  rules() {
    if (!Array.isArray(Store.state.charges)) Store.state.charges = U.clone(DEFAULT_CHARGES);
    Store.state.charges.forEach(r => {
      if (r.basis === 'FIXED_MWK') Object.assign(r, { basis: 'FIXED', ccy: 'MWK' });
      else if (r.basis === 'FIXED_CCY') Object.assign(r, { basis: 'FIXED', ccy: 'APPLIED' });
      if (!r.ccy) r.ccy = 'MWK';
      if (!r.typesExplicit) { if (!r.types?.length) r.types = ALL_TYPES(); r.typesExplicit = true; }
    });
    return Store.state.charges;
  },
  canEdit(user = Store.user()) { return Access.has(user, 'act.charges'); },

  applies(r, type, ccy) { return r.active !== false && (r.types || []).includes(type) && (!r.currencies?.length || r.currencies.includes(ccy)); },

  /* MWK per unit of the charge currency c, for an application in `applied`. rate = MWK per unit applied (allocation
     rate, or null before allocation); alloc = the allocation, for its own cross rate. */
  unit(c, applied, rate, alloc) {
    const r = Store.state.settings.rates || {};
    if (c === 'MWK') return { rate: 1, note: '' };
    if (c === 'APPLIED' || c === applied) return rate ? { rate, note: 'allocation rate' } : { rate: Rules.toMWK(1, applied), note: 'indicative rate' };
    if (alloc && (alloc.allocCurrency || applied) === c && alloc.crossRate) return { rate: alloc.rate / alloc.crossRate, note: `allocation rate ÷ cross rate ${U.num(alloc.crossRate, 6)}` };
    if (rate && r[applied] && r[c]) { const cross = r[applied] / r[c]; return { rate: rate / cross, note: `allocation rate ÷ cross rate ${U.num(cross, 6)}` }; }
    return { rate: Rules.toMWK(1, c), note: 'indicative rate' };
  },
  ccyCode(r, applied) { return r.ccy === 'APPLIED' ? applied : r.ccy; },

  /* Charges on an amount in the applied currency. */
  calc(type, ccy, amount, rate = null, alloc = null) {
    const amt = Number(amount) || 0;
    if (!(amt > 0)) return { base: 0, lines: [], total: 0 };   // nothing to charge on
    const mwk = rate ? amt * rate : Rules.toMWK(amt, ccy);
    const lines = this.rules().filter(r => this.applies(r, type, ccy)).map(r => {
      const code = this.ccyCode(r, ccy), u = this.unit(code, ccy, rate, alloc);
      let v;
      if (r.basis === 'PERCENT') {
        v = (code === ccy ? amt : mwk / u.rate) * (Number(r.value) || 0) / 100;
        if (r.min > 0) v = Math.max(v, r.min);
        if (r.max > 0) v = Math.min(v, r.max);
      } else v = Number(r.value) || 0;
      v = U.round2(v);
      return { id: r.id, name: r.name, basis: r.basis, value: r.value, ccy: code, amount: v, rate: u.rate, rateNote: u.note, mwk: U.round2(v * u.rate) };
    }).filter(l => l.mwk > 0);
    return { base: U.round2(mwk), lines, total: U.round2(U.sum(lines, l => l.mwk)) };
  },
  forApp(app) { return this.calc(app.type, app.currency, app.amount); },
  /* Charges on an allocation: they follow the current tariff (and rate) until the allocation is funded, then stay fixed. */
  forAlloc(app, a) {
    if (!a.charges || a.status === 'AWAITING_FUNDING' || !a.charges.lines.every(l => l.ccy)) a.charges = this.calc(app.type, app.currency, a.amount, a.rate, a);
    return a.charges;
  },
  /* Charges taken on the application (funded allocations, plus those awaiting funding). */
  ofApp(app) { return U.round2(U.sum((app.allocations || []).filter(a => ['FUNDED', 'AWAITING_FUNDING'].includes(a.status)), a => this.forAlloc(app, a).total)); },

  lineText(l) { return l.ccy === 'MWK' ? `${l.name} MWK ${U.num(l.mwk)}` : `${l.name} ${l.ccy} ${U.num(l.amount)} @ ${U.num(l.rate, 4)} = MWK ${U.num(l.mwk)}`; },
  text(c) { return c.lines.map(l => this.lineText(l)).join('; ') || 'none'; },
  ccyLabel(r) { return r.ccy === 'APPLIED' ? 'the currency applied for' : r.ccy; },
  describe(r) {
    const c = this.ccyLabel(r);
    return r.basis === 'PERCENT' ? `${U.num(r.value, 2)}% of the amount, in ${c}${r.min > 0 ? `, min ${U.num(r.min)}` : ''}${r.max > 0 ? `, max ${U.num(r.max)}` : ''}` : `${U.num(r.value)} ${c}`;
  },
  scope(r) {
    const t = r.types || [];
    return `${!t.length ? 'No transaction type – not applied' : t.length === ALL_TYPES().length ? 'All transaction types' : t.map(x => TXN_TYPES[x]?.label.split(' (')[0] || x).join(', ')} · ${r.currencies?.length ? `applications in ${r.currencies.join(', ')}` : 'any currency applied for'}`;
  },

  table(c, title = 'Charges') {
    return `<table class="proj"><tbody>${c.lines.map(l => `<tr><td>${U.esc(l.name)}</td><td class="num">${l.ccy === 'MWK' ? '' : `${l.ccy} ${U.num(l.amount)}<br><small class="muted">@ ${U.num(l.rate, 4)} (${U.esc(l.rateNote)})</small>`}</td><td class="num">MWK ${U.num(l.mwk)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No charges apply.</td></tr>'}
      ${c.lines.length ? `<tr><th>${U.esc(title)}</th><th></th><th class="num">MWK ${U.num(c.total)}</th></tr>` : ''}</tbody></table>`;
  },

  /* Card on the application page. */
  card(app) {
    if (!app.type || !(Number(app.amount) > 0)) return '';
    const est = this.forApp(app);
    const allocs = (app.allocations || []).filter(a => a.status !== 'FORFEITED' && a.status !== 'CANCELLED');
    return `<div class="card"><div class="card-h"><h2>Charges</h2><small><a href="#/charges">${this.canEdit() ? 'Tariff' : 'View tariff'}</a></small></div><div class="card-b">
      ${allocs.map(a => `<small class="muted" style="display:block;margin-top:6px">Allocation ${U.fmtDate(a.at)} · ${U.money(a.allocAmount ?? a.amount, a.allocCurrency || app.currency)} at ${U.num(a.rate, 4)}${a.status === 'AWAITING_FUNDING' ? ' – follows the current tariff until funded' : ' – fixed'}:</small>${this.table(this.forAlloc(app, a), 'Charges')}`).join('')}
      ${allocs.length ? `<table class="proj" style="margin-top:6px"><tbody><tr><th>Charges on this application</th><th class="num">MWK ${U.num(this.ofApp(app))}</th></tr></tbody></table>` : `<small class="muted">Estimate on the amount applied (${U.money(app.amount, app.currency)} ≈ MWK ${U.num(est.base)}, indicative rates):</small>${this.table(est, 'Estimated charges')}`}
    </div></div>`;
  },

  /* ---------- #/charges – tariff ----------
     Saved charges are shown locked. Users with "Maintain charges" press Edit on one charge to unlock its fields
     (transaction types and currencies as tick boxes), then Save or Cancel; Add charge opens a new one for editing.
     Each save and delete is audited. Everyone else sees the tariff read-only. */
  editing: null,          // { id, row, isNew }
  rowLine(r) { return `${r.name}: ${this.describe(r)} (${this.scope(r)})${r.active === false ? ' – inactive' : ''}`; },

  page() {
    const edit = this.canEdit(), e = U.esc;
    UI.setTitle('Charges', edit ? 'Tariff' : 'Tariff (view only)');
    const rules = this.rules();
    const ed = this.editing && (this.editing.isNew || rules.some(r => r.id === this.editing.id)) ? this.editing : (this.editing = null);
    const calc = this.calcState = this.calcState || { type: 'ADVANCE', currency: 'USD', amount: 10000 };
    const typeName = k => TXN_TYPES[k]?.label || k;
    const chips = list => list.map(x => `<span class="badge plain t-grey">${e(x)}</span>`).join(' ');

    const viewRow = r => `<div class="charge-row locked">
        <div class="ch-main"><b>${e(r.name)}</b> ${r.active === false ? UI.tag('Inactive', 'grey') : UI.tag('Active', 'green')}
          <div class="ch-what">${e(this.describe(r))}</div></div>
        <div class="ch-scope"><small class="muted">Transaction types</small><div>${(r.types || []).length === ALL_TYPES().length ? chips(['All transaction types']) : chips((r.types || []).map(typeName)) || '<span class="muted">none</span>'}</div>
          <small class="muted">Currencies applied for</small><div>${r.currencies?.length ? chips(r.currencies) : chips(['Any currency'])}</div></div>
        ${edit ? `<div class="ch-act"><button class="btn-sm" data-edit="${r.id}" ${ed ? 'disabled' : ''}>✎ Edit</button><button class="btn-sm btn-danger" data-delete="${r.id}" ${ed ? 'disabled' : ''} aria-label="Delete ${e(r.name)}">✕</button></div>` : ''}
      </div>`;

    const editRow = r => `<div class="charge-row editing" id="ch-form">
        <div class="grid g3">
          <label class="f span2"><span>Charge name <b class="req">*</b></span><input name="name" value="${e(r.name)}"></label>
          <label class="f"><span>Status</span><select name="active"><option value="1" ${r.active !== false ? 'selected' : ''}>Active</option><option value="0" ${r.active === false ? 'selected' : ''}>Inactive</option></select></label>
          <label class="f"><span>Basis</span><select name="basis">${Object.entries(CHARGE_BASES).map(([k, l]) => `<option value="${k}" ${r.basis === k ? 'selected' : ''}>${e(l)}</option>`).join('')}</select></label>
          <label class="f"><span>Charge currency</span><select name="ccy">${Object.entries(CHARGE_CCYS).map(([k, l]) => `<option value="${k}" ${r.ccy === k ? 'selected' : ''}>${e(l)}</option>`).join('')}</select></label>
          <label class="f"><span><span id="ch-vlabel">${r.basis === 'PERCENT' ? 'Percentage (%)' : 'Amount'}</span> <b class="req">*</b></span><input name="value" type="number" step="0.01" min="0" value="${r.value || ''}"></label>
          <label class="f ch-pct"><span>Minimum (in the charge currency)</span><input name="min" type="number" step="0.01" min="0" value="${r.min || 0}"></label>
          <label class="f ch-pct"><span>Maximum (0 = none)</span><input name="max" type="number" step="0.01" min="0" value="${r.max || 0}"></label>
        </div>
        <div class="grid g2" style="margin-top:10px">
          <fieldset class="checks"><legend>Transaction types requiring this charge <b class="req">*</b> <button type="button" class="btn-sm" data-all="types">All</button> <button type="button" class="btn-sm" data-none="types">None</button></legend>
            ${Object.entries(TXN_TYPES).map(([k, t]) => `<label><input type="checkbox" name="types" value="${k}" ${(r.types || []).includes(k) ? 'checked' : ''}> ${e(t.label)}</label>`).join('')}</fieldset>
          <fieldset class="checks"><legend>Only for applications in these currencies <small class="muted">(none ticked = any)</small> <button type="button" class="btn-sm" data-none="currencies">Clear</button></legend>
            <div class="checks-cols">${CURRENCIES.map(c => `<label><input type="checkbox" name="currencies" value="${c}" ${(r.currencies || []).includes(c) ? 'checked' : ''}> ${c}</label>`).join('')}</div></fieldset>
        </div>
        <div class="btn-row" style="margin-top:12px;justify-content:flex-end"><button id="ch-cancel">Cancel</button><button class="btn-primary" id="ch-save">${ed.isNew ? 'Add charge' : 'Save changes'}</button></div>
      </div>`;

    const rows = rules.map(r => (ed && ed.id === r.id ? editRow(ed.row) : viewRow(r)));
    if (ed?.isNew) rows.push(editRow(ed.row));
    document.getElementById('view').innerHTML = `
      <div class="alert info" style="margin-bottom:12px"><div>Each charge applies only to the <b>transaction types ticked</b> on it, optionally only to some currencies applied for. It is a percentage or a fixed amount in <b>MWK, USD, EUR or the currency applied for</b>; foreign-currency charges are converted at the allocation rate, with the cross rate where the currencies differ. ${edit ? 'Saved charges are locked – press <b>Edit</b> on a charge to change it.' : 'Only authorised users (Administrator, Treasury, Exchange Control) can change the tariff.'}</div></div>
      <div class="card"><div class="card-h"><h2>Charges (${rules.length})</h2>${edit ? `<button class="btn-sm btn-primary" id="ch-add" ${ed ? 'disabled' : ''}>+ Add charge</button>` : ''}</div>
        <div class="card-b">${rows.join('') || '<div class="empty">No charges defined.</div>'}</div></div>
      <div class="card" style="margin-top:16px"><div class="card-h"><h2>Calculator</h2><small>Saved tariff</small></div><div class="card-b">
        <div class="toolbar"><select id="cc-type" aria-label="Type">${Object.entries(TXN_TYPES).map(([k, t]) => `<option value="${k}" ${calc.type === k ? 'selected' : ''}>${e(t.label)}</option>`).join('')}</select>
          <select id="cc-ccy" aria-label="Currency">${CURRENCIES.map(c => `<option ${calc.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
          <input type="number" id="cc-amt" value="${calc.amount}" min="0" step="0.01" aria-label="Amount" style="width:140px">
          <label>Rate (MWK per unit) <input type="number" id="cc-rate" value="${calc.rate || ''}" min="0" step="0.0001" placeholder="indicative" style="width:120px"></label></div>
        <div id="cc-out"></div>
      </div></div>`;

    const showCalc = () => {
      const c = this.calc(calc.type, calc.currency, calc.amount, calc.rate || null);
      U.$('#cc-out').innerHTML = `<small class="muted">${U.money(calc.amount, calc.currency)} ≈ MWK ${U.num(c.base)} at ${calc.rate ? 'the rate entered' : 'the indicative rate'}</small>${this.table(c, 'Total charges')}`;
    };
    showCalc();
    U.$('#cc-type').addEventListener('change', ev => { calc.type = ev.target.value; showCalc(); });
    U.$('#cc-ccy').addEventListener('change', ev => { calc.currency = ev.target.value; showCalc(); });
    U.$('#cc-amt').addEventListener('input', ev => { calc.amount = Number(ev.target.value) || 0; showCalc(); });
    U.$('#cc-rate').addEventListener('input', ev => { calc.rate = Number(ev.target.value) || 0; showCalc(); });
    if (!edit) return;

    const redraw = () => this.page();
    U.$('#ch-add')?.addEventListener('click', () => {
      this.editing = { id: U.uid('chg'), isNew: true, row: { name: '', types: [], typesExplicit: true, currencies: [], basis: 'FIXED', ccy: 'MWK', value: 0, min: 0, max: 0, active: true } };
      this.editing.row.id = this.editing.id;
      redraw();
    });
    U.$$('#view [data-edit]').forEach(b => b.addEventListener('click', () => {
      const r = rules.find(x => x.id === b.dataset.edit);
      this.editing = { id: r.id, isNew: false, row: U.clone(r) };
      redraw();
    }));
    U.$$('#view [data-delete]').forEach(b => b.addEventListener('click', async () => {
      const r = rules.find(x => x.id === b.dataset.delete);
      if (!await UI.confirm('Delete charge?', `<p><b>${e(r.name)}</b> (${e(this.describe(r))}) will no longer be applied. Allocations already funded keep their charges.</p>`, 'Delete', 'btn-danger')) return;
      Store.state.charges = rules.filter(x => x.id !== r.id);
      Store.audit('CHARGES_UPDATED', null, `Charge deleted: ${r.name}`, [{ field: 'Charge', from: this.rowLine(r), to: '' }]);
      Store.save();
      UI.toast('Charge deleted.', 'ok');
      redraw();
    }));

    const form = U.$('#ch-form');
    if (!form) return;
    const pct = () => { const p = form.querySelector('[name=basis]').value === 'PERCENT'; form.querySelectorAll('.ch-pct').forEach(x => x.classList.toggle('hidden', !p)); U.$('#ch-vlabel').textContent = p ? 'Percentage (%)' : 'Amount'; };
    pct();
    form.querySelector('[name=basis]').addEventListener('change', pct);
    form.querySelectorAll('[data-all]').forEach(b => b.addEventListener('click', () => form.querySelectorAll(`[name=${b.dataset.all}]`).forEach(cb => { cb.checked = true; })));
    form.querySelectorAll('[data-none]').forEach(b => b.addEventListener('click', () => form.querySelectorAll(`[name=${b.dataset.none}]`).forEach(cb => { cb.checked = false; })));
    U.$('#ch-cancel').addEventListener('click', () => { this.editing = null; redraw(); });
    U.$('#ch-save').addEventListener('click', () => {
      const v = n => form.querySelector(`[name=${n}]`).value;
      const ticked = n => [...form.querySelectorAll(`[name=${n}]:checked`)].map(cb => cb.value);
      const r = Object.assign({}, ed.row, {
        name: v('name').trim(), active: v('active') === '1', basis: v('basis'), ccy: v('ccy'),
        value: Math.max(0, Number(v('value')) || 0), min: Math.max(0, Number(v('min')) || 0), max: Math.max(0, Number(v('max')) || 0),
        types: ticked('types'), currencies: ticked('currencies'), typesExplicit: true,
      });
      if (r.basis !== 'PERCENT') { r.min = 0; r.max = 0; }
      if (!r.name) { UI.toast('Give the charge a name.', 'error'); return; }
      if (!r.types.length) { UI.toast('Tick the transaction types that require this charge.', 'error'); return; }
      if (!(r.value > 0)) { UI.toast('Enter a value greater than zero.', 'error'); return; }
      if (r.max > 0 && r.min > r.max) { UI.toast('The minimum cannot be more than the maximum.', 'error'); return; }
      const old = rules.find(x => x.id === r.id);
      Store.state.charges = ed.isNew ? [...rules, r] : rules.map(x => (x.id === r.id ? r : x));
      Store.audit('CHARGES_UPDATED', null, `${ed.isNew ? 'Charge added' : 'Charge changed'}: ${r.name}`, [{ field: 'Charge', from: old ? this.rowLine(old) : '', to: this.rowLine(r) }]);
      Store.save();
      this.editing = null;
      UI.toast(`${ed.isNew ? 'Charge added' : 'Charge saved'}. Allocations still awaiting funding now use it.`, 'ok');
      redraw();
    });
  },
};

/* ---------- hooks ---------- */
(() => {
  App.routes.push([/^#\/charges$/, () => { Charges.editing = null; Charges.page(); }]);

  // Allocation advice to the client: charges itemised with their currency and rate.
  const OLD_ALLOC_BODY = DEFAULT_TEMPLATES.ALLOCATED_CLIENT.body;
  DEFAULT_TEMPLATES.ALLOCATED_CLIENT = Object.assign({}, DEFAULT_TEMPLATES.ALLOCATED_CLIENT, {
    body: OLD_ALLOC_BODY.replace('Local currency required: MWK {{mwkEquivalent}}.', 'Local currency required: MWK {{mwkEquivalent}}.\nBank charges: MWK {{chargesTotal}} ({{chargesText}}).\nTotal to fund: MWK {{totalToFund}}.'),
  });
  const baseAllocVars = Engine.allocVars.bind(Engine);
  Engine.allocVars = function (app, alloc) {
    const t = Store.state.templates?.ALLOCATED_CLIENT;
    if (t && t.body === OLD_ALLOC_BODY) t.body = DEFAULT_TEMPLATES.ALLOCATED_CLIENT.body;   // unchanged default → add the charges lines
    const c = Charges.forAlloc(app, alloc);
    return Object.assign(baseAllocVars(app, alloc), { chargesTotal: U.num(c.total), chargesText: Charges.text(c), totalToFund: U.num(U.round2(alloc.amount * alloc.rate) + c.total) });
  };
  ['chargesTotal', 'chargesText', 'totalToFund'].forEach(v => { if (!TEMPLATE_VARS.some(x => (Array.isArray(x) ? x[0] : x.key || x) === v)) TEMPLATE_VARS.push([v, { chargesTotal: 'Bank charges on the allocation (MWK)', chargesText: 'The charges itemised (currency, rate, MWK)', totalToFund: 'MWK equivalent plus charges' }[v]]); });

  // Capture form: estimated charges under the equivalents.
  const baseRefresh = Form.refresh.bind(Form);
  Form.refresh = function () {
    baseRefresh();
    const el = U.$('#equiv'), app = this.app;
    if (el && app?.type && Number(app.amount) > 0) { const c = Charges.forApp(app); el.innerHTML += `<br>Charges ≈ MWK ${U.num(c.total)}<br><small>${U.esc(Charges.text(c))}</small>`; }
  };

  // Menu: Charges (everyone can view the tariff).
  const baseChrome = App.renderChrome.bind(App);
  App.renderChrome = function () {
    baseChrome();
    const nav = document.querySelector('#nav');
    const ben = nav?.querySelector('a[href="#/beneficiaries"]') || nav?.querySelector('a[href="#/reconciled"]');
    if (ben && !nav.querySelector('a[href="#/charges"]')) ben.insertAdjacentHTML('afterend', `<a href="#/charges" class="${location.hash === '#/charges' ? 'active' : ''}"><span>Charges</span></a>`);
  };
  const baseLabel = Views.actionLabel.bind(Views);
  Views.actionLabel = x => (x === 'CHARGES_UPDATED' ? 'Charges tariff updated' : baseLabel(x));
})();
