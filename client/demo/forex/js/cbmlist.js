'use strict';

/* Central bank list of unreconciled items (all banks in Malawi).

   Treasury, Exchange Control and administrators (or anyone the administrator grants "Upload the central bank list")
   upload the list the central bank circulates, as an Excel workbook (.xlsx) or CSV. The columns are recognised from
   the headings and can be corrected before the list is saved; the new list replaces the previous one.

   Applications of the types that need reconciliation (advance payments by default; Administration can add others on
   the list page) are checked against it while they are captured and authorised: the same ID number, or a similar
   name (the account name and the CBS customer name; legal words such as Ltd are ignored and small spelling
   differences allowed). A match is kept on the application and flagged on it until the end. To submit, the inputter
   resolves every match: either ticks that the client's ID is different from the listed entry (not possible when the
   ID is the same), or records that the other bank confirmed the client has reconciled and uploads that bank's email
   or clearance letter. The authoriser sees the matches and the evidence. */

ACCESS_FIXED.push(
  ['act.cbmList', 'Actions', 'Upload the central bank list', 'Upload the list of unreconciled items circulated by the central bank (Excel or CSV).', ['TREASURY', 'EC', 'ADMIN']],
);
DOC_TYPES.CBM_CLEARANCE = 'Other bank\'s confirmation of reconciliation (central bank list)';
DOC_TYPES.CBM_LIST = 'Central bank list of unreconciled items';
Object.assign(DEFAULT_SETTINGS, { cbmTypes: ['ADVANCE'], cbmSensitivity: 0.85 });

/* The columns of the central bank's list, in its order (BANK, BRANCH, APPLICANT, EC NO, CURRENCY, AMOUNT, PAYMENT DATE,
   BENEFICIARY, DUE DATE, PASSPORT ID NO/NATIONAL ID, ADRESS, EMAIL, PHONE NO), then ACCOUNT NO and OUR REF: added by
   the bank for its own clients (in the file, or on the list page) so they are flagged on the account itself and on the
   client of the application it refers to (this system's reference, e.g. MZU-FX261107-042). */
const CBM_FIELDS = [
  ['b', 'Bank', 'BANK'], ['br', 'Branch', 'BRANCH'], ['n', 'Applicant', 'APPLICANT'], ['r', 'EC no', 'EC NO'], ['c', 'Currency', 'CURRENCY'],
  ['m', 'Amount', 'AMOUNT'], ['d', 'Payment date', 'PAYMENT DATE'], ['ben', 'Beneficiary', 'BENEFICIARY'], ['u', 'Due date', 'DUE DATE'],
  ['i', 'Passport / national ID no', 'PASSPORT ID NO/NATIONAL ID'], ['ad', 'Address', 'ADRESS'], ['em', 'Email', 'EMAIL'], ['ph', 'Phone no', 'PHONE NO'],
  ['a', 'Account no (our clients)', 'ACCOUNT NO'], ['fx', 'Our application ref', 'OUR REF'], ['s', 'Status / remarks', 'REMARKS'],
];

