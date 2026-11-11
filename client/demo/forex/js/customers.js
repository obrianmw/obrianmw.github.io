'use strict';

/* Customers and their accounts in the core banking system (CBS).

   A customer number groups every account one customer holds: a person's current, savings and foreign currency
   accounts, or a business's accounts for each of its branches, projects and funds (for example customer
   "Nyasa Mart Ltd" with accounts "Nyasa Mart Ltd – Mzuzu Branch" and "Nyasa Mart Ltd – Staff Welfare Fund").
   Fetching an account brings back its customer number, the customer name and the customer's other accounts; they are
   kept on the application (customer.cbs) and the unreconciled-items check covers every one of them (js/engine.js).

   The simulated CBS (prototype, and Live/Universal without cbs.url) reads js/cbs-directory.js: the same customers as
   cbs-simulator\customers.json. With cbs.url set, the answer comes from the bank's CBS or the simulator program. */

const Customers = {
  idx: null,

  index() {
    if (this.idx) return this.idx;
    const accounts = new Map(), customers = new Map();
    ((typeof CBS_DIRECTORY !== 'undefined' && CBS_DIRECTORY.rows) || []).forEach(([customerNumber, name, type, cls, idType, idNumber, address, phones, emails, accts, risk, kyc]) => {
      const c = { customerNumber, name, type, cls, idType, idNumber, address, risk, kyc,
        phones: phones.map(([number, label]) => ({ number, name: label })), emails: emails.map(([addr, label]) => ({ address: addr, name: label })),
        accounts: accts.map(([accountNumber, accountName, accountType, currency, status, balance, product, branchCode]) => ({ accountNumber, accountName, accountType, currency, status, balance, product, branchCode })) };
      customers.set(customerNumber, c);
      c.accounts.forEach(a => accounts.set(a.accountNumber, { c, a }));
    });
    return (this.idx = { accounts, customers });
  },

  byAccount(no) { return this.index().accounts.get(Engine.normAccount(no)) || null; },
  customer(no) { return this.index().customers.get(String(no || '').trim()) || null; },
};

