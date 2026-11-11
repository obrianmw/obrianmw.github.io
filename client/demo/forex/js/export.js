'use strict';

/* Report export to Excel (.xlsx), Word (.docx), PDF, CSV, HTML and Print.
   Files are generated in the browser with no external libraries, so it works on networks without internet access.

   A report "model" looks like:
   { title, subtitle, filename,
     sections: [{ heading, columns: [{ label, num: <decimals> }], rows: [[...]], totals: [...] }] }
   Numeric cells should be numbers (not formatted strings) so Excel keeps them as numbers. */

const Export = {
  FORMATS: [
    ['xlsx', 'Excel workbook (.xlsx)'],
    ['docx', 'Word document (.docx)'],
    ['pdf', 'PDF document (.pdf)'],
    ['csv', 'CSV (.csv)'],
    ['html', 'Web page (.html)'],
    ['print', 'Print…'],
  ],

  /* ---------- menu ---------- */
  button(label = 'Export') {
    return `<button type="button" class="export-btn" aria-haspopup="menu">⇩ ${U.esc(label)} ▾</button>`;
  },

  /* Turns every .export-btn inside root into a format menu that exports getModel(). */
  attach(root, getModel) {
    root.querySelectorAll('.export-btn').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      this.openMenu(btn, getModel);
    }));
  },

  openMenu(btn, getModel) {
    document.querySelectorAll('.export-menu').forEach(m => m.remove());
    const r = btn.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'export-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = this.FORMATS.map(([f, l]) => `<button type="button" role="menuitem" data-fmt="${f}">${U.esc(l)}</button>`).join('');
    document.body.appendChild(menu);
    const left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${r.bottom + window.scrollY + 4}px`;
    const close = () => { menu.remove(); document.removeEventListener('click', close); document.removeEventListener('keydown', onKey); };
    const onKey = ev => { if (ev.key === 'Escape') close(); };
    setTimeout(() => { document.addEventListener('click', close); document.addEventListener('keydown', onKey); });
    menu.querySelectorAll('[data-fmt]').forEach(b => b.addEventListener('click', ev => {
      ev.stopPropagation();
      close();
      try { this.run(b.dataset.fmt, getModel()); } catch (err) { UI.error(err); }
    }));
    menu.querySelector('button').focus();
  },

  /* ---------- dispatch ---------- */
  run(fmt, model) {
    model = Object.assign({ sections: [] }, model);
    if (fmt === 'print') { this.print(model); return; }
    const base = String(model.filename || model.title || 'report').replace(/[^\w\-]+/g, '_').replace(/_+/g, '_');
    const blob = this[fmt](model);
    this.save(blob, `${base}.${fmt}`);
    Store.audit('REPORT_EXPORTED', null, `${model.title} – ${fmt.toUpperCase()} (${U.sum(model.sections, s => s.rows.length)} rows)`);
    Store.save();
    UI.toast(`${base}.${fmt} downloaded.`, 'ok');
  },

  save(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  },

  meta() {
    const u = Store.user();
    return `Generated ${U.fmtDateTime(Store.now())}${u ? ` by ${u.name}` : ''} · ${Store.state.bank.name} – ${Brand.current.productName}`;
  },

  /* Display text for a cell (used by Word, PDF, HTML). */
  text(v, col) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') return col && col.num != null ? U.num(v, col.num) : String(v);
    return String(v);
  },

  xml(s) {
    return String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  /* ---------- CSV ---------- */
  csv(m) {
    const cell = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [];
    const single = m.sections.length === 1;
    if (!single) { lines.push([m.title]); if (m.subtitle) lines.push([m.subtitle]); lines.push([this.meta()]); }
    m.sections.forEach(s => {
      if (!single) { lines.push([]); if (s.heading) lines.push([s.heading]); }
      lines.push(s.columns.map(c => c.label));
      s.rows.forEach(r => lines.push(r));
      if (s.totals) lines.push(s.totals);
    });
    return new Blob(['﻿' + lines.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  },

  /* ---------- HTML (also what Print uses) ---------- */
  htmlDoc(m) {
    const table = s => `<table><thead><tr>${s.columns.map(c => `<th${c.num != null ? ' class="n"' : ''}>${U.esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${s.rows.map(r => `<tr>${r.map((v, i) => `<td${s.columns[i]?.num != null ? ' class="n"' : ''}>${U.esc(this.text(v, s.columns[i])).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${s.columns.length}" class="e">No data</td></tr>`}</tbody>
      ${s.totals ? `<tfoot><tr>${s.totals.map((v, i) => `<td${s.columns[i]?.num != null ? ' class="n"' : ''}>${U.esc(this.text(v, s.columns[i]))}</td>`).join('')}</tr></tfoot>` : ''}</table>`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${U.esc(m.title)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font: 11px/1.4 "Segoe UI", Arial, sans-serif; color: #15203a; margin: 16px; }
  h1 { font-size: 18px; color: ${Brand.hex('primary')}; margin: 0 0 2px; } h2 { font-size: 13px; margin: 18px 0 6px; }
  .sub { color: #47526b; } .meta { color: #7c869b; font-size: 10px; margin-top: 2px; }
  .bar { height: 4px; margin: 8px 0 4px; background: linear-gradient(90deg, ${Brand.hex('primary')} 0 55%, ${Brand.hex('accent')} 55% 78%, ${Brand.hex('highlight')} 78% 100%); }
  table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #c9d1de; padding: 3px 6px; text-align: left; vertical-align: top; }
  th { background: ${Brand.tint('primary', 0.84)}; } tfoot td { font-weight: bold; background: #f2f5fa; } .n { text-align: right; white-space: nowrap; } .e { text-align: center; color: #7c869b; }
  thead { display: table-header-group; } tr { page-break-inside: avoid; }
</style></head><body>
<h1>${U.esc(m.title)}</h1>${m.subtitle ? `<div class="sub">${U.esc(m.subtitle)}</div>` : ''}<div class="meta">${U.esc(this.meta())}</div><div class="bar"></div>
${m.sections.map(s => `${s.heading ? `<h2>${U.esc(s.heading)}</h2>` : ''}${table(s)}`).join('\n')}
</body></html>`;
  },

  html(m) { return new Blob([this.htmlDoc(m)], { type: 'text/html;charset=utf-8' }); },

  print(m) {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(frame);
    frame.contentDocument.open();
    frame.contentDocument.write(this.htmlDoc(m));
    frame.contentDocument.close();
    setTimeout(() => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 2000); }, 250);
  },

  /* ---------- Excel (.xlsx): one worksheet per section ---------- */
  xlsx(m) {
    const used = new Set();
    const sheetName = (name, i) => {
      let n = String(name || `Sheet${i + 1}`).replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || `Sheet${i + 1}`;
      let k = 2;
      while (used.has(n.toLowerCase())) n = `${n.slice(0, 28)} ${k++}`;
      used.add(n.toLowerCase());
      return n;
    };
    const colRef = i => { let s = ''; i += 1; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
    const numStyle = (col, bold) => col?.num === 0 ? (bold ? 8 : 4) : col?.num === 4 ? 5 : (bold ? 7 : 2);
    const cell = (ref, v, col, style) => {
      if (v == null || v === '') return '';
      if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}" s="${style ?? numStyle(col, false)}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${this.xml(v)}</t></is></c>`;
    };

    const sheets = (m.sections.length ? m.sections : [{ heading: m.title, columns: [], rows: [] }]).map((s, si) => {
      const name = sheetName(s.heading || m.title, si);
      const rows = [];
      let r = 1;
      rows.push(`<row r="${r}">${cell(`A${r}`, m.title, null, 3)}</row>`); r++;
      if (s.heading && s.heading !== m.title) { rows.push(`<row r="${r}">${cell(`A${r}`, s.heading, null, 6)}</row>`); r++; }
      if (m.subtitle) { rows.push(`<row r="${r}">${cell(`A${r}`, m.subtitle)}</row>`); r++; }
      rows.push(`<row r="${r}">${cell(`A${r}`, this.meta())}</row>`); r += 2;
      const headRow = r;
      rows.push(`<row r="${r}">${s.columns.map((c, i) => cell(`${colRef(i)}${r}`, c.label, null, 1)).join('')}</row>`); r++;
      s.rows.forEach(row => { rows.push(`<row r="${r}">${row.map((v, i) => cell(`${colRef(i)}${r}`, v, s.columns[i])).join('')}</row>`); r++; });
      if (s.totals) rows.push(`<row r="${r}">${s.totals.map((v, i) => typeof v === 'number' ? cell(`${colRef(i)}${r}`, v, s.columns[i], numStyle(s.columns[i], true)) : cell(`${colRef(i)}${r}`, v, null, 6)).join('')}</row>`);
      const lastRow = headRow + s.rows.length;
      const widths = s.columns.map((c, i) => Math.min(60, Math.max(8, String(c.label).length + 2, ...s.rows.slice(0, 500).map(row => this.text(row[i], c).split('\n')[0].length + 2))));
      const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headRow}" topLeftCell="A${headRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
${widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : ''}
<sheetData>${rows.join('')}</sheetData>
${s.columns.length && s.rows.length ? `<autoFilter ref="A${headRow}:${colRef(s.columns.length - 1)}${lastRow}"/>` : ''}
</worksheet>`;
      return { name, xml };
    });

    const ns = 'http://schemas.openxmlformats.org';
    const files = [
      ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
      ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets>
${sheets.map((s, i) => `<sheet name="${this.xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
      ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${ns}/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${sheets.length + 1}" Type="${ns}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${ns}/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.0000"/></numFmts>
<fonts count="3"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="${Brand.argb(Brand.hex('primary'))}"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="${Brand.argb(Brand.tint('primary', 0.84))}"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="3" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
      ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, s.xml]),
    ];
    return Zip.build(files, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  },

  /* ---------- Word (.docx), landscape A4 ---------- */
  docx(m) {
    const run = (text, o = {}) => {
      const rpr = `<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>${o.bold ? '<w:b/>' : ''}${o.color ? `<w:color w:val="${o.color}"/>` : ''}<w:sz w:val="${o.size || 20}"/></w:rPr>`;
      return String(text ?? '').split('\n').map((line, i) => `${i ? `<w:r>${rpr}<w:br/></w:r>` : ''}<w:r>${rpr}<w:t xml:space="preserve">${this.xml(line)}</w:t></w:r>`).join('');
    };
    const para = (text, o = {}) => `<w:p><w:pPr><w:spacing w:before="${o.before || 0}" w:after="${o.after ?? 80}"/>${o.right ? '<w:jc w:val="right"/>' : ''}</w:pPr>${run(text, o)}</w:p>`;
    const border = 'w:val="single" w:sz="4" w:space="0" w:color="BFC7D5"';
    const table = s => {
      const size = s.columns.length > 9 ? 14 : 16;
      const tc = (text, o = {}) => `<w:tc><w:tcPr>${o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : ''}</w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0"/>${o.right ? '<w:jc w:val="right"/>' : ''}</w:pPr>${run(text, { size, bold: o.bold })}</w:p></w:tc>`;
      const rows = [
        `<w:tr><w:trPr><w:tblHeader/></w:trPr>${s.columns.map(c => tc(c.label, { bold: true, fill: Brand.office(Brand.tint('primary', 0.84)), right: c.num != null })).join('')}</w:tr>`,
        ...s.rows.map(r => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${s.columns.map((c, i) => tc(this.text(r[i], c), { right: c.num != null })).join('')}</w:tr>`),
      ];
      if (!s.rows.length) rows.push(`<w:tr>${s.columns.map((c, i) => tc(i === 0 ? 'No data' : '')).join('')}</w:tr>`);
      if (s.totals) rows.push(`<w:tr>${s.columns.map((c, i) => tc(this.text(s.totals[i], c), { bold: true, fill: 'F2F5FA', right: c.num != null })).join('')}</w:tr>`);
      return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top ${border}/><w:left ${border}/><w:bottom ${border}/><w:right ${border}/><w:insideH ${border}/><w:insideV ${border}/></w:tblBorders>
        <w:tblCellMar><w:top w:w="20" w:type="dxa"/><w:left w:w="70" w:type="dxa"/><w:bottom w:w="20" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr>${rows.join('')}</w:tbl>`;
    };
    const body = [
      para(m.title, { bold: true, size: 32, color: Brand.office(Brand.hex('primary')), after: 40 }),
      m.subtitle ? para(m.subtitle, { size: 20, color: '47526B', after: 20 }) : '',
      para(this.meta(), { size: 16, color: '7C869B', after: 160 }),
      ...m.sections.map(s => `${s.heading ? para(s.heading, { bold: true, size: 24, before: 200, after: 80 }) : ''}${table(s)}`),
      '<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>',
    ].join('');
    const ns = 'http://schemas.openxmlformats.org';
    return Zip.build([
      ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`],
      ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`],
      ['word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${ns}/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`],
    ], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  },

  /* ---------- PDF (A4 landscape, Helvetica) ---------- */
  pdf(m) { return PdfWriter.report(m, this.meta()); },
};

/* Minimal ZIP writer (stored, no compression) for .xlsx / .docx packages. */
const Zip = {
  table: null,
  crc32(bytes) {
    if (!this.table) {
      this.table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; this.table[n] = c >>> 0; }
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = this.table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  },
  build(files, type) {
    const enc = new TextEncoder();
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const parts = [], central = [];
    let offset = 0;
    const u16 = v => [v & 0xFF, (v >> 8) & 0xFF];
    const u32 = v => [v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >>> 24) & 0xFF];
    files.forEach(([name, content]) => {
      const nameBytes = enc.encode(name);
      const data = typeof content === 'string' ? enc.encode(content) : content;
      const crc = this.crc32(data);
      const local = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(date), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0)]);
      parts.push(local, nameBytes, data);
      central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(date), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nameBytes);
      offset += local.length + nameBytes.length + data.length;
    });
    const cdSize = central.reduce((t, p) => t + p.length, 0);
    const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
    return new Blob([...parts, ...central, end], { type });
  },
};