const Cbm = {
  /* ---------- reading the file ---------- */
  async readFile(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    if (buf[0] === 0x50 && buf[1] === 0x4b) return this.readXlsx(buf);
    if (buf[0] === 0xd0 && buf[1] === 0xcf) throw new WorkflowError('This is an old Excel 97-2003 file (.xls). Open it in Excel and save it as an Excel workbook (.xlsx) or CSV, then upload that.');
    let text = new TextDecoder('utf-8').decode(buf).replace(/^﻿/, '');
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
    return this.parseCsv(text);
  },

  parseCsv(text) {
    const first = text.split(/\r?\n/, 1)[0] || '';
    const sep = [',', ';', '\t'].sort((x, y) => first.split(y).length - first.split(x).length)[0];
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.map(r => r.map(x => x.trim()));
  },

  /* .xlsx is a zip of XML parts: the first worksheet is read, with shared strings and date formats. */
  async readXlsx(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), files = {};
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new WorkflowError('The file could not be read as an Excel workbook. Save it again as .xlsx or CSV.');
    let p = dv.getUint32(eocd + 16, true);
    const count = dv.getUint16(eocd + 10, true), dec = new TextDecoder();
    for (let n = 0; n < count && dv.getUint32(p, true) === 0x02014b50; n++) {
      const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true), nameLen = dv.getUint16(p + 28, true);
      const extra = dv.getUint16(p + 30, true), comment = dv.getUint16(p + 32, true), local = dv.getUint32(p + 42, true);
      files[dec.decode(buf.subarray(p + 46, p + 46 + nameLen))] = { method, size, local };
      p += 46 + nameLen + extra + comment;
    }
    const part = async name => {
      const f = files[name];
      if (!f) return null;
      const start = f.local + 30 + dv.getUint16(f.local + 26, true) + dv.getUint16(f.local + 28, true), data = buf.subarray(start, start + f.size);
      if (f.method === 0) return dec.decode(data);
      if (typeof DecompressionStream === 'undefined') throw new WorkflowError('This browser cannot open Excel files. Save the list as CSV and upload that, or use a current Edge or Chrome.');
      return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
    };
    const xml = s => new DOMParser().parseFromString(s, 'application/xml');
    const all = (doc, tag) => [...doc.getElementsByTagNameNS('*', tag)];
    // The first sheet in the workbook, through the workbook's relationships.
    let sheetPath = 'xl/worksheets/sheet1.xml';
    const wb = await part('xl/workbook.xml'), rels = await part('xl/_rels/workbook.xml.rels');
    if (wb && rels) {
      const s = all(xml(wb), 'sheet')[0], rid = s && (s.getAttribute('r:id') || [...s.attributes].find(a => a.localName === 'id')?.value);
      const rel = all(xml(rels), 'Relationship').find(r => r.getAttribute('Id') === rid);
      if (rel) { const t = rel.getAttribute('Target'); sheetPath = t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`; }
    }
    const sheet = await part(sheetPath);
    if (!sheet) throw new WorkflowError('The workbook has no worksheet that could be read.');
    const ssXml = await part('xl/sharedStrings.xml');
    const shared = ssXml ? all(xml(ssXml), 'si').map(si => all(si, 't').map(t => t.textContent).join('')) : [];
    // Cell styles that are dates (built-in date formats, or custom formats with day/month/year codes).
    const dateStyles = new Set();
    const stXml = await part('xl/styles.xml');
    if (stXml) {
      const st = xml(stXml), custom = {};
      all(st, 'numFmt').forEach(f => { custom[f.getAttribute('numFmtId')] = f.getAttribute('formatCode') || ''; });
      const xfs = all(st, 'cellXfs')[0];
      (xfs ? [...xfs.children] : []).forEach((xf, i) => {
        const id = Number(xf.getAttribute('numFmtId'));
        if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (custom[id] && /[dy]/i.test(custom[id].replace(/\[[^\]]*\]|"[^"]*"/g, '')))) dateStyles.add(i);
      });
    }
    const col = ref => [...String(ref).replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const rows = [];
    all(xml(sheet), 'row').forEach(r => {
      const out = [];
      all(r, 'c').forEach(c => {
        const t = c.getAttribute('t'), v = all(c, 'v')[0]?.textContent ?? '';
        let val = t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? all(c, 't').map(x => x.textContent).join('') : v;
        if (!t && v !== '' && dateStyles.has(Number(c.getAttribute('s')))) val = new Date(Date.UTC(1899, 11, 30) + Number(v) * 86400000).toISOString().slice(0, 10);
        out[c.getAttribute('r') ? col(c.getAttribute('r')) : out.length] = String(val).trim();
      });
      rows.push(Array.from(out, x => x ?? ''));
    });
    return rows;
  },

  /* ---------- columns ---------- */
  guessField(h) {
    const s = String(h || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!s) return '';
    if (/^ec\s*no\.?$|\bec\s*(no|number|ref)/.test(s)) return 'r';
    if (/our ref|fx ref|application ref|app\.? ref|forex ref/.test(s)) return 'fx';
    if (/beneficiar|payee|supplier/.test(s)) return 'ben';
    if (/(account|client|customer|importer|company|applicant) name|name of (client|customer|importer)/.test(s)) return 'n';
    if (/branch/.test(s)) return 'br';
    if (/\bbank\b|institution|reporting/.test(s)) return 'b';
    if (/account|a\/c/.test(s)) return 'a';
    if (/e-?mail/.test(s)) return 'em';
    if (/phone|mobile|\btel|cell/.test(s)) return 'ph';
    if (/addres|adress|location|physical/.test(s)) return 'ad';
    if (/\bid\b|national|passport|tpin|registration|reg\.? ?no|identity|certificate|cert\b|nrb/.test(s)) return 'i';
    if (/due|deadline|reconcil\w* by|expiry/.test(s)) return 'u';
    if (/ref|form|swift|mt103|transaction no|serial/.test(s)) return 'r';
    if (/currency|ccy|\bcur\b/.test(s)) return 'c';
    if (/amount|value|outstanding|usd|sum/.test(s)) return 'm';
    if (/date|paid on/.test(s)) return 'd';
    if (/name|client|customer|importer|entity|company|holder|applicant/.test(s)) return 'n';
    if (/status|remark|comment/.test(s)) return 's';
    return '';
  },

  /* The heading row is the one (of the first 15) where most columns are recognised. */
  detect(rows) {
    let best = { at: 0, map: {}, score: -1 };
    rows.slice(0, 15).forEach((r, at) => {
      const map = {};
      r.forEach((h, ci) => { const f = this.guessField(h); if (f && !(f in map)) map[f] = ci; });
      const score = Object.keys(map).length + ('n' in map ? 1 : 0);
      if (score > best.score) best = { at, map, score };
    });
    return best;
  },

  build(rows, at, map) {
    const get = (r, f) => (map[f] >= 0 && map[f] !== '' && map[f] != null ? String(r[map[f]] ?? '').trim() : '');
    return rows.slice(at + 1).map(r => {
      const x = {};
      CBM_FIELDS.forEach(([f]) => { const v = get(r, f); if (v) x[f] = v; });
      if (x.m) { const n = Number(String(x.m).replace(/[^\d.-]/g, '')); if (!isNaN(n)) x.m = n; }
      if (x.a) x.a = Engine.normAccount(x.a);
      if (x.fx) x.fx = String(x.fx).trim().toUpperCase();
      return x;
    }).filter(x => x.n || x.i);
  },

  /* ---------- matching ---------- */
  STOP: new Set(['LTD', 'LIMITED', 'PLC', 'CO', 'COMPANY', 'THE', 'AND', 'OF', 'INC', 'CORP', 'CORPORATION', 'TA', 'T', 'A', 'TRADING', 'AS', 'MR', 'MRS', 'MS', 'MISS', 'DR', 'PVT', 'PTY']),
  tokens(s) { return String(s || '').toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(t => t && !this.STOP.has(t)); },

  lev(a, b) {
    if (a === b) return 0;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  },

  /* 0–1: shared words (in any order, small misspellings allowed), and 0.9 when every word of a two-or-more-word name is in the other. */
  similarity(ta, tb) {
    if (!ta.length || !tb.length) return 0;
    if (ta.join(' ') === tb.join(' ')) return 1;
    const tokenScore = (x, y) => (x === y ? 1 : Math.min(x.length, y.length) >= 4 && 1 - this.lev(x, y) / Math.max(x.length, y.length) >= 0.8 ? 0.9 : 0);
    const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    const used = new Set();
    let sum = 0, found = 0;
    short.forEach(t => {
      let best = 0, bi = -1;
      long.forEach((u, i) => { if (used.has(i)) return; const s = tokenScore(t, u); if (s > best) { best = s; bi = i; } });
      if (bi >= 0) { used.add(bi); found++; }
      sum += best;
    });
    const dice = (2 * sum) / (ta.length + tb.length);
    return short.length >= 2 && found === short.length ? Math.max(dice, 0.9) : dice;
  },

  list() { return Store.state.cbmList?.rows?.length ? Store.state.cbmList : null; },

  prepared: null,
  prepare() {
    const L = this.list();
    if (!L) return [];
    const stamp = `${L.uploadedAt}|${L.editedAt || ''}`;   // account numbers added later change the matches
    if (this.prepared?.at === stamp) return this.prepared.rows;
    const rows = L.rows.map(r => ({ r, t: this.tokens(r.n), id: Engine.normId(r.i), k: this.key(r), acct: Engine.normAccount(r.a), ph: this.phoneKey(r.ph), em: String(r.em || '').trim().toLowerCase() }));
    this.prepared = { at: stamp, rows };
    this.cache = new Map();
    return rows;
  },

  key(r) { return `c${CBS.hash([r.n, r.i, r.b, r.r, ''].map(x => String(x || '').toUpperCase().trim()).join('|')).toString(36)}`; },   // without the account number, added later

  /* Is the entry one of this bank's own clients? */
  ours(r) {
    const word = String(Store.state.bank?.name || '').toUpperCase().split(/\s+/).find(w => w.length > 3 && !['BANK', 'LIMITED', 'MALAWI'].includes(w));
    return !!word && String(r.b || '').toUpperCase().includes(word);
  },
  /* Does the BRANCH on an entry name one of the user's branches? ("Lilongwe" names City Centre Lilongwe, Old Town
     Lilongwe…; "Mzuzu Branch" names Mzuzu). */
  branchOf(u, br) {
    const words = v => String(v || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\b(BRANCH|AGENCY|SERVICE CENTRE)\b/g, ' ').split(/\s+/).filter(Boolean);
    const want = words(br).join(' ');
    if (!want) return false;
    return Engine.branchesOf(u).map(id => Store.branch(id)).filter(Boolean).some(b => {
      const name = words(b.name).join(' ');
      return [b.code, b.shortName].some(x => x && String(x).toUpperCase() === want) || name === want || ` ${name} `.includes(` ${want} `) || ` ${want} `.includes(` ${name} `);
    });
  },
  /* Adding the client's account number or application reference to this bank's entry: Exchange Control, the branch
     named on the entry, and those who manage the list (Treasury, administrators or anyone given "Upload the central
     bank list"). */
  canAccount(r, u = Store.user()) {
    return !!u && this.ours(r) && (u.role === 'EC' || Access.has(u, 'act.cbmList') || this.branchOf(u, r.br));
  },

  appByRef(ref) {
    const r = String(ref || '').trim().toUpperCase();
    return r ? Store.state.apps.find(a => String(a.ref || '').toUpperCase() === r || String(a.formerRef || '').toUpperCase() === r) || null : null;
  },

  dayOf(v) {
    const t = String(v || '').trim();
    let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = t.match(/^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{4})/);
    return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
  },

  /* The entries table: search, filters (bank, branch, currency, due, this bank's entries with or without an account
     number or reference), the A–Z letter of the applicant, and the sort order. */
  filterRows(L, f) {
    const q = String(f.q || '').trim().toLowerCase(), today = U.dayKey(Store.now());
    const rows = L.rows.filter(r => {
      if (f.ours && !this.ours(r)) return false;
      if (f.bank && String(r.b || '') !== f.bank) return false;
      if (f.branch && String(r.br || '') !== f.branch) return false;
      if (f.ccy && String(r.c || '').toUpperCase() !== f.ccy) return false;
      const due = this.dayOf(r.u);
      if (f.due === 'overdue' && !(due && due < today)) return false;
      if (f.due === 'soon' && !(due && due >= today && U.daysBetween(today, due) <= 30)) return false;
      if (f.due === 'none' && due) return false;
      if (f.link === 'missing' && !(this.ours(r) && !r.a && !r.fx)) return false;
      if (f.link === 'linked' && !(r.a || r.fx)) return false;
      if (f.letter) {
        const first = String(r.n || '').trim().toUpperCase().replace(/^(MR|MRS|MS|MISS|DR|THE)\.?\s+/, '')[0] || '';
        if (f.letter === '#' ? /[A-Z]/.test(first) : first !== f.letter) return false;
      }
      return !q || Object.values(r).some(v => String(v).toLowerCase().includes(q));
    });
    const by = {
      az: (a, b) => String(a.n || '').localeCompare(String(b.n || '')), za: (a, b) => String(b.n || '').localeCompare(String(a.n || '')),
      due: (a, b) => (this.dayOf(a.u) || '9999').localeCompare(this.dayOf(b.u) || '9999'), paid: (a, b) => (this.dayOf(b.d) || '').localeCompare(this.dayOf(a.d) || ''),
      amount: (a, b) => (Number(b.m) || 0) - (Number(a.m) || 0), bank: (a, b) => String(a.b || '').localeCompare(String(b.b || '')) || String(a.n || '').localeCompare(String(b.n || '')),
    }[f.sort];
    return by ? rows.slice().sort(by) : rows;
  },

  phoneKey(v) { const d = String(v || '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : ''; },

  types() { return Store.state.settings.cbmTypes || ['ADVANCE']; },
  applies(app) { return this.types().includes(app.type); },
  preAuth(app) { return !app.status || ['DRAFT', 'RETURNED', 'PENDING_AUTH'].includes(app.status); },

  /* Entries on the current list that match the application's client. */
  cache: new Map(),
  live(app) {
    if (!this.list() || !this.applies(app)) return [];
    const rows = this.prepare(), c = app.customer || {};
    const names = [...new Set([c.name, c.cbs?.customerName].filter(x => String(x || '').trim()))];
    const id = Engine.normId(c.idNumber), level = Number(Store.state.settings.cbmSensitivity) || 0.85;
    const accts = new Set([Engine.normAccount(c.account), ...Engine.customerAccounts(c)].filter(Boolean));
    const phones = new Set(Engine.clientPhones(c).map(p => this.phoneKey(p)).filter(Boolean)), emails = new Set(Engine.clientEmails(c));
    const ck = `${this.prepared.at}|${app.id}|${names.join('|')}|${id}|${level}|${[...accts].join(',')}|${[...phones].join(',')}|${[...emails].join(',')}`;
    if (this.cache.has(ck)) return this.cache.get(ck);
    const toks = names.map(n => this.tokens(n));
    const out = [];
    rows.forEach(x => {
      const reasons = [];
      if (x.acct && accts.has(x.acct)) reasons.push(x.acct === Engine.normAccount(c.account) ? 'same account number' : 'account of the same customer number');
      const ra = x.r.fx && this.appByRef(x.r.fx);
      if (ra && ra.id !== app.id) {
        const rc = ra.customer || {}, rn = Engine.customerNo(rc);
        if (accts.has(Engine.normAccount(rc.account)) || (rn && rn === Engine.customerNo(c)) || (id.length >= 4 && Engine.normId(rc.idNumber) === id)) reasons.push(`same client as application ${ra.ref}`);
      } else if (ra && ra.id === app.id) reasons.push('this application');
      if (id.length >= 4 && x.id === id) reasons.push('same ID number');
      if (x.ph && phones.has(x.ph)) reasons.push('same phone number');
      if (x.em && emails.has(x.em)) reasons.push('same email');
      const score = Math.max(0, ...toks.map(t => this.similarity(t, x.t)));
      if (score >= level) reasons.push(score >= 0.999 ? 'same name' : `similar name (${Math.round(score * 100)}%)`);
      if (reasons.length) out.push({ k: x.k, row: x.r, reasons, score: Math.max(score, reasons.some(r => /account|ID|application/.test(r)) ? 1 : 0), foundAt: Store.now().toISOString(), listAt: this.prepared.at });
    });
    out.sort((a, b) => b.score - a.score);
    const res = out.slice(0, 20);
    this.cache.set(ck, res);
    return res;
  },

  /* Matches on the application. While it is captured or authorised: the current matches plus any already resolved;
     after that, the ones kept when it was last saved (they stay with it to the end). */
  flags(app) {
    const res = app.cbm?.resolutions || {};
    const kept = (app.cbm?.matches || []).filter(m => !this.preAuth(app) || res[m.k]);
    const byKey = new Map(kept.map(m => [m.k, m]));
    if (this.preAuth(app)) this.live(app).forEach(m => { if (!byKey.has(m.k)) byKey.set(m.k, m); });
    return [...byKey.values()].map(m => Object.assign({}, m, { resolution: res[m.k] || null }));
  },

  /* Before the form saves: keep the matches on the application. */
  capture(app) {
    if (!this.preAuth(app)) return;
    const matches = this.flags(app).map(({ resolution, ...m }) => m), res = app.cbm?.resolutions || {};
    app.cbm = matches.length || Object.keys(res).length ? { matches, resolutions: res, checkedAt: Store.now().toISOString(), listAt: this.list()?.uploadedAt || null } : null;
  },

  /* A match is resolved by "ID differs" (not when the ID is the same) or "cleared by the other bank" with the letter uploaded. */
  resolved(app, f) {
    const r = f.resolution;
    if (!r) return false;
    if (r.kind === 'ID_DIFFERENT') return !f.reasons.some(r => /ID number|account|application/.test(r));
    return r.kind === 'CLEARED' && (r.docIds || []).some(id => (app.documents || []).some(d => d.id === id));
  },
  unresolved(app) { return this.flags(app).filter(f => !this.resolved(app, f)); },

  describe(row) { return `"${row.n || '—'}"${row.i ? `, ID ${row.i}` : ''}${row.b ? ` (${row.b}${row.br ? `, ${row.br}` : ''})` : ''}${row.r ? `, EC no ${row.r}` : ''}${row.a ? `, account ${row.a}` : ''}${row.fx ? `, our ref ${row.fx}` : ''}${row.m ? `, ${row.c || ''} ${U.num(row.m)}` : ''}`; },
  details(row) { return [row.i && `ID ${row.i}`, row.b && `${row.b}${row.br ? ` – ${row.br}` : ''}`, row.a && `account ${row.a}`, row.fx && `our ref ${row.fx}`, row.r && `EC no ${row.r}`, row.m && `${row.c || ''} ${typeof row.m === 'number' ? U.num(row.m) : row.m}`, row.ben && `to ${row.ben}`, row.d && `paid ${row.d}`, row.u && `due ${row.u}`].filter(Boolean).join(' · '); },

  /* ---------- the list page (#/cbm) ---------- */
  page() {
    const u = Store.user();
    UI.setTitle('Central bank list', 'Unreconciled items at all banks');
    const L = this.list(), S = Store.state, e = U.esc, f = this.filter = this.filter || { q: '' };
    const flagged = S.apps.filter(a => a.cbm?.matches?.length && Engine.can('view', a)).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const canUp = Access.has(u, 'act.cbmList'), admin = u.role === 'ADMIN';
    const draw = () => {
      const rows = !L ? [] : this.filterRows(L, f);
      const distinct = k => !L ? [] : [...new Set(L.rows.map(r => String(r[k] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      const opts = (list, cur, all) => `<option value="">${all}</option>${list.map(v => `<option ${cur === v ? 'selected' : ''}>${e(v)}</option>`).join('')}`;
      const letters = !L ? new Set() : new Set(L.rows.map(r => (String(r.n || '').trim().toUpperCase().replace(/^(MR|MRS|MS|MISS|DR|THE)\.?\s+/, '')[0] || '')).map(ch => (/[A-Z]/.test(ch) ? ch : '#')));
      // Columns in the central bank's order; the account number always shows when this bank has entries.
      const cols = !L ? [] : CBM_FIELDS.filter(([k]) => L.rows.some(r => r[k] != null && r[k] !== '') || (['a', 'fx'].includes(k) && L.rows.some(r => this.ours(r))));
      document.getElementById('view').innerHTML = `
        <div class="grid g2" style="align-items:start;margin-bottom:16px">
          <div class="card"><div class="card-h"><h2>Current list</h2><span class="btn-row"><button class="btn-sm" id="cbm-tpl" title="CSV with the central bank's column headings">⇩ Template</button>${canUp && L ? '<button class="btn-sm btn-danger" id="cbm-clear">Clear list</button>' : ''}${canUp ? `<label class="btn btn-sm btn-primary upload-btn">⇪ Upload ${L ? 'more' : 'list'}<input type="file" id="cbm-file" accept=".xlsx,.csv,.txt,.xls"></label>` : ''}</span></div><div class="card-b">
            ${L ? `<dl class="kv"><dt>File</dt><dd>${e(L.fileName)}${L.file ? ` ${DocView.buttons(L.file)}` : ''}</dd><dt>Uploaded</dt><dd>${U.fmtDateTime(L.uploadedAt)} by ${e(L.uploadedByName)}</dd>
                <dt>Entries</dt><dd><b>${U.num(L.rows.length, 0)}</b> from ${new Set(L.rows.map(r => r.b).filter(Boolean)).size || '—'} bank(s)</dd>${L.note ? `<dt>Note</dt><dd>${e(L.note)}</dd>` : ''}</dl>`
              : `<div class="empty">${S.cbmList?.clearedAt ? `The list was cleared ${U.fmtDateTime(S.cbmList.clearedAt)} by ${e(S.cbmList.clearedByName || '')}.` : 'No list uploaded yet.'}</div>`}
            <p class="muted" style="margin:10px 0 0;font-size:12.5px">${e(this.types().map(t => TXN_TYPES[t]?.label || t).join(', ') || 'No')} applications are checked against the list for the same account number (including the customer's other accounts), ID number, phone or email, or a similar name. Add the account number or our application reference to this bank's own entries (ACCOUNT NO / OUR REF columns, or below – Exchange Control and the branch named on the entry) so its clients are flagged. A match must be resolved before the application can be submitted: the client's ID is different, or the other bank confirms the client has reconciled (its email or clearance letter is uploaded). ${canUp ? 'Excel workbooks (.xlsx) and CSV files can be uploaded: new entries are added and those already on the list are skipped, with a report. Clear list empties it.' : 'Treasury and Exchange Control upload the list.'}</p>
          </div></div>
          ${admin ? `<div class="card"><div class="card-h"><h2>Checking</h2><small>Administrator</small></div><div class="card-b">
            <div class="f"><span>Applications checked against the list</span><div style="display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:4px">${Object.entries(TXN_TYPES).map(([k, t]) => `<label class="btn-row" style="gap:5px"><input type="checkbox" data-cbt="${k}" ${this.types().includes(k) ? 'checked' : ''}> ${e(t.label)}</label>`).join('')}</div></div>
            <label class="f" style="margin-top:10px"><span>Name matching</span><select id="cbm-level">${[[0.92, 'Strict – nearly the same name'], [0.85, 'Normal (recommended)'], [0.78, 'Broad – more possible matches to check']].map(([v, l]) => `<option value="${v}" ${Number(S.settings.cbmSensitivity || 0.85) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <button class="btn-primary btn-sm" id="cbm-set" style="margin-top:8px">Save</button></div></div>` : ''}
        </div>
        <div class="card" style="margin-bottom:16px"><div class="card-h"><h2>Applications matched to the list</h2><small>${flagged.length}</small></div><div class="card-b tight"><div class="table-wrap"><table>
          <thead><tr><th>Reference</th><th>Client</th><th>Status</th><th>Matched entries</th><th>Resolved</th><th></th></tr></thead>
          <tbody>${flagged.map(a => { const fl = this.flags(a), open = fl.filter(x => !this.resolved(a, x)).length;
            return `<tr><td class="mono">${e(a.ref)}</td><td>${e(a.customer?.name)}<br><small class="mono">${e(a.customer?.account)}</small></td><td>${UI.badge(a.status)}</td>
              <td><small>${fl.map(x => `${e(x.row.n)} – ${e(x.reasons.join(', '))}`).join('<br>')}</small></td><td>${open ? UI.tag(`${open} open`, 'red') : UI.tag('All resolved', 'green')}</td><td><a class="btn btn-sm" href="#/app/${a.id}">Open</a></td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">No application has matched the list.</td></tr>'}</tbody>
        </table></div></div></div>
        ${L ? `<div class="card"><div class="card-h"><h2>Entries</h2><small>${U.num(rows.length, 0)} of ${U.num(L.rows.length, 0)}</small></div>
          <div class="card-b" style="padding-bottom:6px">
            <div class="toolbar" style="flex-wrap:wrap;gap:8px;margin:0 0 8px">
              <input type="search" id="cbm-q" value="${e(f.q || '')}" placeholder="Search applicant, ID, bank, EC no, account, reference" style="min-width:260px;flex:1 1 260px">
              <select data-cf="bank" aria-label="Bank">${opts(distinct('b'), f.bank, 'All banks')}</select>
              <select data-cf="branch" aria-label="Branch">${opts(distinct('br'), f.branch, 'All branches')}</select>
              <select data-cf="ccy" aria-label="Currency">${opts(distinct('c').map(x => x.toUpperCase()).filter((x, i, a) => a.indexOf(x) === i), f.ccy, 'All currencies')}</select>
              <select data-cf="due" aria-label="Due date">${[['', 'Any due date'], ['overdue', 'Overdue'], ['soon', 'Due within 30 days'], ['none', 'No due date']].map(([v, l]) => `<option value="${v}" ${f.due === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
              <select data-cf="link" aria-label="Account or reference">${[['', 'Linked or not'], ['missing', `${e(String(S.bank?.name || 'Our bank'))} – no account or ref yet`], ['linked', 'With an account or ref']].map(([v, l]) => `<option value="${v}" ${f.link === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
              <select data-cf="sort" aria-label="Sort">${[['', 'As uploaded'], ['az', 'Applicant A–Z'], ['za', 'Applicant Z–A'], ['bank', 'Bank, then applicant'], ['due', 'Due date (soonest)'], ['paid', 'Payment date (latest)'], ['amount', 'Amount (largest)']].map(([v, l]) => `<option value="${v}" ${(f.sort || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
              <label class="btn-row" style="gap:5px"><input type="checkbox" id="cbm-ours" ${f.ours ? 'checked' : ''}> ${e(String(S.bank?.name || 'Our bank'))} only</label>
              ${['q', 'bank', 'branch', 'ccy', 'due', 'link', 'letter', 'ours', 'sort'].some(k => f[k]) ? '<button class="btn-sm" id="cbm-reset">Clear filters</button>' : ''}
            </div>
            <div class="pill-group" style="flex-wrap:wrap" aria-label="Applicant starts with"><button data-letter="" class="${!f.letter ? 'on' : ''}">All</button>${'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('').map(ch => `<button data-letter="${ch}" class="${f.letter === ch ? 'on' : ''}" ${letters.has(ch) ? '' : 'disabled style="opacity:.35"'}>${ch === '#' ? '0–9' : ch}</button>`).join('')}</div>
          </div>
          <div class="card-b tight"><div class="table-wrap"><table>
          <thead><tr>${cols.map(([k, l]) => `<th>${e(l)}</th>`).join('')}</tr></thead>
          <tbody>${rows.slice(0, 300).map(r => `<tr>${cols.map(([k]) => k === 'a' && this.canAccount(r, u)
            ? `<td><span class="btn-row" style="flex-wrap:nowrap;gap:4px"><input data-acct="${L.rows.indexOf(r)}" value="${e(r.a || '')}" placeholder="Add account no" inputmode="numeric" style="width:120px"><button class="btn-sm" data-acct-save="${L.rows.indexOf(r)}">Save</button></span></td>`
            : k === 'fx' && this.canAccount(r, u)
            ? `<td><span class="btn-row" style="flex-wrap:nowrap;gap:4px"><input data-fx="${L.rows.indexOf(r)}" value="${e(r.fx || '')}" placeholder="Add our ref" style="width:150px;text-transform:uppercase"><button class="btn-sm" data-fx-save="${L.rows.indexOf(r)}">Save</button></span>${(a => a ? `<br><a href="#/app/${a.id}"><small>${e(a.customer?.name || '')}</small></a>` : '')(this.appByRef(r.fx))}</td>`
            : k === 'fx' && r.fx ? `<td>${(a => a ? `<a href="#/app/${a.id}" class="mono">${e(r.fx)}</a>` : `<span class="mono">${e(r.fx)}</span>`)(this.appByRef(r.fx))}</td>`
            : `<td${k === 'm' ? ' class="num"' : ''}>${k === 'm' && typeof r[k] === 'number' ? U.num(r[k]) : e(r[k] ?? '')}</td>`).join('')}</tr>`).join('') || `<tr><td class="empty" colspan="${cols.length}">No entries match.</td></tr>`}</tbody>
          </table></div>${rows.length > 300 ? `<div class="muted" style="padding:8px 12px">Showing 300 of ${U.num(rows.length, 0)} – search to narrow down.</div>` : ''}</div></div>` : ''}
        ${S.cbmList?.history?.length ? `<div class="card" style="margin-top:16px"><div class="card-h"><h2>Uploads and clearing</h2></div><div class="card-b tight"><div class="table-wrap"><table><thead><tr><th>File</th><th>When</th><th>By</th><th class="num">Added</th><th class="num">Skipped</th><th class="num">On the list after</th></tr></thead><tbody>
          ${S.cbmList.history.map(h => `<tr><td>${e(h.fileName)}</td><td>${U.fmtDateTime(h.uploadedAt)}</td><td>${e(h.uploadedByName)}</td><td class="num">${h.removed ? `<span class="muted">${U.num(h.removed, 0)} removed</span>` : h.added != null ? U.num(h.added, 0) : '—'}</td><td class="num">${h.skipped != null ? U.num(h.skipped, 0) : '—'}</td><td class="num">${U.num(h.rows, 0)}</td></tr>`).join('')}</tbody></table></div></div></div>` : ''}`;
      U.$('#cbm-q')?.addEventListener('input', ev => { f.q = ev.target.value; draw(); const n = U.$('#cbm-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
      U.$$('#view [data-cf]').forEach(sel => sel.addEventListener('change', () => { f[sel.dataset.cf] = sel.value; draw(); }));
      U.$$('#view [data-letter]').forEach(b => b.addEventListener('click', () => { f.letter = b.dataset.letter; draw(); }));
      U.$('#cbm-reset')?.addEventListener('click', () => { Object.keys(f).forEach(k => { f[k] = k === 'q' ? '' : k === 'ours' ? false : ''; }); draw(); });
      U.$('#cbm-file')?.addEventListener('change', ev => { const file = ev.target.files[0]; if (file) this.upload(file); });
      U.$('#cbm-ours')?.addEventListener('change', ev => { f.ours = ev.target.checked; draw(); });
      U.$('#cbm-clear')?.addEventListener('click', () => UI.modal({
        title: 'Clear the central bank list',
        body: `<p style="margin-top:0">All <b>${U.num(L.rows.length, 0)}</b> entries will be removed, including the account numbers and references added to this bank's entries. Matches already on applications stay on them. The upload history is kept.</p><label class="f"><span>Reason <b class="req">*</b></span><input name="reason" placeholder="e.g. superseded by the RBM circular of 30 November"></label>`,
        actions: [{ label: 'Clear list', cls: 'btn-danger', onClick: el => {
          const reason = UI.formData(el).reason.trim();
          if (!reason) { UI.toast('Give the reason for clearing the list.', 'error'); return false; }
          try { this.clear(reason); } catch (err) { UI.error(err); return false; }
          UI.toast('The central bank list was cleared.', 'ok');
          this.page(); App.renderChrome();
        } }],
      }));
      U.$('#cbm-tpl').addEventListener('click', () => {
        const csv = '\uFEFF' + CBM_FIELDS.filter(([k]) => k !== 's').map(([, , h]) => h).join(',') + '\r\n';
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        a.download = 'central-bank-list-template.csv';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      });
      U.$$('#view [data-fx-save]').forEach(b => b.addEventListener('click', () => {
        const i = Number(b.dataset.fxSave), v = U.$(`#view [data-fx="${i}"]`).value.trim();
        try { this.setRef(i, v); UI.toast(v ? `Reference ${v.toUpperCase()} added to ${L.rows[i].n}.` : `Reference removed from ${L.rows[i].n}.`, 'ok'); } catch (err) { UI.error(err); }
        draw();
      }));
      U.$$('#view [data-acct-save]').forEach(b => b.addEventListener('click', () => {
        const i = Number(b.dataset.acctSave), v = U.$(`#view [data-acct="${i}"]`).value.trim();
        try { this.setAccount(i, v); UI.toast(v ? `Account ${v} added to ${L.rows[i].n}.` : `Account number removed from ${L.rows[i].n}.`, 'ok'); } catch (err) { UI.error(err); }
        draw();
      }));
      U.$('#cbm-set')?.addEventListener('click', () => {
        const types = U.$$('[data-cbt]').filter(x => x.checked).map(x => x.dataset.cbt);
        Object.assign(S.settings, { cbmTypes: types, cbmSensitivity: Number(U.$('#cbm-level').value) });
        Store.audit('SETTINGS_UPDATED', null, `Central bank list checks: ${types.join(', ') || 'none'}; name matching ${U.$('#cbm-level').selectedOptions[0].textContent}`);
        this.cache = new Map(); Store.save(); UI.toast('Saved.', 'ok');
      });
      if (L?.file) DocView.bind(U.$('#view'), [L.file]);
    };
    draw();
  },

  /* The same entry twice: same bank, EC no, payment date, amount and currency (or, without an EC no, the same applicant
     and ID on that date for that amount). */
  dupKey(r) {
    const n = v => String(v ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
    const amt = typeof r.m === 'number' ? r.m.toFixed(2) : n(r.m).replace(/[^\d.]/g, '');
    return r.r ? `R|${n(r.b)}|${n(r.r).replace(/\s+/g, '')}|${n(r.d)}|${amt}|${n(r.c)}` : `N|${n(r.b)}|${this.tokens(r.n).join(' ')}|${Engine.normId(r.i)}|${n(r.d)}|${amt}|${n(r.c)}`;
  },

  /* What a file would add to the current list: new entries, entries already on the list, and entries repeated in the file. */
  mergePlan(built) {
    const have = new Set((Store.state.cbmList?.rows || []).map(r => this.dupKey(r))), seen = new Set(), added = [], onList = [], repeated = [];
    built.forEach(r => {
      const k = this.dupKey(r);
      if (have.has(k)) onList.push(r);
      else if (seen.has(k)) repeated.push(r);
      else { seen.add(k); added.push(r); }
    });
    return { added, onList, repeated };
  },

  async upload(file) {
    let rows;
    try { rows = await this.readFile(file); } catch (err) { UI.error(err); return; }
    rows = rows.filter(r => r.some(x => String(x).trim()));
    if (rows.length < 2) { UI.toast('The file has no rows to read.', 'error'); return; }
    const det = this.detect(rows), width = Math.max(...rows.slice(0, 50).map(r => r.length)), e = U.esc;
    const heads = rows[det.at], dataRows = rows.length - det.at - 1;
    const preview = map => {
      const built = this.build(rows, det.at, map), plan = this.mergePlan(built), noName = dataRows - built.length;
      return { built, plan, noName, html: `<div class="alert ${plan.added.length ? 'info' : 'warn'}" style="margin:10px 0"><div><b>${U.num(plan.added.length, 0)} new entr${plan.added.length === 1 ? 'y' : 'ies'} will be added</b> to the ${U.num(this.list()?.rows.length || 0, 0)} on the list.
          ${plan.onList.length ? `<br>${U.num(plan.onList.length, 0)} already on the list will be skipped (same bank, EC no, payment date, amount and currency).` : ''}
          ${plan.repeated.length ? `<br>${U.num(plan.repeated.length, 0)} repeated in this file will be skipped.` : ''}
          ${noName ? `<br>${U.num(noName, 0)} row(s) without an applicant or ID will be skipped.` : ''}</div></div>
        <div class="muted" style="margin:0 0 6px">First new entries:</div>
        <div class="table-wrap"><table><thead><tr>${CBM_FIELDS.map(([, l]) => `<th>${e(l)}</th>`).join('')}</tr></thead><tbody>${plan.added.slice(0, 8).map(r => `<tr>${CBM_FIELDS.map(([k]) => `<td><small>${e(r[k] ?? '')}</small></td>`).join('')}</tr>`).join('') || `<tr><td colspan="${CBM_FIELDS.length}" class="empty">Nothing new in this file.</td></tr>`}</tbody></table></div>` };
    };
    UI.modal({
      title: `Upload central bank list – ${file.name}`, wide: true,
      body: `<p style="margin-top:0">Headings found on row ${det.at + 1}. Check which column holds each item. New entries are added to the list; entries already on it are skipped, and the account numbers and references added to this bank's entries are kept. To start again from an empty list, use <b>Clear list</b> first.</p>
        <div class="grid g3">${CBM_FIELDS.map(([k, l]) => `<label class="f"><span>${e(l)}${k === 'n' ? ' <b class="req">*</b>' : ''}</span><select data-map="${k}"><option value="">— not in the file —</option>
          ${Array.from({ length: width }, (_, ci) => `<option value="${ci}" ${det.map[k] === ci ? 'selected' : ''}>${e(heads[ci] || `Column ${ci + 1}`)}</option>`).join('')}</select></label>`).join('')}</div>
        <label class="f"><span>Note (optional)</span><input id="cbm-note" placeholder="e.g. RBM circular of 31 October 2026"></label>
        <div id="cbm-prev"></div>`,
      onOpen: el => {
        const redraw = () => { el.querySelector('#cbm-prev').innerHTML = preview(this.mapFrom(el)).html; };
        el.querySelectorAll('[data-map]').forEach(sel => sel.addEventListener('change', redraw));
        redraw();
      },
      actions: [{ label: 'Add to the list', onClick: async el => {
        const map = this.mapFrom(el);
        if (!(map.n >= 0)) { UI.toast('Choose the column with the applicant.', 'error'); return false; }
        const p = preview(map);
        if (!p.built.length) { UI.toast('No entries with an applicant or ID were found.', 'error'); return false; }
        const report = await this.save(file, p.plan, el.querySelector('#cbm-note').value.trim(), p.noName);
        this.page(); App.renderChrome();
        this.showReport(report);
      } }],
    });
  },

  /* The report for the one who uploaded: what was added and what was skipped, and why; downloadable as CSV. */
  showReport(rep) {
    const e = U.esc, lines = [...rep.added.map(r => ['Added', r]), ...rep.onList.map(r => ['Skipped – already on the list', r]), ...rep.repeated.map(r => ['Skipped – repeated in the file', r])];
    const cols = CBM_FIELDS.filter(([k]) => lines.some(([, r]) => r[k] != null && r[k] !== ''));
    UI.modal({
      title: `Upload report – ${rep.fileName}`, wide: true, closeLabel: 'Close',
      body: `<div class="kpis" style="margin-bottom:12px">
          <div class="kpi green"><div class="v">${U.num(rep.added.length, 0)}</div><div class="l">Added</div></div>
          <div class="kpi amber"><div class="v">${U.num(rep.onList.length, 0)}</div><div class="l">Skipped – already on the list</div></div>
          <div class="kpi"><div class="v">${U.num(rep.repeated.length, 0)}</div><div class="l">Skipped – repeated in the file</div></div>
          <div class="kpi"><div class="v">${U.num(rep.noName, 0)}</div><div class="l">Skipped – no applicant or ID</div></div>
          <div class="kpi violet"><div class="v">${U.num(rep.total, 0)}</div><div class="l">Entries on the list now</div></div></div>
        <p class="muted" style="margin-top:0">Uploaded ${U.fmtDateTime(rep.at)} by ${e(rep.by)}. The report is also in the audit trail.</p>
        <div class="table-wrap" style="max-height:340px;overflow:auto"><table><thead><tr><th>Result</th>${cols.map(([, l]) => `<th>${e(l)}</th>`).join('')}</tr></thead>
          <tbody>${lines.slice(0, 300).map(([st, r]) => `<tr><td>${UI.tag(st, st === 'Added' ? 'green' : 'amber')}</td>${cols.map(([k]) => `<td><small>${e(k === 'm' && typeof r[k] === 'number' ? U.num(r[k]) : r[k] ?? '')}</small></td>`).join('')}</tr>`).join('') || '<tr><td class="empty">Nothing to show.</td></tr>'}</tbody></table></div>
        ${lines.length > 300 ? `<div class="muted" style="margin-top:6px">Showing 300 of ${U.num(lines.length, 0)} – download the report for all.</div>` : ''}`,
      actions: [{ label: '⇩ Download report (CSV)', cls: '', onClick: () => {
        const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const csv = '\uFEFF' + [['RESULT', ...cols.map(([, , h]) => h)].map(q).join(','), ...lines.map(([st, r]) => [st, ...cols.map(([k]) => r[k])].map(q).join(','))].join('\r\n') + '\r\n';
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        a.download = `central-bank-list-upload-report-${U.dayKey(Store.now())}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        return false;
      } }],
    });
  },

  /* Empties the list (the upload history is kept). Matches already kept on applications stay on them. */
  clear(reason) {
    if (!Access.has(Store.user(), 'act.cbmList')) throw new WorkflowError('You cannot change the central bank list.');
    const S = Store.state, u = Store.user(), prev = S.cbmList;
    if (!prev?.rows?.length) throw new WorkflowError('The list is already empty.');
    const history = [{ fileName: `Cleared – ${reason || 'no reason given'}`, uploadedAt: Store.now().toISOString(), uploadedByName: u.name, rows: 0, removed: prev.rows.length }, ...(prev.history || [])].slice(0, 30);
    S.cbmList = { rows: [], history, clearedAt: Store.now().toISOString(), clearedBy: u.id, clearedByName: u.name };
    this.prepared = null;
    Store.audit('CBM_LIST_CLEARED', null, `Central bank list cleared: ${prev.rows.length} entries removed${reason ? `. Reason: ${reason}` : ''}`);
    Store.save();
  },

  /* This bank's own entry: the reference of the client's application in this system (its current or former reference),
     so every application of that client is flagged. Same people as for the account number. */
  setRef(i, value) {
    const L = this.list(), r = L?.rows[i];
    if (!r) throw new WorkflowError('That entry is no longer on the list.');
    if (!this.canAccount(r)) throw new WorkflowError(`Only Exchange Control or staff of ${r.br || 'the branch named on the entry'} can add the reference.`);
    const ref = String(value || '').trim().toUpperCase();
    if (ref && !this.appByRef(ref)) throw new WorkflowError(`No application has the reference ${ref}. Check it in All applications.`);
    if (ref) r.fx = ref; else delete r.fx;
    L.editedAt = Store.now().toISOString();   // every browser matches again with the reference
    Store.audit('CBM_LIST_ACCOUNT', null, `Central bank list: application reference ${ref || '(removed)'} for ${r.n}${r.r ? `, EC no ${r.r}` : ''}`);
    Store.save();
  },

  /* This bank's own entry: the account number of the client, so the account itself is flagged. */
  setAccount(i, value) {
    const L = this.list(), r = L?.rows[i];
    if (!r) throw new WorkflowError('That entry is no longer on the list.');
    if (!this.canAccount(r)) throw new WorkflowError(`Only Exchange Control or staff of ${r.br || 'the branch named on the entry'} can add the account number.`);
    const no = Engine.normAccount(value);
    if (no && !/^\d{6,16}$/.test(no)) throw new WorkflowError('Enter the account number as 6 to 16 digits.');
    if (no) r.a = no; else delete r.a;
    L.editedAt = Store.now().toISOString();   // every browser matches again with the account number
    Store.audit('CBM_LIST_ACCOUNT', null, `Central bank list: account ${no || '(removed)'} for ${r.n}${r.r ? `, EC no ${r.r}` : ''}`);
    Store.save();
  },

  mapFrom(el) { const map = {}; el.querySelectorAll('[data-map]').forEach(s => { if (s.value !== '') map[s.dataset.map] = Number(s.value); }); return map; },

  async save(file, plan, note, noName = 0) {
    if (!Access.has(Store.user(), 'act.cbmList')) throw new WorkflowError('You cannot upload the central bank list.');
    const S = Store.state, u = Store.user(), prev = S.cbmList, at = Store.now().toISOString();
    let stored = null;
    try { stored = await Form.storeFile(file, 'CBM_LIST'); } catch (err) { UI.toast(`The list is saved, but the original file could not be kept: ${err.message}`, 'error'); }
    const rows = [...(prev?.rows || []), ...plan.added];   // entries already on the list keep their account numbers
    const entry = { fileName: file.name, uploadedAt: at, uploadedByName: u.name, rows: rows.length, added: plan.added.length, skipped: plan.onList.length + plan.repeated.length + noName };
    S.cbmList = { fileName: file.name, uploadedAt: at, uploadedBy: u.id, uploadedByName: u.name, note, file: stored, rows, history: [entry, ...(prev?.history || [])].slice(0, 30) };
    this.prepared = null;
    Store.audit('CBM_LIST_UPLOADED', null, `Central bank list uploaded: ${file.name} – ${plan.added.length} added, ${plan.onList.length} already on the list, ${plan.repeated.length} repeated in the file, ${noName} without an applicant or ID; ${rows.length} entries on the list`);
    Store.save();
    return Object.assign({ fileName: file.name, at, by: u.name, noName, total: rows.length }, plan);
  },

  /* ---------- on the capture form ---------- */
  renderForm() {
    const app = Form.app, side = U.$('.side');
    if (!app || !side) return;
    const flags = this.flags(app);
    let card = U.$('#cbm-card');
    if (!card) {
      (U.$('#unrec-card') || side.firstElementChild).insertAdjacentHTML('afterend', '<div class="card hidden" id="cbm-card" style="border-color:var(--red-line, #f6c3c8)"><div class="card-h" style="background:var(--red-50)"><h2 style="color:var(--red-ink, #8d1220)">Central bank list</h2><small id="cbm-sum"></small></div><div class="card-b" id="cbm-body"></div></div>');
      card = U.$('#cbm-card');
    }
    const sig = JSON.stringify([flags.map(f => f.k), app.cbm?.resolutions, (app.documents || []).map(d => d.id)]);
    card.classList.toggle('hidden', !flags.length);
    if (sig === this.formSig) return;
    this.formSig = sig;
    if (!flags.length) return;
    const e = U.esc, editable = ['DRAFT', 'RETURNED', 'PENDING_AUTH'].includes(app.status || 'DRAFT');
    const open = flags.filter(f => !this.resolved(app, f)).length;
    U.$('#cbm-sum').textContent = open ? `${open} to resolve` : 'Resolved';
    U.$('#cbm-body').innerHTML = `<div class="alert ${open ? 'error' : 'ok'}" style="margin-bottom:10px"><div>${open ? '<b>Possible unreconciled item at another bank.</b> The client matches the central bank list. Resolve each match below to submit the application.' : 'Every match has been resolved. The flag stays on the application to the end.'}</div></div>
      ${flags.map(f => {
        const r = f.resolution, sameId = f.reasons.some(x => /ID number|account|application/.test(x)), docs = (r?.docIds || []).map(id => app.documents.find(d => d.id === id)).filter(Boolean);
        return `<div class="doc-slot ${this.resolved(app, f) ? '' : 'missing'}" style="margin-bottom:8px"><div><b>${e(f.row.n || '—')}</b> <small>${e(f.reasons.join(' · '))}</small></div>
          <small>${e(this.details(f.row))}</small>
          ${r ? `<div style="margin-top:6px">${UI.tag(r.kind === 'CLEARED' ? 'Other bank confirmed reconciled' : 'Client ID is different', this.resolved(app, f) ? 'green' : 'amber')} <small>${e(r.name)} · ${U.fmtDateTime(r.at)}</small>
              ${docs.map(d => `<div class="file"><span>📄</span><span class="name">${e(d.name)}</span>${DocView.buttons(d)}</div>`).join('')}${r.kind === 'CLEARED' && !docs.length ? '<div class="alert warn" style="margin-top:4px">Upload the other bank\'s email or clearance letter.</div>' : ''}
              ${editable ? `<button type="button" class="btn-sm" data-cbm-undo="${f.k}" style="margin-top:4px">Undo</button>` : ''}</div>`
            : editable ? `<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
              <label class="btn-row" style="gap:6px;align-items:flex-start${sameId ? ';opacity:.55' : ''}"><input type="checkbox" data-cbm-id="${f.k}" ${sameId ? 'disabled' : ''}> <span>I have checked the client's ID document: <b>the client's ID is different</b> from this entry${sameId ? ' <small>(not possible – the ID, account or application is the same)</small>' : ''}</span></label>
              <label class="btn btn-sm upload-btn" style="justify-content:center">⇪ Other bank confirmed reconciled – upload its email or letter<input type="file" data-cbm-clear="${f.k}" accept=".pdf,image/*,.msg,.eml,.doc,.docx,.txt"></label></div>` : ''}
        </div>`;
      }).join('')}`;
    DocView.bind(U.$('#cbm-body'), app.documents);
    const resolve = (k, kind, docIds = []) => {
      const u = Store.user(), f = flags.find(x => x.k === k);
      app.cbm = app.cbm || { matches: [], resolutions: {} };
      if (f && !app.cbm.matches.some(m => m.k === k)) app.cbm.matches.push({ k, row: f.row, reasons: f.reasons, score: f.score, foundAt: f.foundAt, listAt: f.listAt });
      app.cbm.resolutions = app.cbm.resolutions || {};
      app.cbm.resolutions[k] = { kind, at: Store.now().toISOString(), by: u.id, name: u.name, docIds, label: f?.row.n || '' };
      this.formSig = null; Form.refresh();
    };
    U.$$('#cbm-body [data-cbm-id]').forEach(x => x.addEventListener('change', () => { if (x.checked) resolve(x.dataset.cbmId, 'ID_DIFFERENT'); }));
    U.$$('#cbm-body [data-cbm-clear]').forEach(inp => inp.addEventListener('change', async () => {
      try {
        const ids = [];
        for (const file of inp.files) { const d = await Form.storeFile(file, 'CBM_CLEARANCE'); app.documents.push(d); ids.push(d.id); }
        if (ids.length) { resolve(inp.dataset.cbmClear, 'CLEARED', ids); Form.renderDocs(); }
      } catch (err) { UI.error(err); }
    }));
    U.$$('#cbm-body [data-cbm-undo]').forEach(b => b.addEventListener('click', () => { delete app.cbm.resolutions[b.dataset.cbmUndo]; this.formSig = null; Form.refresh(); }));
  },

  /* ---------- on the application page ---------- */
  detailCard(app) {
    const flags = this.flags(app);
    if (!flags.length) return '';
    const e = U.esc, open = flags.filter(f => !this.resolved(app, f));
    return `<div class="card" id="cbm-flag" style="border-color:${open.length ? 'var(--red-line, #f6c3c8)' : 'var(--amber-line, #f3d9a4)'}"><div class="card-h" style="background:var(--${open.length ? 'red' : 'amber'}-50)"><h2>Central bank list – possible unreconciled item at another bank</h2>${UI.tag(open.length ? `${open.length} not resolved` : 'Resolved', open.length ? 'red' : 'amber')}</div><div class="card-b">
      ${flags.map(f => { const r = f.resolution, docs = (r?.docIds || []).map(id => (app.documents || []).find(d => d.id === id)).filter(Boolean);
        return `<div style="margin-bottom:10px"><b>${e(f.row.n || '—')}</b> <small>${e(f.reasons.join(' · '))}</small><br><small>${e(this.details(f.row))}</small>
          <div>${r ? `${UI.tag(r.kind === 'CLEARED' ? 'Other bank confirmed reconciled' : 'Client ID is different', this.resolved(app, f) ? 'green' : 'amber')} <small>by ${e(r.name)}, ${U.fmtDateTime(r.at)}</small>${docs.map(d => `<div class="file"><span>📄</span><span class="name">${e(d.name)}</span>${DocView.buttons(d)}</div>`).join('')}` : UI.tag('Not resolved – edit the application to resolve it', 'red')}</div></div>`; }).join('')}
      </div></div>`;
  },
};

(() => {
  App.routes.push([/^#\/cbm$/, () => Cbm.page()]);

  // Unresolved matches block submission and authorisation (Rules.validate errors).
  const baseValidate = Rules.validate.bind(Rules);
  Rules.validate = function (app, today) {
    const v = baseValidate(app, today);
    if (['DRAFT', 'RETURNED', 'PENDING_AUTH'].includes(app.status || 'DRAFT') || !app.status) {
      Cbm.unresolved(app).forEach(f => v.errors.push({ field: 'customer.name', msg: `Central bank list: ${f.reasons.join(' and ')} – ${Cbm.describe(f.row)}. Resolve it in "Central bank list" (client ID is different, or the other bank's clearance uploaded) to submit.` }));
    }
    return v;
  };

  const baseRefresh = Form.refresh.bind(Form);
  Form.refresh = function () { const v = baseRefresh(); Cbm.renderForm(); return v; };
  const baseRender = Form.render.bind(Form);
  Form.render = function (id) { Cbm.formSig = null; return baseRender(id); };
  const baseSave = Form.save.bind(Form);
  Form.save = function (submit) { if (Form.app) Cbm.capture(Form.app); return baseSave(submit); };

  const baseDetail = Views.detail.bind(Views);
  Views.detail = function (id) {
    baseDetail(id);
    const app = Store.app(id);
    if (!app || !Engine.can('view', app)) return;
    const html = Cbm.detailCard(app);
    if (!html) return;
    U.$('#view .cols .stack')?.insertAdjacentHTML('afterbegin', html);
    U.$('#view .card .btn-row .btn-row')?.insertAdjacentHTML('beforeend', ` ${UI.tag('Central bank list', Cbm.unresolved(app).length ? 'red' : 'amber')}`);
    DocView.bind(U.$('#cbm-flag'), app.documents || []);
  };

  // Lists: a "Central bank list" tag under the reference of a flagged application.
  const baseTable = Views.appTable.bind(Views);
  Views.appTable = function (apps, queueId) {
    let html = baseTable(apps, queueId);
    apps.filter(a => a.cbm?.matches?.length).forEach(a => {
      const anchor = `<a href="#/app/${a.id}" class="mono">${U.esc(a.ref)}</a>`;
      html = html.replace(anchor, `${anchor}<br>${UI.tag('Central bank list', Cbm.unresolved(a).length ? 'red' : 'amber')}`);
    });
    return html;
  };

  // Menu: "Central bank list" under Reconciliation.
  const baseChrome = App.renderChrome.bind(App);
  App.renderChrome = function () {
    baseChrome();
    if (!Store.user()) return;   // every user sees the central bank list
    const after = document.querySelector('#nav a[href="#/reconciled"]') || document.querySelector('#nav a[href="#/unreconciled"]') || document.querySelector('#nav a[href="#/dashboard"]');
    const n = Cbm.list()?.rows.length;
    after?.insertAdjacentHTML('afterend', `<a href="#/cbm" class="${location.hash === '#/cbm' ? 'active' : ''}"><span>Central bank list</span>${n ? `<span class="count">${n}</span>` : ''}</a>`);
  };

  const baseLabel = Views.actionLabel.bind(Views);
  Views.actionLabel = x => ({ CBM_LIST_UPLOADED: 'Central bank list uploaded', CBM_LIST_ACCOUNT: 'Central bank list – account number or reference added', CBM_LIST_CLEARED: 'Central bank list cleared' })[x] || baseLabel(x);
})();