(() => {
  /* Simulated lookup: the directory customer when the account is in it, else (as before) the latest application. */
  const baseSimulated = CBS.simulated.bind(CBS);
  CBS.simulated = function (no) {
    const hit = Customers.byAccount(no);
    if (!hit) return baseSimulated(no);
    const { c, a } = hit, acct = a.accountNumber;
    // The balance last seen on an application for the account, else the directory's; less what funding has debited since.
    const last = Store.state.apps.filter(x => Engine.normAccount(x.customer?.account) === acct && Number(x.balance) > 0 && x.balanceCurrency === a.currency)
      .sort((x, y) => (y.updatedAt || y.createdAt || '').localeCompare(x.updatedAt || x.createdAt || ''))[0];
    const since = last ? (last.balanceAt || last.customer?.cbs?.at || last.createdAt || '') : CBS_DIRECTORY.asAt;
    const start = last ? Number(last.balance) : a.balance;
    const debited = typeof Funding !== 'undefined' ? Funding.debitsSince(acct, since, a.currency) : 0;
    return {
      accountNumber: acct, name: a.accountName, accountType: a.accountType, currency: a.currency, availableBalance: Math.round(Math.max(0, start - debited) * 100) / 100,
      idType: c.idType, idNumber: c.idNumber, address: c.address, phones: c.phones.slice(), emails: c.emails.slice(), source: 'Simulated CBS',
      customerNumber: c.customerNumber, customerName: c.name, customerType: c.cls, accountStatus: a.status, product: a.product, riskRating: c.risk, kycStatus: c.kyc,
      related: c.accounts.map(x => ({ accountNumber: x.accountNumber, accountName: x.accountName, accountType: x.accountType, currency: x.currency, status: x.status })),
    };
  };

  /* A customer number: the customer and its accounts. Live/Universal ask the server (cbs.url); otherwise, and in the
     prototype, the simulated directory. */
  CBS.customerLookup = async function (no) {
    const cn = String(no || '').replace(/[^0-9A-Za-z]/g, '');
    if (cn.length < 4) throw new WorkflowError('Enter the full customer number.');
    if (typeof Live !== 'undefined' && Live.api) {
      let r = {};
      try { r = await Live.api('GET', `/api/cbs/customer?no=${encodeURIComponent(cn)}`); }
      catch (e) { if (!/Unknown endpoint/.test(e.message)) throw e; }   // a server not yet restarted: use the simulation
      if (r.mode === 'cbs') {
        const x = r.customer || {}, list = Array.isArray(x.accounts) ? x.accounts : Array.isArray(x.relatedAccounts) ? x.relatedAccounts : [];
        return { customerNumber: String(x.customerNumber || cn), name: x.name || x.customerName || '', cls: x.customerClass || x.customerType || '', source: 'CBS',
          accounts: list.map(a => (typeof a === 'string' ? { accountNumber: a } : a)).map(a => ({ accountNumber: Engine.normAccount(a.accountNumber), accountName: a.accountName || a.name || '',
            accountType: a.accountType || '', currency: a.currency || '', status: String(a.status || a.accountStatus || '').toUpperCase() })).filter(a => a.accountNumber) };
      }
    }
    const c = Customers.customer(cn);
    if (!c) throw new WorkflowError(`Customer ${cn} was not found in the core banking system (simulated). Check the number, or enter the account number.`);
    return { customerNumber: c.customerNumber, name: c.name, cls: c.cls, source: 'Simulated CBS',
      accounts: c.accounts.map(a => ({ accountNumber: a.accountNumber, accountName: a.accountName, accountType: a.accountType, currency: a.currency, status: a.status })) };
  };

  /* The bank's CBS answer (or the simulator's): the customer fields next to the account fields. */
  const baseNormalise = CBS.normalise.bind(CBS);
  CBS.normalise = function (r, no) {
    const rec = baseNormalise(r, no);
    const rel = Array.isArray(r.relatedAccounts) ? r.relatedAccounts : Array.isArray(r.customerAccounts) ? r.customerAccounts : [];
    return Object.assign(rec, {
      name: r.accountName || rec.name,
      customerNumber: String(r.customerNumber ?? r.cif ?? r.customerId ?? '').trim(), customerName: r.customerName || '', customerType: r.customerClass || r.customerType || '',
      accountStatus: String(r.accountStatus || r.status || '').toUpperCase(), product: r.product || '', riskRating: r.riskRating || '', kycStatus: r.kycStatus || '',
      related: rel.map(x => (typeof x === 'string' ? { accountNumber: x } : x)).map(x => ({ accountNumber: Engine.normAccount(x.accountNumber), accountName: x.accountName || x.name || '',
        accountType: x.accountType || '', currency: x.currency || '', status: String(x.status || x.accountStatus || '').toUpperCase() })).filter(x => x.accountNumber),
    });
  };

  const baseApply = CBS.apply.bind(CBS);
  CBS.apply = function (app, rec) {
    baseApply(app, rec);
    Object.assign(app.customer.cbs, {
      customerNumber: rec.customerNumber || '', customerName: rec.customerName || '', customerType: rec.customerType || '', accountStatus: rec.accountStatus || '',
      product: rec.product || '', riskRating: rec.riskRating || '', kycStatus: rec.kycStatus || '', related: rec.related || [],
    });
  };

  /* Application page: the customer number and name under the account. */
  const baseDetail = Views.detail.bind(Views);
  Views.detail = function (id) {
    baseDetail(id);
    const app = Store.app(id), c = app?.customer, cn = c && Engine.customerNo(c);
    if (!cn) return;
    const dt = [...document.querySelectorAll('#view dl.kv dt')].find(x => x.textContent === 'Account');
    if (!dt) return;
    const others = (c.cbs.related || []).filter(x => Engine.normAccount(x.accountNumber) !== Engine.normAccount(c.account));
    dt.nextElementSibling.insertAdjacentHTML('afterend', `<dt>Customer number</dt><dd><span class="mono">${U.esc(cn)}</span> · ${U.esc(c.cbs.customerName || c.name)}${others.length ? `<br><small>${others.length} other account(s) under this customer number</small>` : ''}</dd>`);
  };
})();
