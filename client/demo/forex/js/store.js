'use strict';

/* Persistent state (localStorage, or IndexedDB once it is too large for that) + demo seed data.
   In the Spring Boot version every top-level collection here becomes a table. */
/* Prototype only: password given to the seeded demo users (hashed on first load). Never used for admin-created users. */
const DEMO_PASSWORD = 'Demo@2026';

/* Demo users. Authorisers sit in a branch and can only authorise that branch's applications. */
const SEED_USERS = [
  { id: 'u_grace',   name: 'Grace Banda',          role: 'INPUTTER',   branchId: 'br_bt',  email: 'grace.banda@demobank.example',     active: true },
  { id: 'u_james',   name: 'James Mwale',          role: 'AUTHORISER', branchId: 'br_bt',  email: 'james.mwale@demobank.example',     active: true },
  { id: 'u_thandi',  name: 'Thandiwe Nkhoma',      role: 'TREASURY',   branchId: 'br_ho',  email: 'thandiwe.nkhoma@demobank.example', active: true },
  { id: 'u_mphatso', name: 'Mphatso Gondwe',       role: 'EC',         branchId: 'br_ho',  email: 'mphatso.gondwe@demobank.example',  active: true },
  { id: 'u_admin',   name: 'System Administrator', role: 'ADMIN',      branchId: 'br_ho',  email: 'it.admin@demobank.example',        active: true },
  // A second administrator: an administrator's password can only be reset by another administrator.
  { id: 'u_admin2',  name: 'Backup Administrator', role: 'ADMIN',      branchId: 'br_ho',  email: 'it.admin2@demobank.example',       active: true },
];

