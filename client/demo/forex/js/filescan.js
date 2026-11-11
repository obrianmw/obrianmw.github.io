'use strict';

/* Security check for every document before it is stored – the same file in all three versions.
   Every upload goes through FileStore.put (application documents, reconciliation documents, change-of-supplier
   documents, backup restores), so the check is placed there; the branding logo, icon and brand file are checked in
   Admin → Branding. The Live and Universal servers repeat the same checks (server/FileScan.java) and then scan
   with the virus scanner, because a browser can be bypassed. A refused file is not stored and goes to the audit trail.
   1. Only document types: PDF, PNG/JPG/GIF/WEBP/BMP images, Word (.doc/.docx), Excel (.xls/.xlsx), CSV and text.
      Programs, scripts, archives, web pages and macro-enabled Office files are refused, as are names that hide a
      program type (invoice.exe.pdf) or use direction-control characters.
   2. The content must really be the type its name says (checked from the file's first bytes).
   3. Active content is refused: JavaScript, launch actions and embedded files in PDFs; macros, ActiveX, embedded
      objects, remote templates and DDE in Office files; script or program code in text and images; formulas in CSV;
      encrypted or oversized ("zip bomb") Office files. */
const FileScan = {
  MAX_UNZIPPED: 200 * 1024 * 1024,
  ALLOWED: ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt'],
  DANGEROUS: new Set(['exe', 'dll', 'com', 'scr', 'pif', 'cpl', 'msi', 'msp', 'msc', 'bat', 'cmd', 'ps1', 'psm1', 'psd1', 'vbs', 'vbe',
    'js', 'jse', 'mjs', 'wsf', 'wsh', 'hta', 'jar', 'class', 'lnk', 'reg', 'inf', 'sys', 'drv', 'ocx', 'sh', 'bash', 'py', 'pl', 'rb',
    'php', 'asp', 'aspx', 'jsp', 'html', 'htm', 'xhtml', 'svg', 'xml', 'iso', 'img', 'vhd', 'vhdx', 'zip', 'rar', '7z', 'cab', 'gz',
    'tar', 'docm', 'xlsm', 'pptm', 'dotm', 'xltm', 'xlam', 'ppam', 'sldm', 'appx', 'msix', 'apk', 'dmg', 'app', 'deb', 'rpm', 'url',
    'scf', 'chm', 'application', 'gadget', 'mht', 'mhtml']),
  PDF_ACTIVE: new Set(['JavaScript', 'JS', 'Launch', 'EmbeddedFile', 'EmbeddedFiles', 'RichMedia', 'ImportData', 'XFA']),
  CODE: /<script\b|<\?php|javascript:|vbscript:|<iframe\b|<object\b|<embed\b|\bpowershell\b|\bcmd(\.exe)?\s*\/[ck]\b|\bwscript\.|\bcscript\b|\bcreateobject\s*\(|\binvoke-expression\b|\bfrombase64string\b|\bdocument\.write\s*\(|\beval\s*\(/i,
  SVG_ACTIVE: /<script\b|\son[a-z]+\s*=|javascript:|<foreignObject\b|<iframe\b|<embed\b|<object\b|<!ENTITY|<\?xml-stylesheet|(href|xlink:href)\s*=\s*["']\s*(https?:|\/\/|data:(?!image\/(png|jpe?g|gif|webp)))/i,

  /* ---------- small helpers ---------- */
  latin1(b) { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return s; },
  starts(b, at, ...sig) { if (b.length < at + sig.length) return false; for (let i = 0; i < sig.length; i++) if (b[at + i] !== sig[i]) return false; return true; },
  utf16(s) { return s.split('').map(c => c + '\0').join(''); },
  u16(b, at) { return b[at] | (b[at + 1] << 8); },
  u32(b, at) { return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0; },

  /* Unpacks deflate data ('deflate' = zlib as in PDF, 'deflate-raw' as in zip); null when the browser cannot or the
     data is not deflate. Stops at the limit. */
  async inflate(bytes, format, limit) {
    if (typeof DecompressionStream === 'undefined') return null;
    try {
      const ds = new DecompressionStream(format);
      const w = ds.writable.getWriter();
      w.write(bytes).catch(() => {}); w.close().catch(() => {});
      const r = ds.readable.getReader(), parts = [];
      let n = 0;
      for (;;) {
        let x;
        try { x = await r.read(); } catch (e) { break; }
        if (x.done) break;
        parts.push(x.value); n += x.value.length;
        if (n > limit) { r.cancel().catch(() => {}); break; }
      }
      if (!n) return null;
      const out = new Uint8Array(n);
      let o = 0; parts.forEach(p => { out.set(p.subarray(0, Math.min(p.length, n - o)), o); o += p.length; });
      return out;
    } catch (e) { return null; }
  },

  /* ---------- documents ---------- */

  /* Why the file must not be stored, or null when it may. */
  async problem(file, name = file && file.name) {
    const n = String(name || '').trim();
    if (/[‪-‮⁦-⁩‎‏]/.test(n)) return 'the file name hides its real type';
    const parts = n.toLowerCase().split('.');
    if (parts.length < 2 || !parts[parts.length - 1]) return 'the file name has no type (such as .pdf)';
    const ext = parts.pop();
    const hidden = parts.slice(1).find(p => this.DANGEROUS.has(p));
    if (hidden) return `the file name hides a program type (.${hidden})`;
    if (!this.ALLOWED.includes(ext)) return `.${ext} files are not accepted – only PDF, images (PNG, JPG, GIF, WEBP, BMP), Word, Excel, CSV and text`;
    if (!file.size) return 'the file is empty';
    const b = new Uint8Array(await file.arrayBuffer());
    const s = this.latin1(b);
    if (s.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) return 'it contains a virus test signature (EICAR)';
    const prog = this.program(b);
    if (prog) return `it is a ${prog}, not a document`;
    if (ext === 'pdf') return this.pdf(b, s);
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return this.image(b, s, ext);
    if (ext === 'docx' || ext === 'xlsx') return this.ooxml(b, ext);
    if (ext === 'doc' || ext === 'xls') return this.ole(b, s, ext);
    return this.text(b, ext);
  },

  /* Programs and archives, recognised from their first bytes whatever the file is called. */
  program(b) {
    if (this.starts(b, 0, 0x4D, 0x5A) && b.length > 0x40) {
      const pe = this.u32(b, 0x3C);
      if (pe > 0 && pe < b.length - 4 && this.starts(b, pe, 0x50, 0x45, 0, 0)) return 'Windows program (.exe/.dll)';
    }
    const sigs = [[[0x7F, 0x45, 0x4C, 0x46], 'Linux program'], [[0xCA, 0xFE, 0xBA, 0xBE], 'Mac or Java program'],
      [[0xFE, 0xED, 0xFA, 0xCE], 'Mac program'], [[0xFE, 0xED, 0xFA, 0xCF], 'Mac program'], [[0xCE, 0xFA, 0xED, 0xFE], 'Mac program'],
      [[0xCF, 0xFA, 0xED, 0xFE], 'Mac program'], [[0x23, 0x21], 'script (#!)'], [[0x52, 0x61, 0x72, 0x21], 'RAR archive'],
      [[0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C], '7-Zip archive'], [[0x4D, 0x53, 0x43, 0x46], 'cabinet archive'], [[0x1F, 0x8B], 'gzip archive']];
    const hit = sigs.find(([sig]) => this.starts(b, 0, ...sig));
    return hit ? hit[1] : null;
  },

  /* PDF names are read from the structure, not from data inside streams (fonts and images can contain any bytes).
     Object streams hold more structure in compressed form, so those are unpacked and read too. */
  async pdf(b, s) {
    const at = s.indexOf('%PDF-');
    if (at < 0 || at > 1024) return 'it is not a real PDF (the content does not match the .pdf name)';
    let structure = '', pos = 0, budget = 50 * 1024 * 1024, streams = 0;
    const re = /(?<!end)stream\r?\n/g;
    for (;;) {
      re.lastIndex = pos;
      const m = re.exec(s);
      if (!m || streams++ > 5000) break;
      const start = m.index + m[0].length, end = s.indexOf('endstream', start);
      if (end < 0) break;
      structure += s.slice(pos, m.index);
      const obj = s.lastIndexOf(' obj', m.index);
      if (obj >= pos && s.slice(obj, m.index).includes('/ObjStm') && budget > 0) {
        const out = await this.inflate(b.subarray(start, end), 'deflate', budget);
        if (out) { budget -= out.length; structure += '\n' + this.latin1(out) + '\n'; }
      }
      pos = end + 'endstream'.length;
    }
    if (pos < s.length) structure += s.slice(pos);
    const hit = this.pdfActive(structure);
    return hit ? `it contains active content (/${hit})` : null;
  },
  pdfActive(s) {
    const re = /\/([A-Za-z0-9#]{2,40})/g;
    let m;
    while ((m = re.exec(s))) {
      const name = m[1].includes('#') ? m[1].replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) : m[1];
      if (this.PDF_ACTIVE.has(name)) return name;
    }
    return null;
  },

  image(b, s, ext) {
    const real = { png: () => this.starts(b, 0, 0x89, 0x50, 0x4E, 0x47), jpg: () => this.starts(b, 0, 0xFF, 0xD8, 0xFF), jpeg: () => this.starts(b, 0, 0xFF, 0xD8, 0xFF),
      gif: () => this.starts(b, 0, 0x47, 0x49, 0x46, 0x38), webp: () => this.starts(b, 0, 0x52, 0x49, 0x46, 0x46) && this.starts(b, 8, 0x57, 0x45, 0x42, 0x50),
      bmp: () => this.starts(b, 0, 0x42, 0x4D) }[ext]();
    if (!real) return `it is not a real .${ext} image (the content does not match the name)`;
    if (this.CODE.test(s)) return 'it hides script or program code inside the image';
    return null;
  },

  /* .docx / .xlsx are zip packages: read the list of parts, unpack the few that can carry active content. */
  async ooxml(b, ext) {
    if (!this.starts(b, 0, 0x50, 0x4B, 0x03, 0x04)) return `it is not a real .${ext} file (the content does not match the name)`;
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (this.u32(b, i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) return 'it could not be checked (it is damaged)';
    const count = this.u16(b, eocd + 10);
    let p = this.u32(b, eocd + 16), total = 0;
    const names = [], parts = {};
    for (let k = 0; k < count; k++) {
      if (this.u32(b, p) !== 0x02014b50) return 'it could not be checked (it is damaged)';
      const flags = this.u16(b, p + 8), method = this.u16(b, p + 10), csize = this.u32(b, p + 20), usize = this.u32(b, p + 24);
      const nlen = this.u16(b, p + 28), xlen = this.u16(b, p + 30), clen = this.u16(b, p + 32), local = this.u32(b, p + 42);
      const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      names.push(name);
      const lower = name.toLowerCase();
      if (flags & 1) return 'it could not be checked (it is encrypted)';
      total += usize;
      if (total > this.MAX_UNZIPPED) return 'it unpacks to an unsafe size (a possible "zip bomb")';
      if (/vbaproject\.bin$|vbadata\.xml$/.test(lower)) return 'it contains macros';
      if (lower.includes('activex/')) return 'it contains ActiveX controls';
      if (lower.includes('embeddings/') && (lower.endsWith('.bin') || lower.includes('oleobject'))) return 'it contains an embedded object or program';
      const dot = lower.lastIndexOf('.');
      if (dot > 0 && this.DANGEROUS.has(lower.slice(dot + 1)) && !lower.endsWith('.xml')) return `it contains a hidden file (${name})`;
      const keep = lower === '[content_types].xml' || lower.endsWith('.rels') || lower === 'word/document.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(lower);
      if (keep) {
        const start = local + 30 + this.u16(b, local + 26) + this.u16(b, local + 28);
        const data = b.subarray(start, start + csize);
        const raw = method === 0 ? data : method === 8 ? await this.inflate(data, 'deflate-raw', 20 * 1024 * 1024) : null;
        if (raw) parts[lower] = new TextDecoder().decode(raw);
        else if (lower === '[content_types].xml') return 'it could not be checked in this browser (use a current Chrome, Edge or Firefox)';
      }
    }
    const types = parts['[content_types].xml'];
    if (types == null || !names.includes(ext === 'docx' ? 'word/document.xml' : 'xl/workbook.xml')) return `it is not a real .${ext} file (the content does not match the name)`;
    if (types.toLowerCase().includes('macroenabled')) return 'it is a macro-enabled file';
    for (const [k, v] of Object.entries(parts)) {
      if (!k.endsWith('.rels')) continue;
      for (const rel of v.match(/<Relationship\b[^>]*>/gi) || []) {
        const r = rel.toLowerCase();
        if (r.includes('targetmode="external"') && /type="[^"]*(attachedtemplate|oleobject|frame|subdocument|package)"/.test(r)) return 'it loads content from outside the file (remote template or object)';
      }
    }
    const doc = parts['word/document.xml'];
    if (doc && (doc.includes('DDEAUTO') || /<w:instrText[^>]*>\s*DDE\b/.test(doc))) return 'it contains a DDE command field';
    for (const [k, v] of Object.entries(parts)) if (k.startsWith('xl/worksheets/') && /<f[^>]*>[^<]*\|/.test(v)) return 'it contains a DDE command formula';
    return null;
  },

  /* .doc / .xls (Office 97-2003) */
  ole(b, s, ext) {
    if (!this.starts(b, 0, 0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1)) return `it is not a real .${ext} file (the content does not match the name)`;
    const real = ext === 'doc' ? s.includes(this.utf16('WordDocument')) : (s.includes(this.utf16('Workbook')) || s.includes(this.utf16('Book')));
    if (!real) return `it is not a real .${ext} file (the content does not match the name)`;
    if (s.includes(this.utf16('_VBA_PROJECT'))) return 'it contains macros';
    if (s.includes(this.utf16('Ole10Native'))) return 'it contains an embedded object or program';
    if (s.includes(this.utf16('Equation Native'))) return 'it contains an old Equation Editor object (used by known attacks)';
    return null;
  },

  text(b, ext) {
    if (b.includes(0)) return 'it is not a plain text file';
    const t = new TextDecoder().decode(b);
    if (this.CODE.test(t)) return 'it contains script or program code';
    if (ext === 'csv') {
      for (const line of t.split(/\r?\n/)) {
        for (let cell of line.split(/[,;\t]/)) {
          cell = cell.trim();
          if (cell.startsWith('"')) cell = cell.slice(1).trim();
          if (/^[=@]/.test(cell) || /^[+-][A-Za-z(]/.test(cell)) return 'it contains spreadsheet formulas, which can run commands';
        }
      }
    }
    return null;
  },

  /* ---------- branding logo and icon ---------- */

  /* An uploaded logo or icon (PNG, JPG or SVG). */
  async brandProblem(file) {
    const ext = String(file.name || '').toLowerCase().split('.').pop();
    if (!['png', 'jpg', 'jpeg', 'svg'].includes(ext)) return 'only PNG, JPG and SVG images are accepted';
    const b = new Uint8Array(await file.arrayBuffer());
    const s = this.latin1(b);
    if (s.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) return 'it contains a virus test signature (EICAR)';
    if (ext !== 'svg') return this.image(b, s, ext);
    const t = new TextDecoder().decode(b);
    if (!t.toLowerCase().includes('<svg')) return 'it is not a real SVG image';
    return this.SVG_ACTIVE.test(t) ? 'the SVG image contains script or links to outside content' : null;
  },

  /* A logo or icon value from a brand file: a bundled image file, or an image kept as a data: URL. */
  async brandValueProblem(v) {
    v = String(v || '').trim();
    if (!v) return null;
    if (!v.startsWith('data:')) return /^(brand|assets\/brand)\/[A-Za-z0-9._-]+\.(svg|png|jpe?g)$/.test(v) ? null : 'it must be an uploaded image or one of the bundled logo files';
    const m = /^data:(image\/(?:png|jpeg|svg\+xml));base64,([A-Za-z0-9+/=\s]+)$/.exec(v);
    if (!m) return 'only PNG, JPG and SVG images are accepted';
    let bin;
    try { bin = Uint8Array.from(atob(m[2].replace(/\s/g, '')), c => c.charCodeAt(0)); } catch (e) { return 'the image data is damaged'; }
    const name = { 'image/png': 'logo.png', 'image/jpeg': 'logo.jpg', 'image/svg+xml': 'logo.svg' }[m[1]];
    return this.brandProblem(new File([bin], name, { type: m[1] }));
  },

  /* ---------- refusing ---------- */

  /* Records the refusal in the audit trail and stops the upload with a message saying why. */
  refuse(name, why) {
    try { Store.audit('UPLOAD_BLOCKED', null, `${name}: ${why}`); Store.save(); } catch (e) { /* not signed in yet */ }
    throw new WorkflowError(`${name} was not uploaded: ${why}.`);
  },
  async assert(file, name = file && file.name) {
    let why;
    try { why = await this.problem(file, name); } catch (e) { why = 'it could not be checked'; }
    if (why) this.refuse(name || 'The file', why);
  },
};

/* Every document is checked before it is stored, whichever screen it comes from. */
(() => {
  const basePut = FileStore.put.bind(FileStore);
  FileStore.put = async (id, blob) => { await FileScan.assert(blob, blob.name); return basePut(id, blob); };
})();
