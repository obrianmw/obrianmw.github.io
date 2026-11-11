'use strict';

/* Reference numbers (Administration → Reference numbers).

   The administrator sets the format of new application references as fixed text (prefix, separators, suffix) and
   placeholders: {SEQ} the running number (required), {YYYY} {YY} {MM} {DD} the date, {BRANCH} the branch code,
   {BRANCHSHORT} the branch short name, {TYPE} the transaction type and {CCY} the currency applied for.
   The number counts across all branches and either restarts every day – the number of applications captured that day
   at the bank, the standard: {BRANCHSHORT}-FX{YY}{MM}{DD}-{SEQ}, e.g. MZU-FX261107-0042 – or runs on through the year
   (restarting only at end of year). In Live and Universal the server hands the numbers out and its clock decides the
   day, so references stay unique. A reference is fixed when the application is first saved; a new format applies to
   new applications only, and "Bring old references into the current format" renumbers the older ones.

   {SEQ} has a fixed number of characters (3 by default): 001 to 999, then the last character becomes a letter
   (99A ... 99Z), then the middle one (9A0 ... 9ZZ), then the first (A00 ... ZZZ) – counting on in base 36, 35,657 a day. */

const REF_TYPE_CODES = { ADVANCE: 'ADV', OPEN_ACCOUNT: 'OPA', FREIGHT: 'FRT', GIFTS: 'GFT', STUDENT_FEES: 'STF', MAINTENANCE: 'MNT', CASH: 'CSH', CASH_PASSPORT: 'CPP', MEDICAL: 'MED' };

