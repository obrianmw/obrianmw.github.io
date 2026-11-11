'use strict';

/* Uploaded documents: view in the browser, open in a new tab, or download.
   Viewed in the page: PDF, images (JPG, PNG, GIF, WebP, BMP, SVG), Word (.docx), Excel (.xlsx), text-like files
   (TXT, CSV, JSON, XML, HTML shown as source, logs), audio and video. Anything else can always be downloaded.
   .docx / .xlsx are unzipped in the browser (DecompressionStream) and shown as plain text and tables; no add-ins,
   no internet. Uploaded content is never run as a web page: HTML and SVG are shown as text or as an image only. */
const DocView = {
  MAX_TEXT: 1024 * 1024,     // show up to 1 MB of a text file
  MAX_ROWS: 500, MAX_COLS: 40,

  ext(name) { const m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; },

  /* What kind of viewer a document needs, from its MIME type or file extension. */
  kind(doc) {
    const mime = (doc.mime || '').toLowerCase(), x = this.ext(doc.name);
    if (mime === 'application/pdf' || x === 'pdf') return 'pdf';
    if (mime === 'image/svg+xml' || x === 'svg') return 'svg';
    if (/^image\//.test(mime) || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(x)) return 'image';
    if (x === 'docx' || mime.includes('wordprocessingml')) return 'docx';
    if (x === 'xlsx' || mime.includes('spreadsheetml')) return 'xlsx';
    if (/^audio\//.test(mime) || ['mp3', 'wav', 'ogg', 'm4a'].includes(x)) return 'audio';
    if (/^video\//.test(mime) || ['mp4', 'webm', 'mov'].includes(x)) return 'video';
    if (/^text\//.test(mime) || /json|xml|csv/.test(mime) || ['txt', 'csv', 'json', 'xml', 'log', 'md', 'html', 'htm', 'tsv'].includes(x)) return 'text';
    if (['doc', 'xls', 'ppt', 'pptx', 'msg', 'rtf', 'zip'].includes(x)) return 'office-old';
    return 'other';
  },

  async blobOf(doc) {
    const blob = await FileStore.get(doc.id);
    if (!blob) throw new WorkflowError(`The file content of ${doc.name} could not be found.`);
    return blob;
  },

  save(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name || 'document';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  },

  async download(doc) {
    if (!doc) return;
    if (doc.sample) { UI.toast('This is a sample record without file content.', 'info'); return; }
    try { this.save(await this.blobOf(doc), doc.name); } catch (e) { UI.error(e); }
  },

  /* A new tab only for types the browser shows safely; text is re-typed as plain text so it can never run. */
  tabBlob(blob, kind) {
    if (kind === 'text') return new Blob([blob], { type: 'text/plain;charset=utf-8' });
    if (['pdf', 'image', 'audio', 'video'].includes(kind)) return blob;
    return null;
  },

  /* ---------- ZIP reading (for .docx / .xlsx) ---------- */
  async unzip(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const dv = new DataView(buf.buffer);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error('not a ZIP package');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen)).replace(/\\/g, '/');   // some zip tools write "\"
      files[name] = { method, csize, local };
      p += 46 + nlen + xlen + clen;
    }
    return {
      names: Object.keys(files),
      async text(name) {
        const f = files[name];
        if (!f) return null;
        const start = f.local + 30 + dv.getUint16(f.local + 26, true) + dv.getUint16(f.local + 28, true);
        const raw = buf.subarray(start, start + f.csize);
        if (f.method === 0) return new TextDecoder().decode(raw);
        if (f.method !== 8 || typeof DecompressionStream === 'undefined') throw new Error('unsupported compression');
        const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new TextDecoder().decode(await new Response(stream).arrayBuffer());
      },
    };
  },

  xml(text) { return new DOMParser().parseFromString(text, 'application/xml'); },
  byTag(node, tag) { return [...node.getElementsByTagName('*')].filter(e => e.localName === tag); },
  kids(node, tag) { return [...node.childNodes].filter(e => e.nodeType === 1 && e.localName === tag); },

  /* ---------- Word (.docx): paragraphs, headings, bold, tables ---------- */
  async docxHtml(blob) {
    const zip = await this.unzip(blob);
    const docXml = await zip.text('word/document.xml');
    if (!docXml) throw new Error('word/document.xml missing');
    const body = this.byTag(this.xml(docXml), 'body')[0];
    const para = pEl => {
      const style = this.byTag(pEl, 'pStyle')[0]?.getAttribute('w:val') || '';
      let html = '';
      this.byTag(pEl, 'r').forEach(r => {
        const bold = this.byTag(r, 'b').length > 0;
        let t = '';
        [...r.childNodes].forEach(c => {
          if (c.localName === 't') t += U.esc(c.textContent);
          else if (c.localName === 'tab') t += '&emsp;';
          else if (c.localName === 'br') t += '<br>';
        });
        html += bold && t ? `<b>${t}</b>` : t;
      });
      const h = /^Heading([1-3])$/i.exec(style) || (/^Title$/i.test(style) ? [0, 1] : null);
      return h ? `<h${Number(h[1]) + 2}>${html}</h${Number(h[1]) + 2}>` : `<p>${html || '&nbsp;'}</p>`;
    };
    const table = tbl => `<table>${this.kids(tbl, 'tr').map(tr => `<tr>${this.kids(tr, 'tc').map(tc => `<td>${this.kids(tc, 'p').map(para).join('')}</td>`).join('')}</tr>`).join('')}</table>`;
    return [...body.childNodes].filter(n => n.nodeType === 1).map(n => (n.localName === 'p' ? para(n) : n.localName === 'tbl' ? table(n) : '')).join('');
  },

  /* ---------- Excel (.xlsx): each sheet as a table ---------- */
  async xlsxSheets(blob) {
    const zip = await this.unzip(blob);
    const shared = [];
    const ss = await zip.text('xl/sharedStrings.xml');
    if (ss) this.byTag(this.xml(ss), 'si').forEach(si => shared.push(this.byTag(si, 't').map(t => t.textContent).join('')));
    const wb = this.xml(await zip.text('xl/workbook.xml') || '<x/>');
    const rels = this.xml(await zip.text('xl/_rels/workbook.xml.rels') || '<x/>');
    const target = {};
    this.byTag(rels, 'Relationship').forEach(r => { target[r.getAttribute('Id')] = r.getAttribute('Target'); });
    const colIndex = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
    const sheets = [];
    for (const s of this.byTag(wb, 'sheet')) {
      const rid = s.getAttribute('r:id') || [...s.attributes].find(a => a.localName === 'id')?.value;
      let path = target[rid] || '';
      path = path.startsWith('/') ? path.slice(1) : `xl/${path.replace(/^\.\//, '')}`;
      const text = await zip.text(path);
      if (!text) continue;
      const rows = [];
      this.byTag(this.xml(text), 'row').slice(0, this.MAX_ROWS).forEach(row => {
        const cells = [];
        this.kids(row, 'c').forEach(c => {
          const i = colIndex(c.getAttribute('r') || 'A1');
          if (i >= this.MAX_COLS) return;
          const t = c.getAttribute('t'), v = this.kids(c, 'v')[0]?.textContent ?? '';
          cells[i] = t === 's' ? (shared[Number(v)] ?? '') : t === 'inlineStr' ? this.byTag(c, 't').map(x => x.textContent).join('') : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : v;
        });
        rows.push(cells);
      });
      sheets.push({ name: s.getAttribute('name') || `Sheet ${sheets.length + 1}`, rows });
    }
    return sheets;
  },

  sheetTable(sheet) {
    const width = Math.max(1, ...sheet.rows.map(r => r.length));
    return `<table>${sheet.rows.map(r => `<tr>${Array.from({ length: width }, (_, i) => `<td>${U.esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('') || '<tr><td class="empty">Empty sheet</td></tr>'}</table>`;
  },

  /* ---------- the viewer ---------- */
  async open(doc) {
    if (!doc) return;
    const meta = `${U.esc(DOC_TYPES[doc.code] || 'Document')} · ${U.fileSize(doc.size)} · uploaded ${U.fmtDateTime(doc.uploadedAt)} by ${U.esc(UI.userName(doc.uploadedBy))}`;
    if (doc.sample) {
      UI.modal({ title: doc.name, body: `<div class="alert info">This is a sample record created with the demo data, so there is no file content to show or download. Files you upload yourself open here.</div><p class="muted">${meta}</p>`, closeLabel: 'Close' });
      return;
    }
    let blob;
    try { blob = await this.blobOf(doc); } catch (e) { UI.error(e); return; }
    const kind = this.kind(doc);
    const url = URL.createObjectURL(blob);
    const tab = this.tabBlob(blob, kind);
    let body = '';
    try {
      if (kind === 'pdf') body = `<iframe class="doc-frame" src="${url}" title="${U.esc(doc.name)}"></iframe>`;
      else if (kind === 'image' || kind === 'svg') body = `<div class="doc-image"><img src="${url}" alt="${U.esc(doc.name)}"></div>`;
      else if (kind === 'audio') body = `<audio controls src="${url}" style="width:100%"></audio>`;
      else if (kind === 'video') body = `<video controls src="${url}" style="width:100%;max-height:70vh"></video>`;
      else if (kind === 'text') {
        const text = await blob.slice(0, this.MAX_TEXT).text();
        body = `<pre class="doc-text">${U.esc(text)}</pre>${blob.size > this.MAX_TEXT ? '<p class="muted">Only the first 1 MB is shown. Download the file to see all of it.</p>' : ''}`;
      } else if (kind === 'docx') {
        body = `<div class="alert info" style="margin-bottom:8px"><div>Text and tables only; download the file to see the original layout, images and formatting.</div></div><div class="doc-word">${await this.docxHtml(blob)}</div>`;
      } else if (kind === 'xlsx') {
        const sheets = await this.xlsxSheets(blob);
        body = `<div class="alert info" style="margin-bottom:8px"><div>Values only (first ${this.MAX_ROWS} rows and ${this.MAX_COLS} columns of each sheet); download the file for formulas and formatting.</div></div>
          ${sheets.length > 1 ? `<div class="pill-group" style="margin-bottom:8px">${sheets.map((s, i) => `<button type="button" data-sheet="${i}" class="${i ? '' : 'on'}">${U.esc(s.name)}</button>`).join('')}</div>` : ''}
          ${sheets.map((s, i) => `<div class="doc-sheet table-wrap" data-sheet-body="${i}" ${i ? 'hidden' : ''}>${this.sheetTable(s)}</div>`).join('') || '<p>No sheets found.</p>'}`;
      } else if (kind === 'office-old') {
        body = `<div class="alert warn"><div>Older Office files (.doc, .xls, .ppt) and other packages cannot be shown in the browser. Use <b>Download</b> to open it in Word, Excel or the right program.</div></div>`;
      } else {
        body = `<div class="alert warn"><div>This file type cannot be shown in the browser. Use <b>Download</b> to open it with the right program.</div></div>`;
      }
    } catch (e) {
      body = `<div class="alert warn"><div>This file could not be shown in the browser (${U.esc(e.message)}). Use <b>Download</b> to open it.</div></div>`;
    }

    const actions = [];
    if (tab) actions.push({ label: 'Open in new tab', cls: '', onClick: () => { window.open(URL.createObjectURL(tab), '_blank', 'noopener'); return false; } });
    actions.push({ label: '⇩ Download', onClick: () => { this.save(blob, doc.name); return false; } });
    const m = UI.modal({
      title: doc.name, wide: true, closeLabel: 'Close', actions,
      body: `${body}<p class="muted" style="margin-top:8px">${meta}</p>`,
      onOpen: el => el.querySelectorAll('[data-sheet]').forEach(b => b.addEventListener('click', () => {
        el.querySelectorAll('[data-sheet]').forEach(x => x.classList.toggle('on', x === b));
        el.querySelectorAll('[data-sheet-body]').forEach(x => { x.hidden = x.dataset.sheetBody !== b.dataset.sheet; });
      })),
    });
    new MutationObserver((_, obs) => { if (!m.el.isConnected) { obs.disconnect(); URL.revokeObjectURL(url); } }).observe(document.getElementById('modal-root'), { childList: true });
  },

  /* View / Download buttons for a document list. */
  buttons(doc, attrs = '') {
    return `<button type="button" class="btn-sm" data-view-doc="${U.esc(doc.id)}" ${attrs}>View</button><button type="button" class="btn-sm" data-dl-doc="${U.esc(doc.id)}" title="Download ${U.esc(doc.name)}" aria-label="Download ${U.esc(doc.name)}" ${doc.sample ? 'disabled' : ''}>⇩</button>`;
  },

  bind(root, docs) {
    const find = id => docs.find(d => d.id === id);
    root.querySelectorAll('[data-view-doc]').forEach(b => b.addEventListener('click', () => this.open(find(b.dataset.viewDoc))));
    root.querySelectorAll('[data-dl-doc]').forEach(b => b.addEventListener('click', () => this.download(find(b.dataset.dlDoc))));
  },
};

UI.openDoc = doc => DocView.open(doc);
UI.downloadDoc = doc => DocView.download(doc);
