'use strict';

/* Small helpers shared by every module. No dependencies. */
const U = {
  $(sel, root = document) { return root.querySelector(sel); },
  $$(sel, root = document) { return [...root.querySelectorAll(sel)]; },

  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  uid(prefix = 'id') {
    return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
  },

  clone(o) { return JSON.parse(JSON.stringify(o)); },

  getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  },
  setPath(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    keys.slice(0, -1).forEach(k => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
    o[keys[keys.length - 1]] = value;
  },

  sum(list, fn = x => x) { return list.reduce((t, x) => t + (Number(fn(x)) || 0), 0); },

  // ---- dates (all local time; "day keys" are YYYY-MM-DD strings) ----
  pad(n) { return String(n).padStart(2, '0'); },
  dayKey(d) {
    d = new Date(d);
    return `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}-${U.pad(d.getDate())}`;
  },
  parseDay(s) {
    if (!s) return null;
    const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
  },
  toDate(d) {
    if (!d) return null;
    if (d instanceof Date) return d;
    return typeof d === 'string' && d.length === 10 ? U.parseDay(d) : new Date(d);
  },
  addDays(d, n) { const x = new Date(U.toDate(d)); x.setDate(x.getDate() + n); return x; },
  startOfDay(d) { const x = new Date(U.toDate(d)); x.setHours(0, 0, 0, 0); return x; },
  daysBetween(a, b) { return Math.round((U.startOfDay(b) - U.startOfDay(a)) / 86400000); },
  isWeekend(d) { const g = U.toDate(d).getDay(); return g === 0 || g === 6; },

  fmtDate(d) {
    d = U.toDate(d);
    if (!d || isNaN(d)) return '—';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  },
  fmtDateTime(d) {
    d = U.toDate(d);
    if (!d || isNaN(d)) return '—';
    return `${U.fmtDate(d)} ${U.pad(d.getHours())}:${U.pad(d.getMinutes())}`;
  },
  fmtTime(d) { d = U.toDate(d); return `${U.pad(d.getHours())}:${U.pad(d.getMinutes())}`; },
  weekday(d) { return U.toDate(d).toLocaleDateString('en-GB', { weekday: 'short' }); },

  // ---- numbers ----
  num(n, dp = 2) {
    if (n === '' || n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  },
  money(n, ccy) { return `${ccy || ''} ${U.num(n)}`.trim(); },
  round2(n) { return Math.round((Number(n) || 0) * 100) / 100; },

  fileSize(b) {
    if (!b) return '';
    if (b < 1024) return `${b} B`;
    if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
    return `${(b / 1048576).toFixed(1)} MB`;
  },
};

/* Uploaded documents live in IndexedDB (localStorage is too small for files).
   Falls back to memory if IndexedDB is unavailable (files then last only for the session). */
const FileStore = {
  db: null,
  mem: new Map(),
  failed: false,
  open() {
    if (this.db || this.failed) return Promise.resolve(this.db);
    return new Promise(resolve => {
      try {
        const req = indexedDB.open('cbm-forex-files', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('files');
        req.onsuccess = () => { this.db = req.result; resolve(this.db); };
        req.onerror = () => { this.failed = true; resolve(null); };
      } catch (e) { this.failed = true; resolve(null); }
    });
  },
  async put(id, blob) {
    const db = await this.open();
    if (!db) { this.mem.set(id, blob); return; }
    return new Promise((res, rej) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put(blob, id);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  },
  async get(id) {
    const db = await this.open();
    if (!db) return this.mem.get(id) || null;
    return new Promise(res => {
      const req = db.transaction('files').objectStore('files').get(id);
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => res(null);
    });
  },
  async clear() {
    this.mem.clear();
    const db = await this.open();
    if (!db) return;
    return new Promise(res => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').clear();
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  },
};
