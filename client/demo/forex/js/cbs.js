'use strict';

/* Core banking system (CBS) link and client contacts.

   When the inputter enters the account number, the account is looked up in the CBS: name, account type and
   currency, available balance, ID, address, phone numbers and email addresses are filled in. Name, account type
   and balance come only from the CBS (locked); address and contact details can be amended on the application
   (the CBS record itself is not changed). More phone numbers and email addresses can be added – e.g. directors and
   signatories of a company – and every one of them receives the client alerts, which always name the customer.

   Live / Universal: the server asks the bank's CBS (server.properties → cbs.url, see server\Cbs.java). Without a
   cbs.url, and always in the prototype, a SIMULATED CBS is used: a small directory of sample accounts plus any
   account already known to the system, with a balance derived from the account number. */

const CBS = {
  /* Simulated CBS records for the sample clients (companies with several signatories). */
  SAMPLE: {
    '0031002456': { phones: [['+265 999 120 330', 'Accounts office'], ['+265 888 120 331', 'Finance Director (signatory)']], emails: [['accounts@shirehardware.test', 'Accounts office'], ['md@shirehardware.test', 'Managing Director (signatory)']] },
    '0041000237': { phones: [['+265 997 333 120', 'Office'], ['+265 881 333 121', 'Chairperson (signatory)']], emails: [['info@nbagro.test', 'Office'], ['finance@nbagro.test', 'Treasurer (signatory)']] },
    '0031005512': { phones: [['+265 884 551 200', 'Operations'], ['+265 999 551 201', 'Director (signatory)']], emails: [['director@lakeshorelogistics.test', 'Director (signatory)']] },
    '0021004410': { phones: [['+265 999 404 118', 'Finance'], ['+265 888 404 119', 'Managing Director (signatory)']], emails: [['finance@kanengomillers.test', 'Finance'], ['md@kanengomillers.test', 'Managing Director (signatory)'], ['fd@kanengomillers.test', 'Finance Director (signatory)']] },
    '0031006620': { phones: [['+265 888 662 004', 'Orders']], emails: [['orders@chichiripharm.test', 'Orders'], ['pharmacist@chichiripharm.test', 'Superintendent pharmacist (signatory)']] },
    '5030231215012': { phones: [['+265 888 662 004', 'Orders']], emails: [['orders@chichiripharm.test', 'Orders'], ['pharmacist@chichiripharm.test', 'Superintendent pharmacist (signatory)']] },
  },

  hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; },

  /* Simulated lookup: the latest application for the account stands in for the CBS customer record. */
  simulated(no) {
    const acct = Engine.normAccount(no);
    const last = Store.state.apps.filter(a => Engine.normAccount(a.customer?.account) === acct && a.customer?.name)
      .sort((x, y) => (y.updatedAt || y.createdAt || '').localeCompare(x.updatedAt || x.createdAt || ''))[0];
    if (!last) return null;
    const c = last.customer, s = this.SAMPLE[acct] || {}, h = this.hash(acct);
    const fcy = c.accountType === 'FCY';
    const currency = fcy ? (last.balanceCurrency && last.balanceCurrency !== 'MWK' ? last.balanceCurrency : 'USD') : 'MWK';
    // The balance last seen on an application for the account, less what automatic funding has debited since;
    // an account with no usable balance gets one derived from the account number.
    const known = Number(last.balance) > 0 && last.balanceCurrency === currency;
    const since = last.balanceAt || last.customer?.cbs?.at || last.createdAt || '';   // when that balance was taken
    const balance = known ? Math.max(0, Number(last.balance) - (typeof Funding !== 'undefined' ? Funding.debitsSince(acct, since, currency) : 0))
      : fcy ? 25000 + (h % 400000) + (h % 100) / 100 : 40000000 + (h % 900000000) + (h % 100) / 100;
    const phones = s.phones ? s.phones.map(([number, name]) => ({ number, name })) : [{ number: c.phone, name: '' }, ...this.extra(c, 'phone')];
    const emails = s.emails ? s.emails.map(([address, name]) => ({ address, name })) : [...(c.email ? [{ address: c.email, name: '' }] : []), ...this.extra(c, 'email')];
    return { accountNumber: acct, name: c.name, accountType: c.accountType || 'LCY', currency, availableBalance: Math.round(balance * 100) / 100,
      idType: c.idType || '', idNumber: c.idNumber || '', address: c.address || '', phones: phones.filter(p => p.number), emails, source: 'Simulated CBS' };
  },
  extra(c, kind) { return (c.contacts || []).filter(x => x.kind === kind).map(x => (kind === 'phone' ? { number: x.value, name: x.name } : { address: x.value, name: x.name })); },

  /* Normalise a CBS answer (phones/emails may be plain strings or {number|address, name}). */
  normalise(r, no) {
    const list = (v, key) => (Array.isArray(v) ? v : v ? [v] : []).map(x => (typeof x === 'string' ? { [key]: x, name: '' } : { [key]: x[key] || x.value || '', name: x.name || x.role || '' })).filter(x => x[key]);
    return {
      accountNumber: r.accountNumber || no, name: r.name || r.accountName || '', accountType: r.accountType === 'FCY' || (r.currency && r.currency !== 'MWK') ? 'FCY' : 'LCY',
      currency: r.currency || 'MWK', availableBalance: Number(r.availableBalance ?? r.balance ?? 0), idType: r.idType || '', idNumber: r.idNumber || '',
      address: r.address || '', phones: list(r.phones || r.phone, 'number'), emails: list(r.emails || r.email, 'address'), source: 'CBS',
    };
  },

  async lookup(no) {
    const acct = Engine.normAccount(no);
    if (acct.length < 6) throw new WorkflowError('Enter the full account number.');
    if (typeof Live !== 'undefined' && Live.api) {
      let r = {};
      try { r = await Live.api('GET', `/api/cbs/account?no=${encodeURIComponent(acct)}`); }
      catch (e) { if (!/Unknown endpoint/.test(e.message)) throw e; }   // a server not yet restarted: use the simulation
      if (r.mode === 'cbs') return this.normalise(r.account, acct);
    }
    const rec = this.simulated(acct);
    if (!rec) throw new WorkflowError(`Account ${acct} was not found in the core banking system (simulated). Check the number, or capture the details manually.`);
    return rec;
  },

  /* Copy a CBS record onto the application. Name, account type and balance are locked to the CBS values. */
  apply(app, rec) {
    const c = app.customer;
    Object.assign(c, { name: rec.name, accountType: rec.accountType });
    if (rec.idType) c.idType = rec.idType;
    if (rec.idNumber) c.idNumber = rec.idNumber;
    if (rec.address) c.address = rec.address;
    if (rec.phones.length) c.phone = rec.phones[0].number;
    c.email = rec.emails[0]?.address || '';
    c.contacts = [...rec.phones.slice(1).map(p => ({ kind: 'phone', value: p.number, name: p.name })), ...rec.emails.slice(1).map(m => ({ kind: 'email', value: m.address, name: m.name }))];
    app.balance = rec.availableBalance;
    app.balanceCurrency = rec.currency;
    app.balanceAt = Store.now().toISOString();
    c.cbs = { account: Engine.normAccount(c.account), at: Store.now().toISOString(), source: rec.source, name: rec.name, accountType: rec.accountType,
      currency: rec.currency, balance: rec.availableBalance, address: rec.address, phones: rec.phones.map(p => p.number), emails: rec.emails.map(m => m.address) };
  },

  /* Is the application still on the CBS record it was filled from? */
  linked(app) { const k = app.customer?.cbs; return !!k && k.account === Engine.normAccount(app.customer.account); },

  /* Address / contacts changed on the application compared with the CBS record. */
  amended(app) {
    const c = app.customer, k = c?.cbs;
    if (!k) return [];
    const out = [];
    if ((c.address || '').trim() !== (k.address || '').trim()) out.push('address');
    const ph = Engine.clientPhones(c).join('|'), em = Engine.clientEmails(c).join('|');
    if (ph !== (k.phones || []).join('|')) out.push('phone numbers');
    if (em !== (k.emails || []).join('|')) out.push('email addresses');
    return out;
  },
};
