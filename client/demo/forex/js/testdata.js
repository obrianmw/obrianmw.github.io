'use strict';

/* UAT test data generator (before go-live on the servers; in this browser on the Test prototype).
   Creates ~40 test staff users and ~660 transactions, then plays each one through the real workflow
   (Engine actions + the reminder scheduler) on a simulated clock over the last 6 months, so every record has a
   consistent history, audit trail and notifications. About 120 of them stop on purpose at a stage that the rest
   would mostly have moved past, so every stage has work in it today. Everything is then saved.
   All test users share the UAT password below (also in the README); they are removed by "Delete all test data". */
const TestData = {
  UAT_PASSWORD: 'Uat#Forex2026',
  TARGET: 545,
  DAYS: 182,
  STAGES: ['PENDING_AUTH', 'RETURNED', 'AWAITING_ALLOCATION', 'ALLOCATED', 'FUNDED', 'PARTLY_PAID', 'CANCELLED', 'REVERSED'],
  PER_STAGE: 15,

  FIRST: ['Chikondi', 'Thoko', 'Mphatso', 'Kondwani', 'Tiyamike', 'Chisomo', 'Madalitso', 'Pemphero', 'Yamikani', 'Limbani', 'Takondwa', 'Wezi',
    'Tadala', 'Chimwemwe', 'Kettie', 'Grace', 'James', 'Peter', 'Esther', 'Ruth', 'Joseph', 'Mary', 'John', 'Agnes', 'Patrick', 'Charity',
    'Blessings', 'Innocent', 'Memory', 'Precious', 'Gift', 'Lusungu', 'Temwa', 'Mayeso', 'Dalitso', 'Fatsani', 'Edith', 'Alinafe', 'Kumbukani',
    'Thandiwe', 'Daniel', 'Ellen', 'Felix', 'Hope', 'Isaac', 'Loveness', 'Martha', 'Noel', 'Owen', 'Rose', 'Steven', 'Towera', 'Vitumbiko', 'Zione'],
  LAST: ['Banda', 'Phiri', 'Mwale', 'Nkhoma', 'Gondwe', 'Chirwa', 'Kalua', 'Mhango', 'Nyirenda', 'Tembo', 'Mvula', 'Kaunda', 'Chisale', 'Jere',
    'Zulu', 'Moyo', 'Msiska', 'Mkandawire', 'Kumwenda', 'Ngwira', 'Kamanga', 'Munthali', 'Chavula', 'Mbewe', 'Lungu', 'Mtambo', 'Kachingwe',
    'Chimombo', 'Mussa', 'Bwanali', 'Kamwendo', 'Chiumia', 'Soko', 'Nkhata', 'Mughogho', 'Kapinga', 'Saka', 'Chaponda', 'Mbendera', 'Kandodo'],
  PLACES: ['Shire', 'Mulanje', 'Zomba', 'Nyika', 'Chambo', 'Kasungu', 'Likoma', 'Dedza', 'Ntcheu', 'Mangochi', 'Lakeview', 'Kapeni', 'Chileka',
    'Bwaila', 'Mzimba', 'Thyolo', 'Karonga', 'Salima', 'Balaka', 'Mchinji', 'Dowa', 'Linthipe', 'Bvumbwe', 'Chiradzulu', 'Mwanza', 'Machinga',
    'Nsanje', 'Rumphi', 'Chitipa', 'Nkhotakota', 'Viphya', 'Zalewa', 'Kanjedza', 'Area 18', 'Chilomoni', 'Ndirande'],
  TRADES: ['Hardware', 'Agro Traders', 'Logistics', 'Pharmaceuticals', 'Motors', 'Building Supplies', 'Textiles', 'Foods', 'Electricals',
    'Engineering', 'Stationers', 'Supermarkets', 'Holdings', 'Imports', 'Construction', 'Medical Supplies', 'Solar Solutions', 'Farm Inputs',
    'Distributors', 'Tyres & Spares', 'Cosmetics', 'Furniture', 'Plastics', 'Beverages'],
  STREETS: ['Victoria Avenue', 'Glyn Jones Road', 'Kamuzu Highway', 'Presidential Way', 'Paul Kagame Road', 'Chilembwe Road', 'Masauko Chipembere Highway',
    'Kenyatta Drive', 'Mzimba Street', 'Orton Chirwa Avenue', 'Livingstone Avenue', 'Haile Selassie Road', 'Independence Drive', 'Convention Drive'],
  SUPPLIERS: [
    { city: 'Guangzhou', country: 'China', ccy: ['USD', 'CNY'] }, { city: 'Shenzhen', country: 'China', ccy: ['USD', 'CNY'] },
    { city: 'Yiwu', country: 'China', ccy: ['USD', 'CNY'] }, { city: 'Foshan', country: 'China', ccy: ['USD'] },
    { city: 'Mumbai', country: 'India', ccy: ['USD', 'INR'] }, { city: 'Chennai', country: 'India', ccy: ['USD', 'INR'] },
    { city: 'Ahmedabad', country: 'India', ccy: ['USD'] }, { city: 'Johannesburg', country: 'South Africa', ccy: ['ZAR'] },
    { city: 'Durban', country: 'South Africa', ccy: ['ZAR'] }, { city: 'Cape Town', country: 'South Africa', ccy: ['ZAR'] },
    { city: 'Dubai', country: 'United Arab Emirates', ccy: ['USD', 'AED'] }, { city: 'Sharjah', country: 'United Arab Emirates', ccy: ['AED'] },
    { city: 'Hamburg', country: 'Germany', ccy: ['EUR'] }, { city: 'Istanbul', country: 'Turkey', ccy: ['USD', 'EUR'] },
    { city: 'Lusaka', country: 'Zambia', ccy: ['USD', 'ZMW'] }, { city: 'Dar es Salaam', country: 'Tanzania', ccy: ['USD'] },
    { city: 'Nairobi', country: 'Kenya', ccy: ['USD', 'KES'] }, { city: 'Manchester', country: 'United Kingdom', ccy: ['GBP'] },
  ],
  SUFFIX: ['Trading Co.', 'Industrial Ltd', 'Manufacturing Co.', 'Exports (Pty) Ltd', 'Supplies Ltd', 'Machinery Co.', 'International FZE', 'Global Ltd'],
  GOODS: ['Roofing sheets and steel bars', 'Maize sheller machines', 'Solar panels and inverters', 'Pharmaceutical products', 'Motor vehicle spare parts',
    'Fertiliser', 'Irrigation pumps', 'Floor tiles', 'Electrical cables', 'School textbooks', 'Cooking oil', 'Second-hand clothing bales',
    'Laboratory equipment', 'Packaging materials', 'Tractors and implements', 'Mobile phones and accessories', 'Office furniture', 'Plastic granules'],
  FORWARDERS: [
    { name: 'Beira Corridor Freight & Shipping', address: 'Port of Beira', country: 'Mozambique' },
    { name: 'Nacala Logistics Lda', address: 'Port of Nacala', country: 'Mozambique' },
    { name: 'Durban Container Forwarding (Pty) Ltd', address: 'Durban', country: 'South Africa' },
    { name: 'Dar Port Clearing & Forwarding', address: 'Dar es Salaam', country: 'Tanzania' },
    { name: 'Trans-Zambezi Haulage', address: 'Lusaka', country: 'Zambia' },
  ],
  UNIS: [
    { name: 'University of Leeds', address: 'Leeds LS2 9JT', country: 'United Kingdom', ccy: 'GBP' },
    { name: 'Coventry University', address: 'Coventry CV1 5FB', country: 'United Kingdom', ccy: 'GBP' },
    { name: 'University of Cape Town', address: 'Rondebosch, Cape Town', country: 'South Africa', ccy: 'ZAR' },
    { name: 'University of the Witwatersrand', address: 'Braamfontein, Johannesburg', country: 'South Africa', ccy: 'ZAR' },
    { name: 'Manipal University', address: 'Manipal, Karnataka', country: 'India', ccy: 'USD' },
    { name: 'University of Nairobi', address: 'Nairobi', country: 'Kenya', ccy: 'USD' },
    { name: 'Zhejiang University', address: 'Hangzhou', country: 'China', ccy: 'USD' },
    { name: 'University of Toronto', address: 'Toronto, Ontario', country: 'Canada', ccy: 'USD' },
    { name: 'Monash University', address: 'Melbourne, Victoria', country: 'Australia', ccy: 'USD' },
  ],
  HOSPITALS: [
    { name: 'Apollo Hospitals', address: 'Chennai', country: 'India', ccy: 'USD' },
    { name: 'Fortis Memorial Research Institute', address: 'Gurugram', country: 'India', ccy: 'USD' },
    { name: 'Netcare Milpark Hospital', address: 'Johannesburg', country: 'South Africa', ccy: 'ZAR' },
    { name: 'Aga Khan University Hospital', address: 'Nairobi', country: 'Kenya', ccy: 'USD' },
  ],
  DESTS: [
    { country: 'South Africa', ccy: 'ZAR' }, { country: 'United Arab Emirates', ccy: 'USD' }, { country: 'United Kingdom', ccy: 'GBP' },
    { country: 'Kenya', ccy: 'USD' }, { country: 'Zambia', ccy: 'USD' }, { country: 'Tanzania', ccy: 'USD' }, { country: 'China', ccy: 'USD' },
    { country: 'India', ccy: 'USD' }, { country: 'Germany', ccy: 'EUR' },
  ],
  RETURN_REASONS: ['Please attach a clearer copy of the invoice.', 'Beneficiary address is incomplete – please capture the full address.',
    'The account balance captured does not match the core banking balance.', 'Please confirm the client’s ID number against the ID document.',
    'Proof of payment is missing a page.', 'Please capture the relationship to the beneficiary.'],
  REJECT_REASONS: ['The invoice is not addressed to the applicant. Please bring an invoice in the client’s name and reapply.',
    'The supporting documents do not support the amount applied for. Please reapply with documents for the correct amount.',
    'The admission letter has expired. Please reapply with a current admission letter.',
    'The travel dates on the ticket do not match the application. Please reapply with the correct ticket.'],
  EC_NOTES: ['Documents in order.', 'Genuine trade transaction.', 'Recommended – supporting documents verified.', 'Reconcile within 90 days.',
    'Recommended subject to original invoice being sighted.', 'Amount within allowance.'],
  RECON_NOTES: ['Bill of entry and final invoice received.', 'Customs entry and transport documents received and match the advance.',
    'Goods cleared – import documents verified.'],
  SUBMIT_NOTES: ['Client waiting at the branch.', 'Urgent – supplier deadline this week.', 'Documents verified against originals.'],
  CLOSE_REASONS: ['Client no longer needs the foreign currency.', 'Client cancelled the order with the supplier.', 'Client found the funds elsewhere.', 'The trip has been cancelled.'],
  REVERSE_REASONS: ['Returned by the correspondent bank: beneficiary account closed.', 'Returned by the supplier’s bank: account details do not match.', 'Returned by the correspondent bank: sanctions screening query.'],

  /* ---------- deterministic random numbers ---------- */
  seed(s) {
    let a = s >>> 0;
    this.rand = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  },
  r(a, b) { return a + this.rand() * (b - a); },
  ri(a, b) { return Math.floor(this.r(a, b + 1)); },
  pick(arr) { return arr[Math.floor(this.rand() * arr.length)]; },
  chance(p) { return this.rand() < p; },
  weighted(pairs) { const tot = U.sum(pairs, p => p[1]); let x = this.r(0, tot); for (const [v, w] of pairs) { if ((x -= w) <= 0) return v; } return pairs[pairs.length - 1][0]; },
  slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, ''); },

  /* ---------- time helpers (business hours, weekdays) ---------- */
  bizDay(d) { let x = new Date(d); while (U.isWeekend(x)) x = U.addDays(x, 1); return x; },
  timeOn(day, h0 = 8.5, h1 = 14.5) {
    const x = this.bizDay(U.startOfDay(day));
    const h = this.r(h0, h1);
    x.setHours(Math.floor(h), Math.floor((h % 1) * 60), 0, 0);
    return x;
  },
  later(t, hours) {
    const x = new Date(+t + hours * 3600e3);
    if (U.isWeekend(x) || x.getHours() >= 16) return this.timeOn(U.addDays(U.startOfDay(x), 1), 8.5, 10.5);
    if (x.getHours() < 8) return this.timeOn(U.startOfDay(x), 8.5, 10.5);
    return x;
  },
  dayLater(t, days) { return this.timeOn(U.addDays(t, days)); },
  at(t, fn) {
    const ms = +t;
    let lo = 0, hi = this.queue.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.queue[mid].t <= ms) lo = mid + 1; else hi = mid; }
    this.queue.splice(lo, 0, { t: ms, fn });
  },
  now() { return new Date(Store.state.clock); },
  as(user) { Store.state.currentUserId = user.id; },

  /* The servers keep the data in their database; the Test prototype keeps it in this browser. */
  hosted() { return typeof Live !== 'undefined'; },

  /* ---------- people ---------- */
  async createUsers(progress) {
    const S = Store.state;
    const used = new Set(S.users.map(u => String(u.username).toLowerCase()));
    const staff = { inputter: {}, authoriser: {}, treasury: [], ec: [] };
    const mk = (role, branchId) => {
      let first, last, uname;
      do { first = this.pick(this.FIRST); last = this.pick(this.LAST); uname = `${first}.${last}@${Brand.current.emailDomain}`.toLowerCase(); } while (used.has(uname));
      used.add(uname);
      const u = { id: U.uid('u'), name: `${first} ${last}`, role, branchId, email: uname, username: uname, active: true, test: true };
      S.users.push(u);
      return u;
    };
    S.branches.filter(b => b.id !== 'br_ho').forEach(b => { staff.inputter[b.id] = mk('INPUTTER', b.id); staff.authoriser[b.id] = mk('AUTHORISER', b.id); });
    staff.treasury.push(mk('TREASURY', 'br_ho'), mk('TREASURY', 'br_ho'));
    staff.ec.push(mk('EC', 'br_ho'), mk('EC', 'br_ho'));
    progress('Saving test users…');
    if (this.hosted()) await Live.flush();
    const all = [...Object.values(staff.inputter), ...Object.values(staff.authoriser), ...staff.treasury, ...staff.ec];
    let n = 0;
    for (const u of all) {
      if (this.hosted()) await Live.api('POST', `/api/admin/users/${u.id}/password`, { password: this.UAT_PASSWORD, temporary: false });
      else await Auth.setPassword(u, this.UAT_PASSWORD, { temporary: false });
      u.mustChangePassword = false;
      progress(`Setting test users’ passwords… ${++n}/${all.length}`);
    }
    return staff;
  },

  signatories(domain, phone) {
    const roles = ['Managing Director (signatory)', 'Finance Director (signatory)', 'Company Secretary (signatory)', 'Chief Accountant'];
    const out = [];
    for (let i = 0, n = this.ri(1, 2); i < n; i++) {
      const role = roles[i], who = this.pick(this.FIRST).toLowerCase();
      out.push({ kind: 'phone', value: phone(), name: role });
      if (this.chance(0.8)) out.push({ kind: 'email', value: `${who}.${['md', 'fd', 'cosec', 'accounts'][i]}@${domain}.test`, name: role });
    }
    return out;
  },

  makeCustomers() {
    const branches = Store.state.branches.filter(b => b.id !== 'br_ho');
    const town = b => String(b.address || b.name).split(',').pop().trim();
    const phone = () => `+265 ${this.pick(['99', '88', '98', '89'])}${this.ri(1, 9)} ${this.ri(100, 999)} ${this.ri(100, 999)}`;
    const used = new Set();
    const list = [];
    for (let i = 0; i < 125; i++) {
      let name;
      do { name = `${this.pick(this.PLACES)} ${this.pick(this.TRADES)} Ltd`; } while (used.has(name));
      used.add(name);
      const b = this.pick(branches), fcy = this.chance(0.25);
      const idType = this.weighted([['CERT_INCORPORATION', 6], ['BUSINESS_REG', 3], ['BUSINESS_LICENCE', 1]]);
      const idNumber = idType === 'CERT_INCORPORATION' ? `COMP-${this.ri(2004, 2024)}-${this.ri(1000, 9999)}` : idType === 'BUSINESS_REG' ? `BRN-${this.ri(10000, 99999)}` : `BL/${this.ri(1000, 9999)}/${this.ri(2019, 2026)}`;
      list.push({ kind: 'biz', branchId: b.id, customer: { name, account: `${b.code}${this.ri(1000000, 9999999)}`, accountType: fcy ? 'FCY' : 'LCY', idType, idNumber,
        address: `${this.ri(1, 250)} ${this.pick(this.STREETS)}, ${town(b)}`, email: `accounts@${this.slug(name.replace(/ Ltd$/, ''))}.test`, phone: phone(),
        // Most companies have directors / signatories who also receive the client alerts.
        contacts: this.chance(0.6) ? this.signatories(this.slug(name.replace(/ Ltd$/, '')), phone) : [] } });
    }
    for (let i = 0; i < 170; i++) {
      const first = this.pick(this.FIRST), last = this.pick(this.LAST), b = this.pick(branches);
      const idType = this.weighted([['NATIONAL_ID', 15], ['PASSPORT_MW', 4], ['DRIVING_LICENCE', 1]]);
      const passport = `MA${this.ri(1000000, 9999999)}`;
      const nid = Array.from({ length: 8 }, () => this.pick('ABCDEFGHJKLMNPRSTUVWXYZ23456789'.split(''))).join('');
      const idNumber = idType === 'NATIONAL_ID' ? nid : idType === 'PASSPORT_MW' ? passport : `DL-${this.ri(100000, 999999)}`;
      list.push({ kind: 'ind', branchId: b.id, first, last, passport, customer: { name: `${first} ${last}`, account: `${b.code}${this.ri(1000000, 9999999)}`, accountType: this.chance(0.1) ? 'FCY' : 'LCY',
        idType, idNumber, address: `${this.pick(['Area', 'Plot', 'House'])} ${this.ri(1, 60)}, ${town(b)}`, email: this.chance(0.75) ? `${first}.${last}${this.ri(1, 99)}@mail.test`.toLowerCase() : '', phone: phone() } });
    }
    return list;
  },

  /* ---------- one application's data, valid at capture time t ---------- */
  buildApp(type, cust, t, inputter) {
    const rates = Store.state.settings.rates;
    const day = k => U.dayKey(U.addDays(t, k));
    const docs = [];
    const doc = code => docs.push({ id: U.uid('doc'), code, name: `${DOC_TYPES[code].split(' (')[0].replace(/[^\w]+/g, '_')}_${this.ri(100, 999)}.pdf`, size: this.ri(60, 900) * 1024, mime: 'application/pdf', uploadedAt: t.toISOString(), uploadedBy: inputter.id, sample: true });
    let currency = 'USD', usd = 0, beneficiary = {}, details = {};
    const student = () => `${this.pick(this.FIRST)} ${cust.last || this.pick(this.LAST)}`;
    const studyDates = () => { const s = this.ri(-90, 45); return { visaExpiry: day(this.ri(300, 900)), studyStart: day(s), studyEnd: day(s + 365 * this.ri(1, 4)) }; };
    switch (type) {
      case 'ADVANCE':
      case 'OPEN_ACCOUNT': {
        const s = this.pick(this.SUPPLIERS);
        currency = this.pick(s.ccy);
        usd = this.r(3000, type === 'ADVANCE' ? 120000 : 80000);
        beneficiary = { name: `${s.city} ${this.pick(this.SUFFIX)}`, address: `${this.ri(1, 999)} Industrial Zone, ${s.city}`, country: s.country,
          product: `${this.pick(this.GOODS)}${type === 'ADVANCE' ? ` (advance ${this.pick([20, 30, 40, 50])}%)` : ''}` };
        details = { invoiceNumber: `${type === 'ADVANCE' ? 'PI' : 'INV'}-${this.ri(10000, 99999)}`, invoiceDate: day(-this.ri(2, 45)) };
        doc('INVOICE');
        break;
      }
      case 'FREIGHT': {
        const f = this.pick(this.FORWARDERS);
        usd = this.r(1500, 25000);
        beneficiary = { name: f.name, address: f.address, country: f.country, product: `Freight – ${this.ri(1, 4)} container(s) ${this.pick(['MSKU', 'MSCU', 'CMAU', 'HLXU'])}${this.ri(100000, 999999)}` };
        details = { invoiceNumber: `FRT-${this.ri(10000, 99999)}`, invoiceDate: day(-this.ri(1, 20)) };
        doc('INVOICE');
        break;
      }
      case 'GIFTS': {
        const d = this.pick(this.DESTS);
        currency = d.ccy;
        usd = this.r(150, 3000);
        beneficiary = { name: `${this.pick(this.FIRST)} ${cust.last || this.pick(this.LAST)}`, address: `${this.ri(1, 200)} Main Road`, country: d.country,
          product: this.pick(['Wedding gift', 'Birthday gift', 'Family support', 'Graduation gift', 'Funeral support']),
          relationship: this.pick(['Son', 'Daughter', 'Brother', 'Sister', 'Mother', 'Father', 'Cousin', 'Friend', 'Nephew', 'Niece']) };
        if (this.chance(0.5)) doc('BENEFICIARY_DETAILS');
        break;
      }
      case 'STUDENT_FEES': {
        const u = this.pick(this.UNIS), name = student();
        currency = u.ccy;
        usd = this.r(2500, 22000);
        beneficiary = { name: u.name, address: u.address, country: u.country, product: `Tuition fees ${t.getFullYear()}/${String(t.getFullYear() + 1).slice(2)} – ${name}` };
        details = Object.assign({ studentName: name }, studyDates());
        ['ADMISSION', 'FEES', 'STUDENT_PASSPORT', 'VISA'].forEach(doc);
        break;
      }
      case 'MAINTENANCE': {
        usd = this.r(300, 3000);
        if (this.chance(0.6)) {
          const u = this.pick(this.UNIS), name = student();
          currency = u.ccy;
          beneficiary = { name, address: u.address, country: u.country, product: 'Student maintenance – rent and upkeep' };
          details = Object.assign({ maintenanceFor: 'STUDENT', studentName: name }, studyDates());
          ['ADMISSION', 'STUDENT_PASSPORT', 'VISA', 'PROOF'].forEach(doc);
          if (this.chance(0.4)) doc('SUPPORTING');
        } else {
          const d = this.pick(this.DESTS);
          currency = d.ccy;
          beneficiary = { name: `${this.pick(this.PLACES)} Property Managers`, address: `${this.ri(1, 300)} High Street`, country: d.country, product: this.pick(['Rent – family apartment', 'Care home fees', 'Rent – student hostel']) };
          details = { maintenanceFor: 'OTHER' };
          ['SUPPORTING', 'PROOF'].forEach(doc);
        }
        break;
      }
      case 'CASH':
      case 'CASH_PASSPORT':
      case 'MEDICAL': {
        const medical = type === 'MEDICAL';
        const h = medical ? this.pick(this.HOSPITALS) : null, d = medical ? h : this.pick(this.DESTS);
        currency = medical ? h.ccy : this.pick(['USD', 'USD', 'USD', d.ccy]);
        const days = medical ? this.ri(5, 21) : this.ri(3, 14), travel = this.ri(10, 40) + (this.travelAhead || 0);
        usd = days * 500 * this.r(0.5, 1);
        beneficiary = medical
          ? { name: h.name, address: h.address, country: h.country, product: this.pick(['Cardiac procedure', 'Orthopaedic surgery', 'Cancer treatment', 'Kidney treatment', 'Eye surgery']) }
          : { name: cust.customer.name, address: cust.customer.address, country: d.country, product: this.pick(['Business travel allowance', 'Holiday travel allowance', 'Conference travel allowance', 'Family visit travel allowance']) };
        details = { travellerName: cust.customer.name, passportNumber: cust.passport, travelDate: day(travel), returnDate: day(travel + days - 1) };
        doc('PASSPORT');
        if (medical) ['REFERRAL', 'MEDICAL_INVOICE', 'TICKET'].forEach(doc);
        else if (usd > Store.state.settings.ticketThresholdUSD || this.chance(0.4)) doc('TICKET');
        break;
      }
    }
    const perUnitUSD = rates[currency] / rates.USD;
    let amount = usd / perUnitUSD;
    amount = amount >= 1000 ? Math.floor(amount / 10) * 10 : Math.floor(amount);
    if (details.invoiceNumber) details.invoiceAmount = type === 'ADVANCE' ? Math.round(amount * this.r(2, 4)) : amount;
    const c = cust.customer;
    const needMWK = amount * rates[currency];
    const balanceCurrency = c.accountType === 'FCY' ? 'USD' : 'MWK';
    const balance = balanceCurrency === 'MWK' ? Math.round(needMWK * this.r(0.8, 3) / 1000) * 1000 : Math.round(usd * this.r(0.9, 2.5));
    // Customer details and balance as fetched from the (simulated) core banking system at capture.
    const customer = U.clone(c);
    customer.cbs = { account: Engine.normAccount(c.account), at: new Date(t).toISOString(), source: 'Simulated CBS', name: c.name, accountType: c.accountType, currency: balanceCurrency,
      balance, address: c.address, phones: Engine.clientPhones(c), emails: Engine.clientEmails(c) };
    return Object.assign(Engine.blank(inputter), { customer, type, balance, balanceCurrency, amount, currency, beneficiary, details, documents: docs });
  },

  plan(app, t, realNow, stop) {
    const travel = Rules.isTravel(app);
    // Stops at this stage on purpose. Some of the closed ones are funded first, so the money is due back to the client.
    if (stop) {
      const closeFunded = stop === 'CANCELLED' && this.chance(0.4);
      return { stop, closeFunded, stayDraft: false, returnFirst: stop === 'RETURNED', rejectClient: false,
        ecRec: stop === 'AWAITING_ALLOCATION' ? this.weighted([['Recommended', 80], ['Recommended with conditions', 12], ['Not recommended', 8]]) : 'Recommended',
        allocate: closeFunded || ['ALLOCATED', 'FUNDED', 'PARTLY_PAID', 'REVERSED'].includes(stop), allocDelay: this.ri(1, 3), partial: stop === 'PARTLY_PAID' };
    }
    const recent = (realNow - t) < 5 * 86400e3;
    const ecRec = this.weighted([['Recommended', 84], ['Recommended with conditions', 11], ['Not recommended', 5]]);
    const returnFirst = this.chance(0.1);
    return {
      stayDraft: recent ? this.chance(0.35) : this.chance(0.015),
      returnFirst, rejectClient: !returnFirst && this.chance(0.05), ecRec,
      allocate: ecRec !== 'Not recommended' && (travel ? this.chance(0.72) : this.chance(0.9)),
      allocDelay: travel ? this.ri(1, 12) : this.ri(1, 10),
      partial: !travel && this.chance(0.18),
    };
  },

  /* ---------- workflow steps (each runs at its simulated time) ---------- */
  capture(stop = null) {
    const S = Store.state, t = this.now();
    const biz = stop === 'PARTLY_PAID' || this.chance(0.45);   // travel allowances are not part-allocated
    const cust = this.pick(this.custs.filter(c => c.kind === (biz ? 'biz' : 'ind')));
    const branchId = this.chance(0.88) ? cust.branchId : this.pick(S.branches.filter(b => b.id !== 'br_ho')).id;
    const type = biz ? this.weighted([['ADVANCE', 30], ['OPEN_ACCOUNT', 40], ['FREIGHT', 30]])
      : this.weighted([['GIFTS', 15], ['STUDENT_FEES', 22], ['MAINTENANCE', 15], ['CASH', 20], ['CASH_PASSPORT', 15], ['MEDICAL', 13]]);
    const inputter = this.staff.inputter[branchId];
    this.as(inputter);
    // A staged travel application must not pass its travel date before today, or it would have expired.
    this.travelAhead = stop ? Math.max(0, U.daysBetween(t, this.realNow)) : 0;
    const app = Engine.save(this.buildApp(type, cust, t, inputter), { submit: false }).app;
    const p = this.plans[app.id] = this.plan(app, t, this.realNow, stop);
    if (p.stayDraft) return;
    this.at(this.later(t, this.r(0.2, 1.5)), () => this.submit(app.id));
  },

  submit(id, resubmission = false) {
    const a = Store.app(id), p = this.plans[id];
    this.as(this.staff.inputter[a.branchId]);
    const unrec = Engine.unreconciledFor(a);
    // A client with unreconciled advance payments (any branch) cannot proceed: rejected at input, or kept as a draft
    // and submitted once the client has cleared them.
    if (Rules.unreconciledBlock(a).blocking.length) {
      if (!resubmission && this.chance(0.6)) {
        Engine.inputReject(a, { reason: `Client has unreconciled advance payment(s): ${unrec.map(x => x.ref).join(', ')}`, clientMessage: Engine.unreconciledMessage(unrec) });
      } else if ((p.blockedTries = (p.blockedTries || 0) + 1) <= 4) {
        this.at(this.dayLater(this.now(), this.ri(7, 30)), () => this.submit(id, resubmission));
      }
      return;
    }
    try {
      Engine.submit(a, resubmission ? 'Corrected as requested.' : (this.chance(0.25) ? this.pick(this.SUBMIT_NOTES) : ''));
    } catch (e) {
      if (this.debug.length < 5) this.debug.push(`${a.ref} ${a.type}: ${Rules.validate(a).errors.map(x => x.msg).join('; ')}`);
      throw e;
    }
    if (p.stop === 'PENDING_AUTH') return;
    this.at(this.later(this.now(), this.r(1, 26)), () => this.authorise(id));
    if (resubmission) p.returnFirst = false;
  },

  authorise(id) {
    const a = Store.app(id), p = this.plans[id], now = this.now();
    this.as(this.staff.authoriser[a.branchId]);
    if (p.returnFirst) {
      Engine.reject(a, { mode: 'RETURN', comment: this.pick(this.RETURN_REASONS) });
      if (p.stop === 'RETURNED') return;
      this.at(this.dayLater(now, this.ri(1, 3)), () => this.submit(id, true));
      return;
    }
    if (p.rejectClient) { Engine.reject(a, { mode: 'CLIENT', comment: this.pick(this.REJECT_REASONS), clientMessage: '' }); return; }
    Engine.authorise(a, this.chance(0.25) ? 'Documents verified.' : '');
    this.at(this.later(now, this.r(2, 40)), () => this.recommend(id));
    if (p.stop === 'ALLOCATED') { this.at(this.fundableNow(), () => this.allocate(id)); return; }
    if (p.stop === 'CANCELLED' && !p.closeFunded) { this.at(this.dayLater(now, this.ri(1, 4)), () => this.close(id)); return; }
    if (p.allocate) {
      let delay = p.allocDelay;
      if (Rules.isTravel(a)) delay = Math.min(delay, U.daysBetween(now, a.details.travelDate) - 2);
      if (delay >= 1) this.at(this.dayLater(now, delay), () => this.allocate(id));
    }
  },

  recommend(id) {
    const a = Store.app(id), p = this.plans[id];
    const ec = this.pick(this.staff.ec);
    this.as(ec);
    Engine.recommend(a, { recommendation: p.ecRec, note: this.chance(0.6) ? this.pick(this.EC_NOTES) : '' });
    if (!Rules.isTravel(a) && Engine.can('assign', a) && this.chance(0.35)) {
      Engine.assign(a, this.chance(0.7) ? { kind: 'BRANCH', branchId: a.branchId, note: 'Branch to process.' } : { kind: 'SELF', note: '' });
    }
  },

  allocate(id) {
    const S = Store.state, a = Store.app(id), p = this.plans[id], now = this.now();
    this.as(this.pick(this.staff.treasury));
    if (!Engine.can('allocate', a)) return;
    const t = Engine.totals(a);
    let amount = t.unallocated, note = '';
    if (p.partial && !p.partialDone) { amount = U.round2(t.unallocated * this.r(0.4, 0.8)); p.partialDone = true; note = 'Partial allocation – limited availability.'; }
    const rate = Math.round(S.settings.rates[a.currency] * this.r(0.99, 1.015) * 10000) / 10000;
    // About a quarter of non-USD applications are allocated in US dollars, with a cross rate (USD per unit applied).
    const inUsd = a.currency !== 'USD' && this.chance(0.25);
    const crossRate = inUsd ? Math.round(S.settings.rates[a.currency] / S.settings.rates.USD * this.r(0.995, 1.005) * 1e6) / 1e6 : null;
    // Available balance from the (simulated) CBS: enough funds → the funding stage is skipped. Staged ones stay in it.
    if (!p.stop) Funding.refreshSync(a);
    const al = Engine.allocate(a, inUsd ? { allocCurrency: 'USD', amount: U.round2(amount * crossRate), rate, crossRate, valueDate: U.dayKey(now), note } : { amount, rate, valueDate: U.dayKey(now), note });
    if (al.autoFunded) { this.at(this.later(this.now(), this.r(0.5, 20)), () => this.pay(id)); return; }
    if (p.stop === 'ALLOCATED') return;
    const deadline = +new Date(al.deadline);
    if (p.stop || this.chance(0.88)) {
      let ft = +now + this.r(0.3, 4) * 3600e3;
      if (ft >= deadline - 10 * 60e3) ft = deadline - this.r(15, 60) * 60e3;
      if (ft <= +now) ft = +now + 5 * 60e3;
      this.at(ft, () => this.fund(id));
    } else if (this.chance(0.6)) {
      this.at(this.dayLater(new Date(deadline), this.ri(2, 7)), () => this.allocate(id));   // forfeited; try again later
    }
  },

  fund(id) {
    const a = Store.app(id), p = this.plans[id];
    if (!(Engine.totals(a).awaitingFunding > 0)) return;
    const branchStaff = this.staff.inputter[a.branchId];
    const user = Rules.isTravel(a) ? branchStaff
      : (Engine.ecRecommended(a) && this.chance(0.35) ? branchStaff : this.pick([...this.staff.treasury, ...this.staff.ec]));
    this.as(user);
    Engine.confirmFunding(a, this.chance(0.4) ? `Deposit slip ${this.ri(10000, 99999)}` : '');
    if (p.stop === 'FUNDED') return;
    if (p.closeFunded) { this.at(this.dayLater(this.now(), this.ri(1, 2)), () => this.close(id)); return; }
    this.at(this.later(this.now(), this.r(0.5, 20)), () => this.pay(id));
  },

  pay(id) {
    const S = Store.state, a = Store.app(id), p = this.plans[id], now = this.now();
    const t = Engine.totals(a);
    if (!(t.fundedUnpaid > 0)) return;
    const asg = a.assignment;
    const payer = Rules.isTravel(a) ? this.staff.inputter[a.branchId]
      : asg?.kind === 'BRANCH' ? this.staff.inputter[asg.branchId]
      : asg?.kind === 'USER' ? Store.userById(asg.userId) : this.pick(this.staff.ec);
    this.as(payer);
    let outcome = t.fundedUnpaid >= t.balance - 0.005 ? 'FULL' : 'PART';
    if (outcome === 'PART' && this.chance(0.08)) outcome = 'FULL';   // client accepts a short close
    const reference = a.type === 'CASH' ? `CASH-${this.ri(10000, 99999)}` : a.type === 'CASH_PASSPORT' ? `CP-LOAD-${this.ri(10000, 99999)}` : `MT103-${this.ri(100000, 999999)}`;
    const corr = S.correspondents.find(c => String(c.currencies || '').includes(a.currency));
    Engine.recordPayment(a, { outcome, amount: t.fundedUnpaid, reference, correspondentId: corr ? corr.id : null, valueDate: U.dayKey(now), comment: '' });
    if (p.stop === 'REVERSED') { this.at(this.dayLater(now, this.ri(1, 3)), () => this.reverse(id)); return; }
    if (p.stop) return;
    if (a.status === 'PARTLY_PAID' && this.chance(0.75)) this.at(this.dayLater(now, this.ri(3, 15)), () => this.allocate(id));
    if (a.type === 'ADVANCE' && a.recon?.status === 'PENDING' && this.chance(0.7)) this.at(this.dayLater(now, this.ri(35, 125)), () => this.reconcile(id));
  },

  /* The client asked to close it: whatever was allocated or funded goes back. */
  close(id) {
    const a = Store.app(id);
    this.as(this.staff.inputter[a.branchId]);
    Lifecycle.clientClose(a, { reason: this.pick(this.CLOSE_REASONS), clientMessage: '' });
  },

  /* Exchange Control reverses the payment; now and then the inputter then proposes another supplier. */
  reverse(id) {
    const a = Store.app(id);
    this.as(this.pick(this.staff.ec));
    const p = a.payments.filter(x => !x.reversed).pop();
    Lifecycle.reverse(a, p.id, { reason: this.pick(this.REVERSE_REASONS), clientMessage: 'The funds are held for this application. Please advise whether to pay again or refund your account.' });
    if (!this.chance(0.3)) return;
    const s = this.pick(this.SUPPLIERS);
    this.as(this.staff.inputter[a.branchId]);
    Lifecycle.requestBenChange(a, { beneficiary: { name: `${s.city} ${this.pick(this.SUFFIX)}`, address: `${this.ri(1, 999)} Trade Park, ${s.city}`, country: s.country }, details: {}, reason: 'Client asks to pay another supplier.' });
  },

  /* A moment today whose funding deadline is still ahead of us, so the allocation is not forfeited before anyone sees it. */
  fundableNow() {
    const now = +this.realNow;
    const [h, m] = Store.state.settings.fundingCutoff.split(':').map(Number);
    const cutoff = new Date(this.realNow); cutoff.setHours(h, m, 0, 0);
    const morning = new Date(this.realNow); morning.setHours(8, 30, 0, 0);
    const from = now > +cutoff ? +cutoff + 60e3 : +morning;
    return from < now ? this.r(from, now) : now - 60e3;
  },

  /* Reconciliation workflow: inputter uploads the documents and submits, the branch authoriser authorises (or now and
     then returns), Exchange Control reconciles (or now and then declines, after which the client is alerted). */
  reconcile(id, round = 1, force = null) {
    const a = Store.app(id), now = this.now();
    if (!a?.recon || !['PENDING', 'RETURNED', 'DECLINED'].includes(a.recon.status)) return;   // already with a reviewer, or reconciled
    // Clients sometimes bring the documents to another branch, which then handles the reconciliation.
    const ids = Object.keys(this.staff.inputter);
    const handling = round === 1 && this.chance(0.15) ? this.pick(ids) : (a.recon.branchId || a.branchId);
    const inputter = this.staff.inputter[handling], authoriser = this.staff.authoriser[handling];
    if (!inputter || !authoriser) return;
    // In the last two weeks, leave some items part-way so every stage is represented today.
    const late = +this.realNow - +now < 14 * 864e5;
    const stopAt = force || (late ? this.pick(['SUBMITTED', 'REVIEW', 'RETURNED', 'DECLINED', 'END', 'END']) : 'END');
    this.as(inputter);
    const doc = (code, name) => ({ id: U.uid('doc'), code, name, size: this.ri(100, 600) * 1024, mime: 'application/pdf', uploadedAt: now.toISOString(), uploadedBy: inputter.id, sample: true });
    a.recon.documents = a.recon.documents || [];
    if (!a.recon.documents.some(d => d.code === 'RECON_CUSTOMS')) a.recon.documents.push(doc('RECON_CUSTOMS', `Bill_of_entry_${this.ri(10000, 99999)}.pdf`));
    if (!a.recon.documents.some(d => d.code === 'RECON_INVOICE')) a.recon.documents.push(doc('RECON_INVOICE', `Final_invoice_${this.ri(1000, 9999)}.pdf`));
    if (this.chance(0.6)) a.recon.documents.push(doc('RECON_TRANSPORT', `Bill_of_lading_${this.ri(1000, 9999)}.pdf`));
    try { Recon.submit(a, round > 1 ? 'Further documents from the client.' : ''); } catch { return; }
    if (stopAt === 'SUBMITTED') return;
    this.at(this.dayLater(now, this.ri(0, 2)), () => {
      this.as(authoriser);
      if (stopAt === 'RETURNED' || (round === 1 && this.chance(0.1))) {
        try { Recon.reject(a, 'Bill of entry is not certified – please obtain a certified copy.'); } catch { return; }
        if (stopAt !== 'RETURNED') this.at(this.dayLater(this.now(), this.ri(2, 10)), () => this.reconcile(id, round + 1));
        return;
      }
      try { Recon.authorise(a, ''); } catch { return; }
      if (stopAt === 'REVIEW') return;
      this.at(this.dayLater(this.now(), this.ri(1, 5)), () => {
        this.as(this.pick(this.staff.ec));
        if (stopAt === 'DECLINED' || (round === 1 && this.chance(0.1))) {
          const why = 'The customs entry value does not match the amount paid.';
          try { Recon.decline(a, why); } catch { return; }
          this.as(inputter);
          try { Recon.alertClient(a, `The documents are not sufficient to reconcile this payment: ${why} Please bring the corrected customs entry.`); } catch { /* ignore */ }
          if (stopAt !== 'DECLINED') this.at(this.dayLater(this.now(), this.ri(5, 20)), () => this.reconcile(id, round + 1));
          return;
        }
        try { Recon.reconcile(a, this.pick(this.RECON_NOTES)); } catch { /* period closed */ }
      });
    });
  },

  /* ---------- run ---------- */
  async run(progress) {
    const S = Store.state, admin = Store.user(), hosted = this.hosted();
    const pause = on => { if (hosted) Live.suspended = on; else Store.suspended = on; };
    const scheduler = hosted ? Live.baseScheduler : Engine.runScheduler.bind(Engine);
    if (hosted && Live.env.golive) throw new WorkflowError('Test data cannot be loaded after go-live.');
    if (S.apps.length) throw new WorkflowError('Delete the existing transactions first.');
    this.seed(20261020);
    this.debug = [];
    this.plans = {};
    this.queue = [];
    this.staff = await this.createUsers(progress);
    this.custs = this.makeCustomers();
    this.realNow = new Date();
    const start = U.startOfDay(U.addDays(this.realNow, -this.DAYS));
    pause(true);
    S.clockFrozen = true;
    S.clock = start.toISOString();
    S.schedulerLastRun = start.toISOString();
    let processed = 0, skipped = 0;
    try {
      const weekdays = [];
      for (let d = 0; d <= this.DAYS; d++) { const day = U.addDays(start, d); if (!U.isWeekend(day)) weekdays.push(day); }
      const per = this.TARGET / weekdays.length;
      weekdays.forEach(day => {
        const k = Math.floor(per) + (this.chance(per % 1) ? 1 : 0);
        for (let j = 0; j < k; j++) this.at(this.timeOn(day, 8, 15.5), () => this.capture());
      });
      // Applications that stop at a stage on purpose, captured far enough back for their steps to finish by today.
      const lately = weekdays.filter(day => { const age = U.daysBetween(day, this.realNow); return age >= 10 && age <= 30; });
      this.STAGES.forEach(stop => {
        for (let j = 0; j < this.PER_STAGE; j++) this.at(this.timeOn(this.pick(lately), 8, 15.5), () => this.capture(stop));
      });
      // A week before today, put a few awaiting-documents items into each stage so every stage is represented.
      this.at(this.timeOn(U.addDays(U.startOfDay(this.realNow), -8)), () => {
        const pend = S.apps.filter(a => a.recon?.status === 'PENDING').sort((x, y) => x.recon.dueDate.localeCompare(y.recon.dueDate));
        ['SUBMITTED', 'SUBMITTED', 'SUBMITTED', 'REVIEW', 'REVIEW', 'REVIEW', 'RETURNED', 'RETURNED', 'DECLINED', 'DECLINED', 'END'].forEach((stop, i) => { if (pend[i]) this.reconcile(pend[i].id, 1, stop); });
      });
      let curDay = U.dayKey(start);
      const nowMs = +this.realNow;
      while (this.queue.length && this.queue[0].t <= nowMs) {
        const ev = this.queue.shift();
        const dk = U.dayKey(new Date(ev.t));
        while (curDay < dk) {          // run the daily reminders/forfeits for each day passed
          const next = U.addDays(U.parseDay(curDay), 1);
          curDay = U.dayKey(next);
          next.setHours(7, 0, 0, 0);
          S.clock = next.toISOString();
          scheduler();
        }
        S.clock = new Date(ev.t).toISOString();
        try { ev.fn(); processed++; } catch (e) { skipped++; if (!(e instanceof WorkflowError)) console.warn(e); }
        if ((processed + skipped) % 150 === 0) {
          progress(`Working through the last 6 months… ${U.fmtDate(S.clock)} – ${S.apps.length} applications`);
          await new Promise(r => setTimeout(r));
        }
      }
      S.clock = this.realNow.toISOString();
      scheduler();
    } finally {
      S.clockFrozen = false;
      S.currentUserId = admin.id;
      pause(false);
    }
    if (this.debug.length) console.warn('Test data: some submissions failed validation', this.debug);
    Store.audit('TEST_DATA_LOADED', null, `${S.apps.length} test transactions and ${Object.keys(this.staff.inputter).length * 2 + 4} test users created (${processed} workflow steps, ${skipped} skipped)`);
    const apps = S.apps.length;
    if (hosted) {
      progress('Saving to the database…');
      await Live.flush((i, n) => progress(`Saving to the database… ${i.toLocaleString()} / ${n.toLocaleString()} records`));
      await Live.load();
    } else {
      Store.save();
    }
    progress(`Done: ${apps} applications.`);
    return { apps, processed, skipped };
  },
};