const Refs = {
  DEFAULT: { pattern: '{BRANCHSHORT}-FX{YY}{MM}{DD}-{SEQ}', digits: 3, reset: 'DAY' },
  TOKENS: [['{SEQ}', 'Running number'], ['{YYYY}', 'Year (2026)'], ['{YY}', 'Year (26)'], ['{MM}', 'Month'], ['{DD}', 'Day'],
    ['{BRANCH}', 'Branch code'], ['{BRANCHSHORT}', 'Branch short name'], ['{TYPE}', 'Transaction type'], ['{CCY}', 'Currency']],

  settings() {
    const saved = Store.state.settings?.refFormat;
    return Object.assign({}, this.DEFAULT, saved || {}, saved && !saved.reset ? { reset: 'YEAR' } : {});   // saved before the daily number existed
  },

  /* A branch's short name: as set by the administrator, else the initials of a several-word name or the first three letters. */
  shortName(b) {
    if (!b) return '';
    if (String(b.shortName || '').trim()) return String(b.shortName).trim().toUpperCase();
    const w = String(b.name || '').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
    return (w.length > 1 ? w.map(x => x[0]).join('') : (w[0] || '').slice(0, 3)).toUpperCase();
  },

  format(n, ctx = {}, f = this.settings(), on = Store.now()) {
    const b = Store.branch(ctx.branchId) || {}, p2 = x => String(x).padStart(2, '0');
    const map = { SEQ: this.seqCode(n, Math.max(1, f.digits || 3)), YYYY: String(on.getFullYear()), YY: String(on.getFullYear()).slice(2), MM: p2(on.getMonth() + 1), DD: p2(on.getDate()),
      BRANCH: b.code || '', BRANCHSHORT: this.shortName(b), TYPE: REF_TYPE_CODES[ctx.type] || 'GEN', CCY: ctx.currency || '' };
    return String(f.pattern).replace(/\{([A-Z]+)\}/g, (m, k) => (k in map ? map[k] : m));
  },

  /* The number as w characters: decimal up to 10^w - 1 (999), then on in base 36 from there (99A, 99B ... 99Z, 9A0 ... ZZZ). */
  seqCode(n, w) {
    const top = 10 ** w - 1;
    if (n <= top) return String(n).padStart(w, '0');
    const s = (parseInt('9'.repeat(w), 36) + (n - top)).toString(36).toUpperCase();
    if (s.length > w) throw new WorkflowError(`More than ${U.num(this.capacity(w), 0)} references in one period. Ask the administrator to give the number more characters (Administration → Reference numbers).`);
    return s;
  },
  /* The number a code stands for (the opposite of seqCode). */
  seqValue(code, w) {
    if (/^\d+$/.test(code)) return Number(code);
    return parseInt(code, 36) - parseInt('9'.repeat(w), 36) + 10 ** w - 1;
  },
  capacity(w) { return 10 ** w - 1 + (36 ** w - 1 - parseInt('9'.repeat(w), 36)); },

  /* Does a reference follow the format? Returns { n, day } (day 'YYYY-MM-DD' when the format holds the date), else null. */
  parse(ref, f = this.settings()) {
    const parts = { SEQ: `([0-9A-Z]{${f.digits}})`, YYYY: '(\\d{4})', YY: '(\\d{2})', MM: '(\\d{2})', DD: '(\\d{2})', BRANCH: '[0-9A-Za-z]*', BRANCHSHORT: '[A-Z0-9]*', TYPE: '[A-Z]{3}', CCY: '[A-Z]{0,3}' };
    const groups = [];
    const src = String(f.pattern).split(/(\{[A-Z]+\})/).map(x => {
      const k = (x.match(/^\{([A-Z]+)\}$/) || [])[1];
      if (k && parts[k]) { if (parts[k].startsWith('(')) groups.push(k); return parts[k]; }
      return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    const m = String(ref || '').match(new RegExp(`^${src}$`));
    if (!m) return null;
    const g = {};
    groups.forEach((k, i) => { g[k] = m[i + 1]; });
    const year = g.YYYY || (g.YY ? `20${g.YY}` : '');
    return { n: this.seqValue(g.SEQ, f.digits), day: year && g.MM && g.DD ? `${year}-${g.MM}-${g.DD}` : '' };
  },

  /* Old references to bring into the current (daily) format: each application gets the number it would have had on the
     day it was captured – in order of capture across the bank, after any numbers already used that day. Applications
     captured today take today's next numbers from the counter, so new ones cannot clash with them. */
  plan() {
    const f = this.settings(), S = Store.state, today = U.dayKey(Store.now());
    if (f.reset !== 'DAY') return { f, rows: [], reason: 'Renumbering is available when the number restarts every day.' };
    const used = new Map();
    S.apps.forEach(a => { const x = this.parse(a.ref, f); if (x?.day) { if (!used.has(x.day)) used.set(x.day, new Set()); used.get(x.day).add(x.n); } });
    const next = new Map(), rows = [];
    S.apps.filter(a => a.ref && !this.parse(a.ref, f)).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).forEach(a => {
      const on = new Date(a.createdAt || Store.now()), day = U.dayKey(on);
      let n = null;
      if (day !== today) {
        const taken = used.get(day) || new Set();
        n = next.get(day) || 1;
        while (taken.has(n)) n++;
        next.set(day, n + 1);
      }
      rows.push({ app: a, old: a.ref, day, on, n, ref: n == null ? null : this.format(n, { branchId: a.branchId, type: a.type, currency: a.currency }, f, on) });
    });
    return { f, rows, reason: '' };
  },

  renumber() {
    if (Store.user()?.role !== 'ADMIN') throw new WorkflowError('Only an administrator can renumber references.');
    const { f, rows, reason } = this.plan(), S = Store.state;
    if (reason) throw new WorkflowError(reason);
    rows.forEach(r => { if (r.n == null) { r.n = this.dailyNumber().n; r.ref = this.format(r.n, { branchId: r.app.branchId, type: r.app.type, currency: r.app.currency }, f, r.on); } });
    const taken = new Set(S.apps.map(a => a.ref)), fresh = new Set();
    rows.forEach(r => { if (fresh.has(r.ref) || (taken.has(r.ref) && r.ref !== r.old)) throw new WorkflowError(`Reference ${r.ref} would be used twice. Nothing was changed.`); fresh.add(r.ref); });
    const at = Store.now().toISOString(), byId = new Map(rows.map(r => [r.app.id, r.ref]));
    rows.forEach(r => { r.app.formerRef = r.app.formerRef || r.old; r.app.ref = r.ref; r.app.renumberedAt = at; });
    S.outbox.forEach(m => { if (byId.has(m.appId)) m.ref = byId.get(m.appId); });   // the message text itself stays as it was sent
    Store.audit('REFS_RENUMBERED', null, `${rows.length} application reference(s) brought into the format ${f.pattern}; each keeps its former reference (for example ${rows[0]?.old} → ${rows[0]?.ref})`);
    Store.save();
    return rows.length;
  },

  /* Problems with a format: errors stop it being saved, warnings are shown. */
  check(f) {
    const errors = [], warnings = [], p = String(f.pattern || '');
    if (!p.includes('{SEQ}')) errors.push('The format must contain {SEQ}, the running number that makes each reference unique.');
    const unknown = (p.match(/\{[^}]*\}/g) || []).filter(t => !this.TOKENS.some(([k]) => k === t));
    if (unknown.length) errors.push(`Unknown placeholder(s): ${unknown.join(', ')}.`);
    if (/[^A-Za-z0-9\-_.{}]/.test(p.replace(/\{[^}]*\}/g, ''))) errors.push('Use letters, digits, hyphens (-), underscores (_) and full stops (.) only – no spaces or slashes.');
    if (!(f.digits >= 3 && f.digits <= 8)) errors.push('The running number must have 3 to 8 characters.');
    if (this.format(10 ** Math.min(8, Math.max(1, f.digits || 3)) - 1, { branchId: Store.state.branches[0]?.id, type: 'CASH_PASSPORT', currency: 'USD' }, f).length > 30) errors.push('References would be longer than 30 characters.');
    if (f.reset === 'DAY' && !(/\{DD\}/.test(p) && /\{MM\}/.test(p) && /\{YY(YY)?\}/.test(p))) errors.push('The number restarts every day, so the format must contain the date: {YY} or {YYYY}, {MM} and {DD}.');
    else if (!/\{YY(YY)?\}/.test(p)) warnings.push('Without the year, references can repeat if numbering is restarted at the end of the year (End of year → restart numbering).');
    if (p.includes('{TYPE}')) warnings.push('{TYPE} is the transaction type when the application is first saved; a draft saved without a type gets GEN.');
    return { errors, warnings };
  },

  /* The number of the day: applications captured today across the bank. Live/Universal ask the server (its clock
     decides the day); the prototype counts in the browser's data. Returns { n, on } with the date it belongs to. */
  dailyNumber() {
    if (typeof Live !== 'undefined' && Live.token) {
      const x = new XMLHttpRequest();
      x.open('POST', '/api/seq', false);
      x.setRequestHeader('X-Session', Live.token);
      x.setRequestHeader('Content-Type', 'application/json');
      x.send(JSON.stringify({ daily: true, year: Store.now().getFullYear() }));
      const r = x.status === 200 ? JSON.parse(x.responseText) : {};
      if (!r.day) throw new WorkflowError(x.status === 200 ? 'The server does not hand out daily numbers yet. Ask IT to restart it after the update.' : 'Could not get a reference number from the server.');
      return { n: r.n, on: new Date(Number(r.day.slice(0, 4)), Number(r.day.slice(4, 6)) - 1, Number(r.day.slice(6, 8))) };
    }
    const S = Store.state, on = Store.now(), day = U.dayKey(on);
    if (S.seqDay !== day) { S.seqDay = day; S.seqDayN = 0; }
    S.seqDayN += 1;
    return { n: S.seqDayN, on };
  },
};

