'use strict';

/* Search, filters, A–Z and sorting on every list in the system, the same way as on the central bank list.

   Each list (a table with a heading row and at least 6 rows, on a page or in a pop-up) gets a bar above it: a search
   box, a drop-down for every column with a handful of different values (status, type, branch, currency, role…), the
   A–Z letters of the name column (client, customer, applicant, user…) and "X of Y". Clicking a column heading sorts
   by it (again to reverse). The choices are kept while the page redraws. Tables people type into (inputs in the
   rows) and lists that have their own tools (the central bank list) are left as they are. */

const ListTools = {
  MIN_ROWS: 6,
  state: {},

  text(cell) { return String(cell?.innerText ?? cell?.textContent ?? '').trim(); },
  first(cell) { return this.text(cell).split('\n')[0].trim(); },
  letterOf(v) { const ch = String(v || '').toUpperCase().replace(/^(MR|MRS|MS|MISS|DR|THE)\.?\s+/, '')[0] || ''; return /[A-Z]/.test(ch) ? ch : ch ? '#' : ''; },

  scan() {
    [document.getElementById('view'), document.getElementById('modal-root')].filter(Boolean).forEach(root => {
      root.querySelectorAll('table').forEach((t, i) => { if (!t.dataset.lt) this.setup(t, `${location.hash}|${root.id}|${i}`); });
    });
  },

  setup(table, key) {
    if (!table.tHead || !table.tBodies[0] || table.closest('.no-tools')) return;
    if (table.closest('.card')?.querySelector('[data-letter], [data-cf]')) return;        // has its own (central bank list)
    if (table.tBodies[0].querySelector('input, select, textarea')) return;              // a table people type into
    const rows = [...table.tBodies[0].rows].filter(r => r.cells.length > 1);
    if (rows.length < this.MIN_ROWS) return;
    table.dataset.lt = '1';
    const heads = [...table.tHead.rows[0].cells].map(c => String(c.textContent || '').trim());   // as written, not as styled (capitals)
    const st = this.state[key] = this.state[key] || { q: '', letter: '', f: {}, sort: null };
    // The name column for A–Z: the first heading that names a person or client, else the first text column.
    let nameCol = heads.findIndex(h => /client|customer|applicant|beneficiary|^name|user|to$|recipient/i.test(h));
    if (nameCol < 0) nameCol = heads.findIndex((h, j) => h && rows.some(r => /[A-Za-z]{3}/.test(this.first(r.cells[j]))));
    // Filter columns: a few different short values, repeated across the rows.
    const filters = heads.map((h, j) => {
      if (!h || j === nameCol) return null;
      const vals = rows.map(r => this.first(r.cells[j])).filter(Boolean);
      const distinct = [...new Set(vals)];
      if (distinct.length < 2 || distinct.length > 25 || distinct.length >= vals.length * 0.5) return null;
      if (distinct.some(v => v.length > 40) || distinct.every(v => /^[\d\s.,:/-]+$/.test(v))) return null;
      return { j, h, distinct: distinct.sort((a, b) => a.localeCompare(b)) };
    }).filter(Boolean).slice(0, 6);
    const letters = new Set(rows.map(r => this.letterOf(this.first(r.cells[nameCol]))).filter(Boolean));
    const e = U.esc;
    const bar = document.createElement('div');
    bar.className = 'lt-bar';
    bar.innerHTML = `<div class="toolbar" style="margin:0 0 6px;gap:6px">
        <input type="search" class="lt-q" placeholder="Search this list" value="${e(st.q)}" style="min-width:200px;flex:1 1 220px">
        ${filters.map(f => `<select class="lt-f" data-j="${f.j}" aria-label="${e(f.h)}"><option value="">${e(f.h)}: all</option>${f.distinct.map(v => `<option ${st.f[f.j] === v ? 'selected' : ''}>${e(v)}</option>`).join('')}</select>`).join('')}
        <small class="muted lt-count"></small><button type="button" class="btn-sm lt-reset">Clear</button></div>
      ${nameCol >= 0 && letters.size > 1 ? `<div class="pill-group lt-az" style="flex-wrap:wrap;margin:0 0 8px" aria-label="${e(heads[nameCol])} starts with"><button type="button" data-l="" class="${!st.letter ? 'on' : ''}">All</button>${'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('').map(ch => `<button type="button" data-l="${ch}" class="${st.letter === ch ? 'on' : ''}" ${letters.has(ch) ? '' : 'disabled'}>${ch === '#' ? '0–9' : ch}</button>`).join('')}</div>` : ''}`;
    (table.closest('.table-wrap') || table).insertAdjacentElement('beforebegin', bar);
    // Sortable headings.
    [...table.tHead.rows[0].cells].forEach((th, j) => {
      if (!heads[j]) return;
      th.classList.add('lt-sort');
      th.title = 'Sort';
      th.addEventListener('click', () => { st.sort = st.sort?.j === j ? { j, dir: -st.sort.dir } : { j, dir: 1 }; apply(); });
    });
    const sortValue = (r, j) => {
      const t = this.first(r.cells[j]), n = Number(t.replace(/[^\d.-]/g, ''));
      const d = /\d{4}/.test(t) ? Date.parse(t.replace(/(\d{1,2}) (\w{3}) (\d{4})/, '$2 $1 $3')) : NaN;
      const m = t.match(/^([A-Za-z]{0,3})\s?(-?[\d,]+(?:\.\d+)?)\s*%?$/);   // 1,250.00 or USD 1,250.00: currency, then amount
      return { t: t.toLowerCase(), p: m ? m[1].toUpperCase() : '', n: m && !isNaN(n) ? n : null, d: isNaN(d) ? null : d };
    };
    const apply = () => {
      const q = st.q.trim().toLowerCase();
      let shown = 0;
      rows.forEach(r => {
        const ok = (!q || this.text(r).toLowerCase().includes(q))
          && (!st.letter || this.letterOf(this.first(r.cells[nameCol])) === st.letter)
          && Object.entries(st.f).every(([j, v]) => !v || this.first(r.cells[j]) === v);
        r.style.display = ok ? '' : 'none';
        if (ok) shown++;
      });
      if (st.sort) {
        const { j, dir } = st.sort;
        const sorted = rows.slice().sort((a, b) => {
          const x = sortValue(a, j), y = sortValue(b, j);
          if (x.n != null && y.n != null) return (x.p.localeCompare(y.p) || x.n - y.n) * dir;
          if (x.d != null && y.d != null) return (x.d - y.d) * dir;
          return x.t.localeCompare(y.t) * dir;
        });
        sorted.forEach(r => table.tBodies[0].appendChild(r));
      }
      [...table.tHead.rows[0].cells].forEach((th, j) => th.dataset.sorted = st.sort?.j === j ? (st.sort.dir > 0 ? 'asc' : 'desc') : '');
      bar.querySelector('.lt-count').textContent = `${shown} of ${rows.length}`;
      bar.querySelectorAll('[data-l]').forEach(b => b.classList.toggle('on', b.dataset.l === st.letter));
    };
    bar.querySelector('.lt-q').addEventListener('input', ev => { st.q = ev.target.value; apply(); });
    bar.querySelectorAll('.lt-f').forEach(sel => sel.addEventListener('change', () => { st.f[sel.dataset.j] = sel.value; apply(); }));
    bar.querySelectorAll('[data-l]').forEach(b => b.addEventListener('click', () => { st.letter = b.dataset.l; apply(); }));
    bar.querySelector('.lt-reset').addEventListener('click', () => {
      Object.assign(st, { q: '', letter: '', f: {}, sort: null });
      bar.querySelector('.lt-q').value = '';
      bar.querySelectorAll('.lt-f').forEach(sel => { sel.value = ''; });
      apply();
    });
    apply();
  },
};

(() => {
  const css = document.createElement('style');
  css.textContent = `th.lt-sort { cursor: pointer; user-select: none; } th.lt-sort:hover { color: var(--link); }
    th.lt-sort[data-sorted="asc"]::after { content: ' ▲'; font-size: 10px; } th.lt-sort[data-sorted="desc"]::after { content: ' ▼'; font-size: 10px; }
    .lt-az button[disabled] { opacity: .35; } .lt-bar .lt-count { white-space: nowrap; }`;
  document.head.appendChild(css);
  let pending = false;
  const later = () => { if (pending) return; pending = true; setTimeout(() => { pending = false; ListTools.scan(); }, 30); };   // a timer, not a repaint: works in background tabs too
  const start = () => {
    ['view', 'modal-root'].forEach(id => { const el = document.getElementById(id); if (el) new MutationObserver(later).observe(el, { childList: true, subtree: true }); });
    later();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