/* Minimal PDF writer: text tables with wrapping, repeated headers and page numbers. */
const PdfWriter = {
  W: 842, H: 595, M: 32,   // A4 landscape, points
  // Helvetica / Helvetica-Bold advance widths for ASCII 32–126 (per 1000 em).
  HELV: [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584],
  HELVB: [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584],
  WIN: { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99 },
  SUB: { '≈': '~', '→': '->', '←': '<-', '✓': 'v', '✕': 'x', '⇩': '', '▾': '', '≤': '<=', '≥': '>=' },

  clean(s) { return String(s ?? '').replace(/[≈→←✓✕⇩▾≤≥]/g, c => this.SUB[c]).replace(/\s*\n\s*/g, ' \n '); },

  width(s, bold, size) {
    const t = bold ? this.HELVB : this.HELV;
    let w = 0;
    for (const ch of s) { const c = ch.charCodeAt(0); w += c >= 32 && c <= 126 ? t[c - 32] : 556; }
    return (w * size) / 1000;
  },

  /* Encode as a PDF literal string in WinAnsi, keeping the file pure ASCII (octal escapes). */
  str(s) {
    let out = '';
    for (const ch of s) {
      let b = ch.charCodeAt(0);
      if (b > 255) b = this.WIN[ch] ?? 63;
      else if (b >= 128 && b < 160) b = 63;
      if (b === 40 || b === 41 || b === 92) out += '\\' + String.fromCharCode(b);
      else if (b < 32 || b > 126) out += '\\' + b.toString(8).padStart(3, '0');
      else out += String.fromCharCode(b);
    }
    return `(${out})`;
  },

  wrap(text, maxW, bold, size, maxLines = 8) {
    const lines = [];
    String(text).split(' \n ').forEach(para => {
      let line = '';
      para.split(/ +/).forEach(word => {
        while (this.width(word, bold, size) > maxW && word.length > 1) {      // break very long words
          let k = word.length - 1;
          while (k > 1 && this.width(word.slice(0, k), bold, size) > maxW) k--;
          if (line) { lines.push(line); line = ''; }
          lines.push(word.slice(0, k)); word = word.slice(k);
        }
        const test = line ? `${line} ${word}` : word;
        if (this.width(test, bold, size) <= maxW) line = test;
        else { if (line) lines.push(line); line = word; }
      });
      lines.push(line);
    });
    if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] += '…'; }
    return lines;
  },

  report(m, meta) {
    const { W, H, M } = this;
    const pages = [];
    let ops, y;
    const T = (x, yy, s, bold, size, rgb = '0.08 0.13 0.23') => ops.push(`BT ${rgb} rg /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${(H - yy).toFixed(2)} Td ${this.str(s)} Tj ET`);
    const rect = (x, yy, w, h, rgb) => ops.push(`${rgb} rg ${x.toFixed(2)} ${(H - yy - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    const line = (x1, y1, x2, y2, rgb = '0.79 0.82 0.87', w = 0.5) => ops.push(`${rgb} RG ${w} w ${x1.toFixed(2)} ${(H - y1).toFixed(2)} m ${x2.toFixed(2)} ${(H - y2).toFixed(2)} l S`);
    const newPage = () => {
      ops = []; pages.push(ops); y = M;
      if (pages.length > 1) { T(M, y + 8, this.clean(m.title), true, 9, Brand.pdf(Brand.hex('primary'))); y += 20; }
    };
    const bottom = H - M - 16;

    newPage();
    T(M, y + 14, this.clean(m.title), true, 16, Brand.pdf(Brand.hex('primary'))); y += 24;
    if (m.subtitle) { T(M, y + 9, this.clean(m.subtitle), false, 9, '0.28 0.32 0.42'); y += 13; }
    T(M, y + 8, this.clean(meta), false, 7.5, '0.49 0.53 0.61'); y += 10;
    rect(M, y, (W - 2 * M) * 0.55, 2.5, Brand.pdf(Brand.hex('primary'))); rect(M + (W - 2 * M) * 0.55, y, (W - 2 * M) * 0.23, 2.5, Brand.pdf(Brand.hex('accent'))); rect(M + (W - 2 * M) * 0.78, y, (W - 2 * M) * 0.22, 2.5, Brand.pdf(Brand.hex('highlight')));
    y += 12;

    const avail = W - 2 * M, size = 7.5, lh = 9.2, pad = 3;
    m.sections.forEach(s => {
      const cols = s.columns;
      const cells = s.rows.map(r => cols.map((c, i) => this.clean(Export.text(r[i], c))));
      const tot = s.totals ? cols.map((c, i) => this.clean(Export.text(s.totals[i], c))) : null;
      // Column widths from content, scaled to the page.
      const natural = cols.map((c, i) => Math.min(220, Math.max(this.width(this.clean(c.label), true, size), ...cells.slice(0, 300).map(r => Math.max(...r[i].split(' \n ').map(p => this.width(p, false, size))))) + 2 * pad));
      const minW = cols.map(c => Math.min(70, Math.max(28, ...this.clean(c.label).split(' ').map(w => this.width(w, true, size) + 2 * pad))));
      let widths = natural.slice();
      const sum = widths.reduce((a, b) => a + b, 0);
      if (sum > avail) {
        const flex = sum - minW.reduce((a, b) => a + b, 0);
        const over = sum - avail;
        widths = widths.map((w, i) => flex > 0 ? Math.max(minW[i], w - (w - minW[i]) / flex * over) : w * avail / sum);
        const s2 = widths.reduce((a, b) => a + b, 0);
        if (s2 > avail) widths = widths.map(w => w * avail / s2);
      } else widths = widths.map(w => w * avail / sum);
      const xs = widths.reduce((acc, w, i) => { acc.push(i ? acc[i - 1] + widths[i - 1] : M); return acc; }, []);

      const header = () => {
        const hl = cols.map((c, i) => this.wrap(this.clean(c.label), widths[i] - 2 * pad, true, size, 3));
        const h = Math.max(...hl.map(l => l.length)) * lh + 2 * pad;
        rect(M, y, avail, h, Brand.pdf(Brand.tint('primary', 0.84)));
        hl.forEach((lines, i) => lines.forEach((t, k) => {
          const x = cols[i].num != null ? xs[i] + widths[i] - pad - this.width(t, true, size) : xs[i] + pad;
          T(x, y + pad + (k + 1) * lh - 2, t, true, size);
        }));
        y += h;
        line(M, y, M + avail, y, '0.6 0.65 0.75', 0.7);
      };
      const drawRow = (r, bold, fill) => {
        const wrapped = r.map((t, i) => this.wrap(t, widths[i] - 2 * pad, bold, size));
        const h = Math.max(1, ...wrapped.map(l => l.length)) * lh + 2 * pad;
        if (y + h > bottom) { newPage(); header(); }
        if (fill) rect(M, y, avail, h, fill);
        wrapped.forEach((lines, i) => lines.forEach((t, k) => {
          const x = cols[i].num != null ? xs[i] + widths[i] - pad - this.width(t, bold, size) : xs[i] + pad;
          T(x, y + pad + (k + 1) * lh - 2, t, bold, size);
        }));
        y += h;
        line(M, y, M + avail, y);
      };

      if (y + 60 > bottom) newPage();
      if (s.heading) { y += 6; T(M, y + 10, this.clean(s.heading), true, 11); y += 16; }
      header();
      if (!cells.length) drawRow(cols.map((c, i) => i === 0 ? 'No data' : ''), false);
      cells.forEach((r, i) => drawRow(r, false, i % 2 ? '0.975 0.98 0.99' : null));
      if (tot) drawRow(tot, true, '0.95 0.96 0.98');
      y += 10;
    });

    // Footers with "Page n of N".
    pages.forEach((p, i) => {
      ops = p;
      line(M, H - M - 8, W - M, H - M - 8, '0.85 0.87 0.9');
      T(M, H - M + 2, this.clean(`${m.title} · ${Store.state.bank.name}`), false, 7, '0.49 0.53 0.61');
      const pg = `Page ${i + 1} of ${pages.length}`;
      T(W - M - this.width(pg, false, 7), H - M + 2, pg, false, 7, '0.49 0.53 0.61');
    });

    // Assemble objects: 1 catalog, 2 pages, 3–4 fonts, then page + content per page.
    const objs = [];
    const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ');
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    pages.forEach((p, i) => {
      const stream = p.join('\n');
      objs[5 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`;
      objs[6 + i * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    });
    let out = '%PDF-1.4\n';
    const offsets = [];
    for (let i = 1; i < objs.length; i++) { offsets[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
    const xref = out.length;
    out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info << /Title ${this.str(this.clean(m.title))} /Producer ${this.str(this.clean(Brand.current.productName))} >> >>\nstartxref\n${xref}\n%%EOF`;
    return new Blob([out], { type: 'application/pdf' });
  },
};