(() => {
  /* Both the prototype's counter and the Live server's number come back as the old style (FX2026-00012); the
     running number is taken from its end and put into the administrator's format. */
  const baseNext = Engine.nextRef.bind(Engine);
  Engine.nextRef = function (ctx = {}) {
    const f = Refs.settings();
    let n, on;
    // While test data is generated (on an empty system, the clock set back to each application's day), the days
    // before today are counted here; today's applications take the counter's numbers like any other.
    if (f.reset === 'DAY' && Refs.generating && U.dayKey(Store.now()) < U.dayKey(new Date())) {
      on = Store.now();
      n = Refs.generating[U.dayKey(on)] = (Refs.generating[U.dayKey(on)] || 0) + 1;
    } else if (f.reset === 'DAY') ({ n, on } = Refs.dailyNumber());
    else {
      const raw = String(baseNext());
      n = Number((raw.match(/(\d+)$/) || [])[1]);
      if (!(n > 0)) return raw;
    }
    const ref = Refs.format(n, Object.assign({ branchId: Engine.workingBranch(Store.user()) }, ctx), f, on || Store.now());
    if (Store.state.apps.some(a => a.ref === ref)) throw new WorkflowError(`Reference ${ref} is already in use. Ask the administrator to check the reference number format (Administration → Reference numbers).`);
    return ref;
  };

  Admin.tabs.splice(Admin.tabs.findIndex(t => t[0] === 'settings') + 1, 0, ['refs', 'Reference numbers']);

  Admin.refs = function () {
    const S = Store.state, f = Refs.settings(), e = U.esc;
    const branches = S.branches.slice().sort((a, b) => String(a.code).localeCompare(String(b.code)));
    U.$('#adm').innerHTML = `<div class="grid g2" style="align-items:start">
      <div class="card"><div class="card-h"><h2>Format of new references</h2></div><div class="card-b">
        <label class="f"><span>Format</span><input id="rf-pattern" value="${e(f.pattern)}" spellcheck="false" style="font-family:var(--mono, monospace)">
          <div class="hint">Fixed text (prefix, separators, suffix) and placeholders. Standard: <span class="mono">{BRANCHSHORT}-FX{YY}{MM}{DD}-{SEQ}</span> (MZU-FX261107-042: Mzuzu, 7 November 2026, the bank's 42nd application that day). Another example: <span class="mono">FX{BRANCH}{YYYY}{SEQ}-{TYPE}</span>.</div></label>
        <div class="btn-row" style="flex-wrap:wrap;gap:6px;margin:6px 0 12px">${Refs.TOKENS.map(([k, l]) => `<button type="button" class="btn-sm" data-tok="${k}" title="${e(l)}">${e(k)}</button>`).join('')}</div>
        <div class="grid g2">
          <label class="f"><span>{SEQ} – the number</span><select id="rf-reset"><option value="DAY" ${f.reset === 'DAY' ? 'selected' : ''}>Restarts at 1 every day – applications captured that day across the bank</option><option value="YEAR" ${f.reset !== 'DAY' ? 'selected' : ''}>Runs on through the year (restarts only at end of year)</option></select></label>
          <label class="f"><span>Characters in the number</span><input id="rf-digits" type="number" min="3" max="8" value="${f.digits}"><div class="hint" id="rf-cap"></div></label>
        </div>
        <div id="rf-check" style="margin-top:10px"></div>
        <h3 style="margin:14px 0 6px">Preview <small class="muted">(example numbers – the real number comes when the application is first saved)</small></h3><div class="table-wrap"><table><thead><tr><th>Branch</th><th>Type</th><th>Next reference would look like</th></tr></thead><tbody id="rf-prev"></tbody></table></div>
        <div class="btn-row" style="margin-top:14px"><button class="btn-primary" id="rf-save">Save format</button><button id="rf-default">Back to the standard format</button></div>
        <p class="muted" style="margin:12px 0 0;font-size:12.5px">The number counts across all branches, so every reference is unique. In Live the server's date and count are used. Existing references never change; the new format applies to applications captured from now on.</p>
      </div></div>
      <div class="card"><div class="card-h"><h2>Branch short names</h2><small>for {BRANCHSHORT}</small></div><div class="card-b tight"><div class="table-wrap"><table>
        <thead><tr><th>Code</th><th>Branch</th><th>Short name</th></tr></thead><tbody>
        ${branches.map(b => `<tr><td class="mono">${e(b.code)}</td><td>${e(b.name)}</td><td><input data-short="${b.id}" value="${e(b.shortName || '')}" placeholder="${e(Refs.shortName(Object.assign({}, b, { shortName: '' })))}" maxlength="6" style="width:90px;text-transform:uppercase"></td></tr>`).join('')}
        </tbody></table></div><div style="padding:10px 12px"><button class="btn-primary btn-sm" id="rf-short">Save short names</button> <small class="muted">Blank = the initials or first three letters shown.</small></div></div></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-h"><h2>Bring old references into the current format</h2><small id="rn-sum"></small></div><div class="card-b" id="rn-body"></div></div>`;
    const read = () => ({ pattern: U.$('#rf-pattern').value.trim(), digits: Number(U.$('#rf-digits').value), reset: U.$('#rf-reset').value });
    const draw = () => {
      const d = read(), c = Refs.check(d);
      U.$('#rf-cap').textContent = d.digits >= 3 && d.digits <= 8 ? `${Refs.seqCode(1, d.digits)} to ${Refs.seqCode(10 ** d.digits - 1, d.digits)}, then ${Refs.seqCode(10 ** d.digits, d.digits)}, ${Refs.seqCode(10 ** d.digits + 1, d.digits)} … ${Refs.seqCode(Refs.capacity(d.digits), d.digits)}: ${U.num(Refs.capacity(d.digits), 0)} ${d.reset === 'DAY' ? 'a day' : 'a year'}` : '';
      U.$('#rf-check').innerHTML = c.errors.map(x => `<div class="alert error">✕ ${e(x)}</div>`).join('') + c.warnings.map(x => `<div class="alert warn">! ${e(x)}</div>`).join('');
      const seq = d.reset === 'DAY' ? (S.seqDay === U.dayKey(Store.now()) ? S.seqDayN || 0 : 0) + 1 : (S.seq || 0) + 1;
      U.$('#rf-prev').innerHTML = c.errors.length ? '<tr><td colspan="3" class="empty">Fix the format to see a preview.</td></tr>'
        : branches.slice(0, 4).map((b, i) => { const type = ['ADVANCE', 'GIFTS', 'CASH_PASSPORT', 'STUDENT_FEES'][i]; return `<tr><td>${e(b.code)} · ${e(b.name)}</td><td>${e(TXN_TYPES[type].label)}</td><td class="mono"><b>${e(Refs.format(seq + i, { branchId: b.id, type, currency: 'USD' }, d))}</b></td></tr>`; }).join('');
    };
    U.$('#rf-pattern').addEventListener('input', draw);
    U.$('#rf-digits').addEventListener('input', draw);
    U.$('#rf-reset').addEventListener('change', draw);
    U.$$('#adm [data-tok]').forEach(b => b.addEventListener('click', () => {
      const inp = U.$('#rf-pattern'), at = inp.selectionStart ?? inp.value.length;
      inp.value = inp.value.slice(0, at) + b.dataset.tok + inp.value.slice(inp.selectionEnd ?? at);
      inp.focus(); inp.setSelectionRange(at + b.dataset.tok.length, at + b.dataset.tok.length); draw();
    }));
    U.$('#rf-default').addEventListener('click', () => { U.$('#rf-pattern').value = Refs.DEFAULT.pattern; U.$('#rf-digits').value = Refs.DEFAULT.digits; U.$('#rf-reset').value = Refs.DEFAULT.reset; draw(); });
    U.$('#rf-save').addEventListener('click', () => {
      const d = read(), c = Refs.check(d);
      if (c.errors.length) { UI.toast(c.errors[0], 'error'); return; }
      S.settings.refFormat = d;
      Store.audit('SETTINGS_UPDATED', null, `Reference number format set to ${d.pattern} (${d.digits} digits, number ${d.reset === 'DAY' ? 'restarts every day' : 'runs through the year'})`);
      Store.save(); UI.toast('Reference format saved. New applications will use it.', 'ok');
    });
    U.$('#rf-short').addEventListener('click', () => {
      const bad = U.$$('#adm [data-short]').find(i => /[^A-Za-z0-9]/.test(i.value.trim()));
      if (bad) { UI.toast('Short names may contain letters and digits only.', 'error'); return; }
      const changed = [];
      U.$$('#adm [data-short]').forEach(i => {
        const b = S.branches.find(x => x.id === i.dataset.short), v = i.value.trim().toUpperCase();
        if (b && (b.shortName || '') !== v) { b.shortName = v; changed.push(`${b.name}: ${v || 'default'}`); }
      });
      if (!changed.length) { UI.toast('Nothing changed.'); return; }
      Store.audit('BRANCH_SAVED', null, `Branch short names – ${changed.join(', ')}`);
      Store.save(); UI.toast('Short names saved.', 'ok'); Admin.refs();
    });
    // Renumbering the applications whose reference is not in the saved format.
    const pl = Refs.plan(), rows = pl.rows;
    U.$('#rn-sum').textContent = pl.reason ? '' : `${U.num(rows.length, 0)} to change`;
    U.$('#rn-body').innerHTML = pl.reason ? `<div class="muted">${e(pl.reason)}</div>`
      : !rows.length ? '<div class="alert ok"><div>Every application reference is in the current format.</div></div>'
      : `<p style="margin-top:0">${U.num(rows.length, 0)} application(s) have a reference in an older format. Each gets the reference it would have had: its branch, the day it was captured and its place in that day's applications across the bank (in order of capture). Applications captured today take today's next numbers. The old reference is kept on each application as its <b>former reference</b> and can still be searched; messages already sent and audit entries keep the text they had.</p>
        <div class="table-wrap"><table><thead><tr><th>Current reference</th><th>New reference</th><th>Captured</th><th>Branch</th><th>Client</th></tr></thead><tbody>
        ${rows.slice(0, 15).map(r => `<tr><td class="mono">${e(r.old)}</td><td class="mono"><b>${r.ref ? e(r.ref) : '<i>next number of today</i>'}</b></td><td>${U.fmtDateTime(r.app.createdAt)}</td><td>${e(UI.branchName(r.app.branchId))}</td><td>${e(r.app.customer?.name || '')}</td></tr>`).join('')}</tbody></table></div>
        ${rows.length > 15 ? `<div class="muted" style="margin-top:6px">…and ${U.num(rows.length - 15, 0)} more.</div>` : ''}
        <div class="btn-row" style="margin-top:12px"><button class="btn-primary" id="rn-go">Change ${U.num(rows.length, 0)} reference(s)</button><small class="muted">Save the format first if you have changed it. Take a backup before (End of day / backups).</small></div>`;
    U.$('#rn-go')?.addEventListener('click', async () => {
      if (!await UI.confirm('Change the references?', `<p>${U.num(rows.length, 0)} application(s) get a reference in the format <span class="mono">${e(f.pattern)}</span>. Each keeps its old reference as its former reference. This cannot be undone from the screen.</p>`, 'Change references')) return;
      try { const n = Refs.renumber(); UI.toast(`${U.num(n, 0)} reference(s) changed.`, 'ok'); } catch (err) { UI.error(err); }
      Admin.refs();
    });
    draw();
  };

  /* Application page: the former reference next to the capture details. */
  const baseDetail = Views.detail.bind(Views);
  Views.detail = function (id) {
    baseDetail(id);
    const app = Store.app(id);
    if (app?.formerRef) U.$('#view .card .btn-row > small')?.insertAdjacentHTML('beforeend', ` · former reference <span class="mono">${U.esc(app.formerRef)}</span>`);
  };
  const baseLabel = Views.actionLabel.bind(Views);
  Views.actionLabel = x => (x === 'REFS_RENUMBERED' ? 'References renumbered' : baseLabel(x));

  // The test-data generator (js/testdata.js, loaded later): each application gets the reference of its own capture day.
  window.addEventListener('DOMContentLoaded', () => {
    if (typeof TestData === 'undefined' || typeof TestData.run !== 'function') return;
    const baseRun = TestData.run.bind(TestData);
    TestData.run = async function (...args) {
      Refs.generating = {};   // day -> numbers used
      try { return await baseRun(...args); } finally { Refs.generating = null; }
    };
  });
})();