const Store = {
  KEY: 'cbm-forex-state-v2',
  state: null,
  suspended: false,   // true while the test-data generator builds data in memory

  /* localStorage holds about 5 million characters. Larger data (such as the test data) moves to IndexedDB. */
  BIG_FLAG: 'cbm-forex-state-big',
  BIG_AT: 4000000,
  big: null,
  bigConn: null,
  bigTimer: null,
  bigDb() {
    if (!this.bigConn) this.bigConn = new Promise((res, rej) => { const r = indexedDB.open('cbm-forex-state', 1); r.onupgradeneeded = () => r.result.createObjectStore('state'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return this.bigConn;
  },
  async bigTx(fn) {
    const db = await this.bigDb();
    return new Promise((res, rej) => {
      const tx = db.transaction('state', 'readwrite'), req = fn(tx.objectStore('state'));
      tx.oncomplete = () => res(req.result);
      tx.onerror = tx.onabort = () => rej(tx.error);
    });
  },
  /* Reads the large copy, if there is one, before load(). */
  async open() {
    window.addEventListener('pagehide', () => { if (this.bigTimer) this.flushBig(); });
    try { if (localStorage.getItem(this.BIG_FLAG)) this.big = await this.bigTx(st => st.get('current')); } catch (e) { console.error(e); }
  },
  saveFailed(e) {
    console.error(e);
    if (window.UI) UI.toast('Could not save to browser storage (storage full or blocked).', 'error');
  },
  /* The flag is set only once IndexedDB holds the data, so nothing is lost if that fails. */
  writeBig(json) {
    this.bigTx(st => st.put(json, 'current')).then(() => { localStorage.setItem(this.BIG_FLAG, '1'); localStorage.removeItem(this.KEY); }).catch(e => this.saveFailed(e));
  },
  flushBig() {
    clearTimeout(this.bigTimer);
    this.bigTimer = null;
    try {
      const json = JSON.stringify(this.state);
      if (json.length >= this.BIG_AT) { this.writeBig(json); return; }
      localStorage.setItem(this.KEY, json);
      localStorage.removeItem(this.BIG_FLAG);
      this.bigTx(st => st.delete('current')).catch(e => console.error(e));
    } catch (e) { this.saveFailed(e); }
  },

  load() {
    try {
      const raw = this.big || localStorage.getItem(this.KEY);
      this.big = null;
      this.state = raw ? JSON.parse(raw) : Seed.build();
    } catch (e) {
      console.error(e);
      this.state = Seed.build();
    }
    // Fill in anything added to the defaults since the data was saved.
    const s = this.state;
    s.templates = Object.assign(U.clone(DEFAULT_TEMPLATES), s.templates || {});
    s.settings = Object.assign(U.clone(DEFAULT_SETTINGS), s.settings || {});
    s.settings.rates = Object.assign(U.clone(DEFAULT_SETTINGS.rates), s.settings.rates || {});
    s.bank = Object.assign(U.clone(DEFAULT_EMAIL_SENDER), s.bank || {});
    DEFAULT_BRANCHES.forEach(def => {
      const b = s.branches.find(x => x.id === def.id);
      if (!b) s.branches.push(U.clone(def));
      else if (LEGACY_BRANCH_NAMES[b.id] === b.name) Object.assign(b, U.clone(def));
      else if (LEGACY_BRANCH_CODES[b.id] === b.code) b.code = def.code;
    });
    s.branches.sort((a, b) => String(a.code).localeCompare(String(b.code)));
    // Demo users added since the data was saved; the sample authoriser moved from Head Office to Blantyre.
    SEED_USERS.forEach(def => { if (!s.users.some(u => u.id === def.id)) s.users.push(U.clone(def)); });
    const james = s.users.find(u => u.id === 'u_james');
    if (james && james.branchId === 'br_ho') james.branchId = 'br_bt';
    this.save();
  },

  save() {
    if (this.suspended) return;
    let json = null;
    try {
      // Large data is written shortly afterwards, so several changes in one action are written once.
      if (localStorage.getItem(this.BIG_FLAG)) { if (!this.bigTimer) this.bigTimer = setTimeout(() => this.flushBig(), 200); return; }
      json = JSON.stringify(this.state);
      if (json.length >= this.BIG_AT) this.writeBig(json);
      else localStorage.setItem(this.KEY, json);
    } catch (e) {
      if (json) this.writeBig(json); else this.saveFailed(e);
    }
  },

  async reset() {
    this.state = Seed.build();
    await FileStore.clear();
    await Auth.init();
    this.save();
  },

  now() { return new Date(this.state.clock); },
  /* The signed-in user, or null when nobody is signed in (or the account was deactivated). */
  user() { return this.state.users.find(u => u.id === this.state.currentUserId && u.active !== false) || null; },
  userById(id) { return this.state.users.find(u => u.id === id); },
  branch(id) { return this.state.branches.find(b => b.id === id); },
  app(id) { return this.state.apps.find(a => a.id === id); },

  audit(action, app, details = '', changes = null, actor = null) {
    const u = actor || this.user() || SYSTEM_ACTOR;
    this.state.audit.push({
      id: U.uid('aud'),
      at: this.now().toISOString(),
      userId: u.id,
      userName: u.name,
      role: u.role,
      action,
      appId: app ? app.id : null,
      ref: app ? app.ref : null,
      details,
      changes,
    });
  },
};

const SYSTEM_ACTOR = { id: 'system', name: 'System (scheduler)', role: 'SYSTEM' };

const Seed = {
  build() {
    const now = new Date();
    now.setSeconds(0, 0);
    if (now.getHours() < 8) now.setHours(9, 0);
    const at = (daysAgo, h = 10, m = 0) => { const d = U.addDays(now, -daysAgo); d.setHours(h, m, 0, 0); return d.toISOString(); };
    const day = (offset) => U.dayKey(U.addDays(now, offset));

    const branches = U.clone(DEFAULT_BRANCHES);
    const users = U.clone(SEED_USERS);
    const bank = {
      name: 'Demo Bank', country: 'Malawi', address: 'Head Office, Lilongwe, Malawi',
      phone: '+265 1 000 000', email: 'forex@demobank.example', swift: 'XXXXMWMW',
    };
    const correspondents = [
      { id: 'cb_1', name: 'Correspondent Bank A', swift: 'CORRUS33', currencies: 'USD' },
      { id: 'cb_2', name: 'Correspondent Bank B', swift: 'CORRGB2L', currencies: 'GBP, EUR' },
      { id: 'cb_3', name: 'Correspondent Bank C', swift: 'CORRZAJJ', currencies: 'ZAR' },
    ];

    const S = {
      version: 1,
      clock: now.toISOString(),
      schedulerLastRun: now.toISOString(),
      currentUserId: null,
      authVersion: 1,
      resetTokens: [],
      seq: 0,
      bank, branches, users, correspondents,
      templates: U.clone(DEFAULT_TEMPLATES),
      settings: U.clone(DEFAULT_SETTINGS),
      apps: [], audit: [], outbox: [],
    };

    const actor = id => users.find(u => u.id === id);
    const log = (app, when, userId, action, details = '') => {
      const u = actor(userId);
      S.audit.push({ id: U.uid('aud'), at: when, userId: u.id, userName: u.name, role: u.role, action, appId: app.id, ref: app.ref, details, changes: null });
    };
    const comment = (app, when, userId, kind, text) => {
      const u = actor(userId);
      app.comments.push({ id: U.uid('cm'), at: when, userId: u.id, userName: u.name, role: u.role, kind, text });
    };
    const doc = (code, name, when, by) => ({ id: U.uid('doc'), code, name, size: 184000, mime: 'application/pdf', uploadedAt: when, uploadedBy: by, sample: true });

    const mk = (o) => {
      S.seq += 1;
      const created = o.createdAt;
      const app = Object.assign({
        id: U.uid('app'),
        ref: `FX${new Date(created).getFullYear()}-${String(S.seq).padStart(5, '0')}`,
        status: 'DRAFT',
        createdAt: created, updatedAt: created,
        documents: [], comments: [], allocations: [], payments: [],
        ec: null, assignment: null, recon: null, sent: {},
        details: {}, beneficiary: {},
      }, o);
      app.updatedBy = app.createdBy;
      S.apps.push(app);
      log(app, created, app.createdBy, 'CREATED', 'Application captured');
      return app;
    };

    // 1. Pending authorisation – open account import
    const a1 = mk({
      createdAt: at(0, 9, 10), createdBy: 'u_grace', branchId: 'br_bt', status: 'PENDING_AUTH',
      customer: { name: 'Shire Hardware Ltd', account: '0031002456', accountType: 'LCY', address: 'Ginnery Corner, Blantyre', email: 'accounts@shirehardware.test', phone: '+265 999 120 330' },
      type: 'OPEN_ACCOUNT', balance: 520000000, balanceCurrency: 'MWK', amount: 450000, currency: 'ZAR',
      beneficiary: { name: 'Gauteng Steel Supplies (Pty) Ltd', address: 'Germiston, Johannesburg', country: 'South Africa', product: 'Roofing sheets and steel bars' },
      details: { invoiceNumber: 'INV-88213' },
    });
    a1.documents.push(doc('INVOICE', 'Invoice_INV-88213.pdf', a1.createdAt, 'u_grace'));
    a1.submittedAt = at(0, 9, 25);
    log(a1, a1.submittedAt, 'u_grace', 'SUBMITTED', 'Submitted for authorisation');

    // 2. Awaiting allocation – cash travel (drives weekly/daily travel notices)
    const a2 = mk({
      createdAt: at(8, 11), createdBy: 'u_grace', branchId: 'br_bt', status: 'AWAITING_ALLOCATION',
      customer: { name: 'Ruth Chisale', account: '0021007781', accountType: 'LCY', address: 'Area 47, Lilongwe', email: 'ruth.chisale@mail.test', phone: '+265 888 410 221' },
      type: 'CASH', balance: 6100000, balanceCurrency: 'MWK', amount: 2500, currency: 'USD',
      beneficiary: { name: 'Ruth Chisale', address: 'Area 47, Lilongwe', country: 'United Arab Emirates', product: 'Business travel allowance' },
      details: { travellerName: 'Ruth Chisale', passportNumber: 'MA1234567', travelDate: day(9), returnDate: day(13) },
    });
    a2.documents.push(doc('PASSPORT', 'Passport_Ruth_Chisale.pdf', a2.createdAt, 'u_grace'));
    a2.submittedAt = at(8, 11, 30); a2.authorisedAt = at(6, 14); a2.authorisedBy = 'u_james';
    log(a2, a2.submittedAt, 'u_grace', 'SUBMITTED', 'Submitted for authorisation');
    log(a2, a2.authorisedAt, 'u_james', 'AUTHORISED', 'Authorised');
    comment(a2, a2.authorisedAt, 'u_james', 'Authorised', 'Documents in order. 5 days x USD 500 = USD 2,500.');

    // 3. Allocated, awaiting funding by 16:00 today – student fees
    const a3 = mk({
      createdAt: at(5, 10), createdBy: 'u_grace', branchId: 'br_bt', status: 'ALLOCATED',
      customer: { name: 'Peter Kaunda', account: '0031009910', accountType: 'LCY', address: 'Namiwawa, Blantyre', email: 'pkaunda@mail.test', phone: '+265 991 000 448' },
      type: 'STUDENT_FEES', balance: 9800000, balanceCurrency: 'MWK', amount: 8200, currency: 'GBP',
      beneficiary: { name: 'University of Leeds', address: 'Woodhouse, Leeds LS2 9JT', country: 'United Kingdom', product: 'Tuition fees 2026/27 – Grace Kaunda' },
      details: { studentName: 'Grace Kaunda', visaExpiry: day(420), studyStart: day(-30), studyEnd: day(700) },
    });
    ['ADMISSION', 'FEES', 'STUDENT_PASSPORT', 'VISA'].forEach(c => a3.documents.push(doc(c, `${DOC_TYPES[c].split(' (')[0].replace(/\W+/g, '_')}.pdf`, a3.createdAt, 'u_grace')));
    a3.submittedAt = at(5, 10, 40); a3.authorisedAt = at(4, 9); a3.authorisedBy = 'u_james';
    a3.ec = { recommendation: 'Recommended', note: 'Genuine education payment; visa valid beyond study start.', by: 'u_mphatso', at: at(3, 15) };
    const deadline3 = new Date(now); deadline3.setHours(16, 0, 0, 0);
    if (deadline3 <= now) deadline3.setTime(U.addDays(deadline3, 1).getTime());
    a3.allocations.push({ id: U.uid('al'), amount: 8200, rate: 2240.5, crossRate: 1.2795, valueDate: day(0), note: '', at: at(0, 8, 45), by: 'u_thandi', deadline: deadline3.toISOString(), status: 'AWAITING_FUNDING', paid: 0 });
    log(a3, a3.submittedAt, 'u_grace', 'SUBMITTED', 'Submitted for authorisation');
    log(a3, a3.authorisedAt, 'u_james', 'AUTHORISED', 'Authorised');
    log(a3, a3.ec.at, 'u_mphatso', 'EC_RECOMMENDATION', 'Recommended');
    log(a3, at(0, 8, 45), 'u_thandi', 'ALLOCATED', 'GBP 8,200.00 at 2,240.50');

    // 4. Advance payment, fully paid ~78 days ago – reconciliation due soon
    const a4 = mk({
      createdAt: at(82, 9), createdBy: 'u_grace', branchId: 'br_bt', status: 'CLOSED',
      customer: { name: 'Nkhata Bay Agro Traders', account: '0041000237', accountType: 'FCY', address: 'Katoto, Mzuzu', email: 'info@nbagro.test', phone: '+265 997 333 120' },
      type: 'ADVANCE', balance: 64000, balanceCurrency: 'USD', amount: 48000, currency: 'USD',
      beneficiary: { name: 'Shandong Agri Machinery Co.', address: 'Jinan, Shandong', country: 'China', product: 'Maize sheller machines (advance 40%)' },
      details: { invoiceNumber: 'PI-2026-0441' },
    });
    a4.documents.push(doc('INVOICE', 'Proforma_PI-2026-0441.pdf', a4.createdAt, 'u_grace'));
    a4.submittedAt = at(82, 10); a4.authorisedAt = at(81, 9); a4.authorisedBy = 'u_james';
    a4.ec = { recommendation: 'Recommended', note: 'Advance for capital goods; reconcile within 90 days.', by: 'u_mphatso', at: at(81, 11) };
    a4.allocations.push({ id: U.uid('al'), amount: 48000, rate: 1751, crossRate: null, valueDate: day(-79), note: 'Funded from FCY account – rate for MWK reporting only', at: at(79, 9), by: 'u_thandi', deadline: at(79, 16), status: 'FUNDED', fundedAt: at(79, 10), paid: 48000 });
    a4.payments.push({ id: U.uid('pay'), amount: 48000, rate: 1751, mwk: 48000 * 1751, reference: 'MT103-41877', correspondentId: 'cb_1', valueDate: day(-78), at: at(78, 11), by: 'u_mphatso', outcome: 'FULL', comment: '' });
    a4.closedAt = at(78, 11);
    a4.recon = { status: 'PENDING', dueDate: day(12) };
    log(a4, a4.submittedAt, 'u_grace', 'SUBMITTED', 'Submitted for authorisation');
    log(a4, a4.authorisedAt, 'u_james', 'AUTHORISED', 'Authorised');
    log(a4, at(79, 9), 'u_thandi', 'ALLOCATED', 'USD 48,000.00 at 1,751.0000');
    log(a4, at(78, 11), 'u_mphatso', 'PAYMENT_RECORDED', 'USD 48,000.00 – fully paid, closed');

    // 5. Partly paid freight
    const a5 = mk({
      createdAt: at(12, 9), createdBy: 'u_grace', branchId: 'br_bt', status: 'PARTLY_PAID',
      customer: { name: 'Lakeshore Logistics Ltd', account: '0031005512', accountType: 'LCY', address: 'Chichiri, Blantyre', email: '', phone: '+265 884 551 200' },
      type: 'FREIGHT', balance: 30500000, balanceCurrency: 'MWK', amount: 12000, currency: 'USD',
      beneficiary: { name: 'Indian Ocean Shipping Agencies', address: 'Port of Beira', country: 'Mozambique', product: 'Sea freight – containers MSKU771, MSKU772' },
      details: { invoiceNumber: 'FRT-55120' },
    });
    a5.documents.push(doc('INVOICE', 'Freight_Invoice_FRT-55120.pdf', a5.createdAt, 'u_grace'));
    a5.submittedAt = at(12, 9, 30); a5.authorisedAt = at(11, 10); a5.authorisedBy = 'u_james';
    a5.ec = { recommendation: 'Recommended', note: '', by: 'u_mphatso', at: at(10, 9) };
    a5.assignment = { kind: 'BRANCH', branchId: 'br_bt', userId: null, by: 'u_mphatso', at: at(9, 9), note: 'Branch to process' };
    a5.allocations.push({ id: U.uid('al'), amount: 7000, rate: 1758.2, crossRate: null, valueDate: day(-9), note: 'Partial allocation', at: at(9, 9, 30), by: 'u_thandi', deadline: at(9, 16), status: 'FUNDED', fundedAt: at(9, 13), paid: 7000 });
    a5.payments.push({ id: U.uid('pay'), amount: 7000, rate: 1758.2, mwk: 7000 * 1758.2, reference: 'MT103-41990', correspondentId: 'cb_1', valueDate: day(-8), at: at(8, 10), by: 'u_mphatso', outcome: 'PART', comment: 'Balance of USD 5,000 required.' });
    log(a5, a5.submittedAt, 'u_grace', 'SUBMITTED', 'Submitted for authorisation');
    log(a5, a5.authorisedAt, 'u_james', 'AUTHORISED', 'Authorised');
    log(a5, at(9, 9, 30), 'u_thandi', 'ALLOCATED', 'USD 7,000.00 at 1,758.20');
    log(a5, at(8, 10), 'u_mphatso', 'PAYMENT_RECORDED', 'USD 7,000.00 – partly paid, balance USD 5,000.00');

    // 6. Returned to inputter – gift
    const a6 = mk({
      createdAt: at(2, 13), createdBy: 'u_grace', branchId: 'br_bt', status: 'RETURNED',
      customer: { name: 'Esther Mvula', account: '0031008830', accountType: 'LCY', address: 'Sunnyside, Blantyre', email: 'esther.mvula@mail.test', phone: '+265 995 776 010' },
      type: 'GIFTS', balance: 3200000, balanceCurrency: 'MWK', amount: 600, currency: 'GBP',
      beneficiary: { name: 'Daniel Mvula', address: '12 Park Road, Manchester', country: 'United Kingdom', product: 'Wedding gift', relationship: '' },
      details: {},
    });
    a6.submittedAt = at(2, 13, 30);
    log(a6, a6.submittedAt, 'u_grace', 'SUBMITTED', 'Submitted for authorisation');
    log(a6, at(1, 10), 'u_james', 'RETURNED', 'Returned to inputter');
    comment(a6, at(1, 10), 'u_james', 'Returned', 'Please capture the relationship to the beneficiary and attach a copy of the beneficiary ID.');

    // 7. Draft – maintenance
    mk({
      createdAt: at(0, 8, 30), createdBy: 'u_grace', branchId: 'br_bt', status: 'DRAFT',
      customer: { name: 'Alinafe Tembo', account: '0031004401', accountType: 'LCY', address: 'Mandala, Blantyre', email: '', phone: '+265 999 801 007' },
      type: 'MAINTENANCE', balance: 2500000, balanceCurrency: 'MWK', amount: 900, currency: 'USD',
      beneficiary: { name: '', address: '', country: 'India', product: 'Student maintenance – rent' },
      details: { maintenanceFor: 'STUDENT', studentName: 'Kumbukani Tembo' },
    });

    // 8. Earlier travel application by Ruth Chisale (see no. 2), captured at another branch – shows cross-branch client history.
    const a8 = mk({
      createdAt: at(120, 10), createdBy: 'u_grace', branchId: 'br_bt', status: 'CLOSED',
      customer: { name: 'Ruth Chisale', account: '0021007781', accountType: 'LCY', address: 'Area 47, Lilongwe', email: 'ruth.chisale@mail.test', phone: '+265 888 410 221' },
      type: 'CASH_PASSPORT', balance: 4200000, balanceCurrency: 'MWK', amount: 1500, currency: 'USD',
      beneficiary: { name: 'Ruth Chisale', address: 'Area 47, Lilongwe', country: 'South Africa', product: 'Business travel allowance' },
      details: { travellerName: 'Ruth Chisale', passportNumber: 'MA1234567', travelDate: day(-105), returnDate: day(-103) },
    });
    a8.documents.push(doc('PASSPORT', 'Passport_Ruth_Chisale.pdf', a8.createdAt, 'u_grace'));
    a8.submittedAt = at(120, 10, 30); a8.authorisedAt = at(119, 9); a8.authorisedBy = 'u_james';
    a8.ec = { recommendation: 'Recommended', note: '', by: 'u_mphatso', at: at(118, 9) };
    a8.allocations.push({ id: U.uid('al'), amount: 1500, rate: 1748.5, crossRate: null, valueDate: day(-110), note: '', at: at(110, 9), by: 'u_thandi', deadline: at(110, 16), status: 'FUNDED', fundedAt: at(110, 11), paid: 1500 });
    a8.payments.push({ id: U.uid('pay'), amount: 1500, rate: 1748.5, mwk: 1500 * 1748.5, reference: 'CP-LOAD-22071', correspondentId: null, valueDate: day(-110), at: at(110, 14), by: 'u_grace', outcome: 'FULL', comment: 'Cash passport loaded at branch' });
    a8.closedAt = at(110, 14);
    log(a8, a8.submittedAt, 'u_grace', 'SUBMITTED', 'Submitted for authorisation');
    log(a8, a8.authorisedAt, 'u_james', 'AUTHORISED', 'Authorised');
    log(a8, at(110, 9), 'u_thandi', 'ALLOCATED', 'USD 1,500.00 at 1,748.5000');
    log(a8, at(110, 14), 'u_grace', 'PAYMENT_RECORDED', 'USD 1,500.00 – fully paid at branch, closed');

    // 9. Overdue unreconciled advance payment for Shire Hardware – the client of no. 1, now pending authorisation.
    const a9 = mk({
      createdAt: at(104, 9), createdBy: 'u_grace', branchId: 'br_bt', status: 'CLOSED',
      customer: { name: 'Shire Hardware Ltd', account: '0031002456', accountType: 'LCY', address: 'Ginnery Corner, Blantyre', email: 'accounts@shirehardware.test', phone: '+265 999 120 330' },
      type: 'ADVANCE', balance: 610000000, balanceCurrency: 'MWK', amount: 22000, currency: 'USD',
      beneficiary: { name: 'Foshan Building Materials Co.', address: 'Foshan, Guangdong', country: 'China', product: 'Floor tiles (advance 30%)' },
      details: { invoiceNumber: 'PI-FS-7781' },
    });
    a9.documents.push(doc('INVOICE', 'Proforma_PI-FS-7781.pdf', a9.createdAt, 'u_grace'));
    a9.submittedAt = at(104, 10); a9.authorisedAt = at(103, 9); a9.authorisedBy = 'u_james';
    a9.ec = { recommendation: 'Recommended', note: 'Reconcile within 90 days.', by: 'u_mphatso', at: at(103, 11) };
    a9.allocations.push({ id: U.uid('al'), amount: 22000, rate: 1749.8, crossRate: null, valueDate: day(-101), note: '', at: at(101, 9), by: 'u_thandi', deadline: at(101, 16), status: 'FUNDED', fundedAt: at(101, 11), paid: 22000 });
    a9.payments.push({ id: U.uid('pay'), amount: 22000, rate: 1749.8, mwk: 22000 * 1749.8, reference: 'MT103-40562', correspondentId: 'cb_1', valueDate: day(-100), at: at(100, 11), by: 'u_mphatso', outcome: 'FULL', comment: '' });
    a9.closedAt = at(100, 11);
    a9.recon = { status: 'PENDING', dueDate: day(-10) };
    log(a9, a9.submittedAt, 'u_grace', 'SUBMITTED', 'Submitted for authorisation');
    log(a9, a9.authorisedAt, 'u_james', 'AUTHORISED', 'Authorised');
    log(a9, at(101, 9), 'u_thandi', 'ALLOCATED', 'USD 22,000.00 at 1,749.8000');
    log(a9, at(100, 11), 'u_mphatso', 'PAYMENT_RECORDED', 'USD 22,000.00 – fully paid, closed');

    // 10–15. Advance payments at each stage of the reconciliation workflow (js/recon.js).
    const adv = (o) => {
      const d = o.paidDays, cust = o.customer;
      const a = mk({
        createdAt: at(d + 4, 9), createdBy: o.inputter, branchId: o.branchId, status: 'CLOSED', customer: cust,
        type: 'ADVANCE', balance: o.balance, balanceCurrency: 'MWK', amount: o.amount, currency: 'USD', beneficiary: o.beneficiary,
        details: { invoiceNumber: o.invoice, invoiceDate: day(-(d + 12)), invoiceAmount: o.invoiceAmount },
      });
      a.documents.push(doc('INVOICE', `Proforma_${o.invoice}.pdf`, a.createdAt, o.inputter));
      a.submittedAt = at(d + 4, 10); a.authorisedAt = at(d + 3, 9); a.authorisedBy = o.authoriser;
      a.ec = { recommendation: 'Recommended', note: 'Reconcile within 90 days.', by: 'u_mphatso', at: at(d + 3, 11) };
      a.allocations.push({ id: U.uid('al'), amount: o.amount, rate: o.rate, crossRate: null, valueDate: day(-(d + 1)), note: '', at: at(d + 1, 9), by: 'u_thandi', deadline: at(d + 1, 16), status: 'FUNDED', fundedAt: at(d + 1, 11), paid: o.amount });
      a.payments.push({ id: U.uid('pay'), amount: o.amount, rate: o.rate, mwk: o.amount * o.rate, reference: o.swift, correspondentId: 'cb_1', valueDate: day(-d), at: at(d, 11), by: 'u_mphatso', outcome: 'FULL', comment: '' });
      a.closedAt = at(d, 11);
      a.recon = { status: 'PENDING', dueDate: day(90 - d), documents: [], history: [] };
      log(a, a.submittedAt, o.inputter, 'SUBMITTED', 'Submitted for authorisation');
      log(a, a.authorisedAt, o.authoriser, 'AUTHORISED', 'Authorised');
      log(a, at(d + 1, 9), 'u_thandi', 'ALLOCATED', `USD ${U.num(o.amount)} at ${U.num(o.rate, 4)}`);
      log(a, at(d, 11), 'u_mphatso', 'PAYMENT_RECORDED', `USD ${U.num(o.amount)} – fully paid, closed`);
      return a;
    };
    // One step of the reconciliation: history entry, audit entry and the status it leaves.
    const rstep = (a, when, userId, status, action, comment = '', audit = null, extra = {}) => {
      const u = actor(userId);
      a.recon.history.push({ at: when, by: u.id, name: u.name, role: u.role, action, comment });
      Object.assign(a.recon, { status }, extra);
      if (audit) log(a, when, userId, audit[0], audit[1]);
    };
    const rdocs = (a, when, by, transport = true) => {
      a.recon.documents.push(doc('RECON_CUSTOMS', `Bill_of_entry_${a.details.invoiceNumber}.pdf`, when, by), doc('RECON_INVOICE', `Final_invoice_${a.details.invoiceNumber}.pdf`, when, by));
      if (transport) a.recon.documents.push(doc('RECON_TRANSPORT', `Bill_of_lading_${a.details.invoiceNumber}.pdf`, when, by));
    };
    const submit = (a, daysAgo, userId, branchId, comment = '') => {
      rdocs(a, at(daysAgo, 9, 30), userId);
      rstep(a, at(daysAgo, 10), userId, 'SUBMITTED', 'Submitted for review', comment, ['RECON_SUBMITTED', `Reconciliation documents submitted (${a.recon.documents.length} document(s)) to the authorisers of ${(branches.find(b => b.id === branchId) || { name: branchId }).name}`],
        { branchId, submittedAt: at(daysAgo, 10), submittedBy: userId });
    };
    const authorise = (a, daysAgo, userId) => rstep(a, at(daysAgo, 14), userId, 'REVIEW', 'Authorised – sent to Exchange Control', '', ['RECON_AUTHORISED', 'Reconciliation documents authorised and sent to Exchange Control'], { reviewedAt: at(daysAgo, 14), reviewedBy: userId });
    const reconcile = (a, daysAgo, comment) => {
      rstep(a, at(daysAgo, 11), 'u_mphatso', 'RECONCILED', 'Reconciled and closed', comment, ['RECONCILED', 'Advance payment reconciled and closed by Exchange Control'], { reconciledAt: at(daysAgo, 11), by: 'u_mphatso' });
      a.recon.documents.forEach(x => a.documents.push(x));
      comment && (() => { const u = actor('u_mphatso'); a.comments.push({ id: U.uid('cm'), at: at(daysAgo, 11), userId: u.id, userName: u.name, role: u.role, kind: 'Reconciled', text: comment }); })();
    };

    // 10. With the authoriser – Lilongwe client, documents submitted yesterday.
    const a10 = adv({ paidDays: 46, branchId: 'br_bt', inputter: 'u_grace', authoriser: 'u_james', amount: 35000, rate: 1752.4, balance: 70000000, swift: 'MT103-42210', invoice: 'PI-LL-3302', invoiceAmount: 87500,
      customer: { name: 'Kanengo Grain Millers Ltd', account: '0021004410', accountType: 'LCY', address: 'Kanengo Industrial Area, Lilongwe', email: 'finance@kanengomillers.test', phone: '+265 999 404 118', idType: 'CERT_INCORPORATION', idNumber: 'COMP-2009-1180' },
      beneficiary: { name: 'Bühler Industrial (Wuxi) Co.', address: 'Wuxi, Jiangsu', country: 'China', product: 'Roller mill spare parts (advance 40%)' } });
    submit(a10, 1, 'u_grace', 'br_bt', 'Client brought the bill of entry and final invoice.');

    // 11. With Exchange Control – Blantyre client, authorised two days ago.
    const a11 = adv({ paidDays: 74, branchId: 'br_bt', inputter: 'u_grace', authoriser: 'u_james', amount: 18500, rate: 1754.9, balance: 41000000, swift: 'MT103-41622', invoice: 'PI-BT-9054', invoiceAmount: 18500,
      customer: { name: 'Chichiri Pharmacy Ltd', account: '0031006620', accountType: 'LCY', address: 'Chichiri, Blantyre', email: 'orders@chichiripharm.test', phone: '+265 888 662 004', idType: 'CERT_INCORPORATION', idNumber: 'COMP-2017-2265' },
      beneficiary: { name: 'Mumbai Generics Pvt Ltd', address: 'Andheri East, Mumbai', country: 'India', product: 'Pharmaceutical supplies (full advance)' } });
    submit(a11, 3, 'u_grace', 'br_bt');
    authorise(a11, 2, 'u_james');

    // 12. Returned to the inputter – the authoriser wants a certified bill of entry.
    const a12 = adv({ paidDays: 63, branchId: 'br_bt', inputter: 'u_grace', authoriser: 'u_james', amount: 9800, rate: 1753.1, balance: 19500000, swift: 'MT103-41760', invoice: 'PI-MZ-1172', invoiceAmount: 24500,
      customer: { name: 'Viphya Timber Products', account: '0041003391', accountType: 'LCY', address: 'Chibavi, Mzuzu', email: 'viphyatimber@mail.test', phone: '+265 995 339 100', idType: 'BUSINESS_REG', idNumber: 'BRN-MZ-31877' },
      beneficiary: { name: 'Durban Saw Equipment (Pty) Ltd', address: 'Pinetown, Durban', country: 'South Africa', product: 'Sawmill blades (advance 40%)' } });
    submit(a12, 6, 'u_grace', 'br_bt');
    rstep(a12, at(5, 15), 'u_james', 'RETURNED', 'Rejected by authoriser – returned to inputter', 'The bill of entry is a photocopy. Please obtain a copy certified by MRA.', ['RECON_RETURNED', 'Reconciliation returned to inputter: The bill of entry is a photocopy. Please obtain a copy certified by MRA.']);

    // 13. Declined by Exchange Control and the client alerted – Lilongwe client whose documents were brought to Blantyre (overdue).
    const a13 = adv({ paidDays: 97, branchId: 'br_bt', inputter: 'u_grace', authoriser: 'u_james', amount: 27000, rate: 1750.2, balance: 52000000, swift: 'MT103-40488', invoice: 'PI-LL-2871', invoiceAmount: 27000,
      customer: { name: 'Area 25 Auto Spares', account: '0021008856', accountType: 'LCY', address: 'Area 25, Lilongwe', email: 'area25spares@mail.test', phone: '+265 884 885 600', idType: 'BUSINESS_REG', idNumber: 'BRN-LL-44120' },
      beneficiary: { name: 'Dubai Auto Parts Trading LLC', address: 'Deira, Dubai', country: 'United Arab Emirates', product: 'Vehicle spare parts (full advance)' } });
    submit(a13, 12, 'u_grace', 'br_bt');
    authorise(a13, 11, 'u_james');
    rstep(a13, at(9, 10), 'u_mphatso', 'DECLINED', 'Declined by Exchange Control', 'The customs entry value (USD 19,400) does not match the amount paid (USD 27,000). The client must account for the difference.',
      ['RECON_DECLINED', 'Reconciliation declined by Exchange Control: customs entry value does not match the amount paid'], { declinedAt: at(9, 10), declinedBy: 'u_mphatso', declineReason: 'The customs entry value (USD 19,400) does not match the amount paid (USD 27,000). The client must account for the difference.' });
    rstep(a13, at(8, 9), 'u_grace', 'DECLINED', 'Client alerted of the decline', 'The documents are not sufficient to reconcile this payment: the customs entry value does not match the amount paid. Please bring the customs entry for the balance of the goods or proof of refund.', ['RECON_CLIENT_ALERTED', 'Client alerted that the reconciliation was declined'], { alertedAt: at(8, 9) });

    // 14. Reconciled – Blantyre client.
    const a14 = adv({ paidDays: 128, branchId: 'br_bt', inputter: 'u_grace', authoriser: 'u_james', amount: 15200, rate: 1747.6, balance: 30000000, swift: 'MT103-39815', invoice: 'PI-BT-8120', invoiceAmount: 15200,
      customer: { name: 'Limbe Printing Works', account: '0031007714', accountType: 'LCY', address: 'Limbe, Blantyre', email: 'info@limbeprint.test', phone: '+265 991 771 400', idType: 'CERT_INCORPORATION', idNumber: 'COMP-2004-0517' },
      beneficiary: { name: 'Heidelberg Graphic Supplies SA', address: 'Johannesburg', country: 'South Africa', product: 'Printing plates and ink (full advance)' } });
    submit(a14, 50, 'u_grace', 'br_bt');
    authorise(a14, 49, 'u_james');
    reconcile(a14, 47, 'Bill of entry and final invoice agree with the payment.');

    // 15. Reconciled – Mzuzu client whose documents were handled at Lilongwe.
    const a15 = adv({ paidDays: 160, branchId: 'br_bt', inputter: 'u_grace', authoriser: 'u_james', amount: 42000, rate: 1746.3, balance: 80000000, swift: 'MT103-39102', invoice: 'PI-MZ-0866', invoiceAmount: 105000,
      customer: { name: 'Northern Coffee Growers Co-op', account: '0041005588', accountType: 'LCY', address: 'Katoto, Mzuzu', email: 'coop@northerncoffee.test', phone: '+265 999 558 811', idType: 'BUSINESS_REG', idNumber: 'BRN-MZ-10233' },
      beneficiary: { name: 'Pinhalense Machinery Ltda', address: 'Espírito Santo do Pinhal', country: 'Brazil', product: 'Coffee pulping machine (advance 40%)' } });
    submit(a15, 82, 'u_grace', 'br_bt', 'Client delivered the documents at the branch.');
    authorise(a15, 81, 'u_james');
    reconcile(a15, 78, 'Documents verified – goods cleared at Mwanza border.');

    // Customer identification for the sample clients.
    const ids = {
      '0031002456': ['CERT_INCORPORATION', 'COMP-2011-4471'], '0021007781': ['NATIONAL_ID', 'RX7K2M9P'],
      '0031009910': ['NATIONAL_ID', 'PK4H8T2C'], '0041000237': ['BUSINESS_REG', 'BRN-MZ-20419'],
      '0031005512': ['CERT_INCORPORATION', 'COMP-2015-0932'], '0031008830': ['PASSPORT_MW', 'MA0883012'],
      '0031004401': ['DRIVING_LICENCE', 'DL-BT-551203'],
    };
    S.apps.forEach(a => { const x = ids[a.customer.account]; if (x) Object.assign(a.customer, { idType: x[0], idNumber: x[1] }); });

    // Customer details as fetched from the (simulated) core banking system; companies list their signatories,
    // who also receive the client alerts. The draft (no. 7) shows an account captured manually.
    if (typeof CBS !== 'undefined' && typeof Engine !== 'undefined') S.apps.forEach(a => {
      const c = a.customer, s = CBS.SAMPLE[c.account];
      if (s) {
        c.phone = s.phones[0][0];
        c.email = s.emails[0]?.[0] || c.email;
        c.contacts = [...s.phones.slice(1).map(([value, name]) => ({ kind: 'phone', value, name })), ...s.emails.slice(1).map(([value, name]) => ({ kind: 'email', value, name }))];
      }
      if (a.status === 'DRAFT') return;
      c.cbs = { account: Engine.normAccount(c.account), at: a.createdAt, source: 'Simulated CBS', name: c.name, accountType: c.accountType, currency: a.balanceCurrency,
        balance: a.balance, address: c.address, phones: Engine.clientPhones(c), emails: Engine.clientEmails(c) };
    });

    S.apps.forEach(a => {
      const last = S.audit.filter(e => e.appId === a.id).map(e => e.at).sort().pop();
      if (last) a.updatedAt = last;
    });
    return S;
  },
};
