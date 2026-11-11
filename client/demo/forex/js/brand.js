'use strict';

/* ======================================================================
   BRANDING – names, logo, colours, light/dark mode and the email layout.
   These are the starting values. Admin → Branding changes them for everyone
   (saved with the system's data) and overrides what is set here.
   ====================================================================== */
const BRAND_FILE = 'js/brand.js';    // this file, as named on the Branding page
const BRAND_ASSET_DIR = 'assets/brand/';   // folder of the official logo files listed on the Branding page (BRAND_ASSETS in config.js)

const BRAND_DEFAULTS = {
  productName: 'Forex Applications',                              // name of the system
  bankName: 'Demo Bank',                                          // bank name (titles, exports, emails)
  tagline: 'FX Applications & Demand Tracking',                   // line under the product name
  logo: 'assets/brand/logo.svg',     // wide logo shown on the logo band (sidebar + sign-in card + emails)
  icon: 'assets/brand/icon.svg',  // browser-tab icon
  colors: {
    primary: '#1f5fbf',       // main colour: buttons, links, headings, sidebar (a darker shade is derived)
    accent: '#e4572e',        // accent: second stripe colour under the logo, exports
    highlight: '#f2c14e',     // highlight: third stripe colour under the logo, exports
  },
  emailDomain: 'demobank.example',                              // used for test users

  /* Screen colours for light and dark mode. '' means "automatic" (worked out from the main colour).
     Text colours are always chosen automatically so they stay readable on whatever background is set. */
  theme: {
    mode: 'light',            // starting mode for everyone: 'light', 'dark' or 'system' (follow the device)
    userSwitch: true,         // let each user switch between light and dark for themselves
    logoBand: '#ffffff',      // band behind the logo (sidebar and sign-in card) – the logo needs white
    light: { background: '#f4f6fa', surface: '#ffffff', header: '#ffffff', sidebar: '', footer: '', login: '' },
    dark:  { background: '#0f1623', surface: '#172131', header: '#131c2b', sidebar: '#0b111c', footer: '#0b111c', login: '#070b13' },
  },

  /* Layout of every email the system sends (separate from SMS, which is plain text). */
  email: {
    background: '#f4f6fa',    // behind the message
    card: '#ffffff',          // the message itself
    text: '#1f2937',          // message text (darkened or lightened automatically if hard to read)
    header: '',               // title bar under the logo; '' = main colour
    button: '',               // links and buttons; '' = main colour
    footer: '#eef1f6',        // footer with the no-reply notice
    showLogo: true,           // logo band at the top
    stripe: true,             // the three-colour stripe under the logo
  },
};

/* ---------------------------------------------------------------------- */

const Brand = {
  current: null,
  PREF_KEY: 'fx.theme',             // each user's own light/dark choice, kept in this browser
  DARK_TEXT: '#15203a', LIGHT_TEXT: '#f1f4f9',
  previewMode: null,                // Admin → Branding: preview light or dark while editing
  printing: false,                  // printouts always use light colours

  valid(hex) { return /^#?[0-9a-f]{6}$/i.test(String(hex || '').trim()); },
  norm(hex) { return '#' + String(hex).trim().replace('#', '').toLowerCase(); },
  rgb(hex) { const n = parseInt(this.norm(hex).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; },
  hexOf(rgb) { return '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join(''); },
  /* Blend a colour towards another (t = 0 keeps it, 1 gives the other). */
  mix(hex, other, t) { const a = this.rgb(hex), b = this.rgb(other); return this.hexOf(a.map((v, i) => v + (b[i] - v) * t)); },

  /* ---------- readability (WCAG contrast) ---------- */
  lum(hex) {
    const [r, g, b] = this.rgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  },
  contrast(a, b) { const x = this.lum(a), y = this.lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); },
  /* Dark or light text, whichever reads better on this background. */
  onColor(bg) { return this.contrast(this.LIGHT_TEXT, bg) >= this.contrast(this.DARK_TEXT, bg) ? this.LIGHT_TEXT : this.DARK_TEXT; },
  isDark(bg) { return this.onColor(bg) === this.LIGHT_TEXT; },
  /* Keep a colour as close as possible to what was chosen, but move it until it reaches the contrast needed (4.5:1 = WCAG AA). */
  ensure(fg, bg, min = 4.5) {
    if (this.contrast(fg, bg) >= min) return fg;
    const target = this.onColor(bg);
    for (let t = 0.05; t < 1; t += 0.05) { const c = this.mix(fg, target, t); if (this.contrast(c, bg) >= min) return c; }
    return target;
  },
  /* A softer text colour (for labels and hints) that still passes the contrast given. */
  tier(bg, fg, t, min) { return this.ensure(this.mix(fg, bg, t), bg, min); },

  merge(over) {
    const d = JSON.parse(JSON.stringify(BRAND_DEFAULTS));
    if (over && typeof over === 'object') this.walk(d, over, true);
    return d;
  },
  /* Copy only known settings: colours must be valid hex (or keep their default), switches are true/false. */
  walk(dst, src, top) {
    Object.keys(dst).forEach(k => {
      const v = src[k], cur = dst[k];
      if (v == null) return;
      if (cur && typeof cur === 'object') { if (typeof v === 'object') this.walk(cur, v, false); }
      else if (typeof cur === 'boolean') dst[k] = v === true || v === 'true';
      else if (k === 'mode') { if (['light', 'dark', 'system'].includes(v)) dst[k] = v; }
      else if (!top) { if (this.valid(v)) dst[k] = this.norm(v); }
      else if (String(v).trim() !== '') dst[k] = v;
    });
  },

  /* ---------- light / dark mode ---------- */
  pref() { try { return localStorage.getItem(this.PREF_KEY); } catch (e) { return null; } },
  setPref(p) { try { localStorage.setItem(this.PREF_KEY, p); } catch (e) { /* private window */ } this.paint(); },
  mode(b = this.current) {
    if (this.printing) return 'light';
    if (this.previewMode) return this.previewMode;
    const p = this.pref();
    let m = b.theme.userSwitch && ['light', 'dark', 'system'].includes(p) ? p : b.theme.mode;
    if (m === 'system') m = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    return m;
  },
  toggle() {
    const next = this.mode() === 'dark' ? 'light' : 'dark';
    // On Admin → Branding the page is previewing one mode: the switch moves that page to the other mode as well.
    if (this.previewMode) document.dispatchEvent(new CustomEvent('brand:mode', { detail: next }));
    this.setPref(next);
  },
  toggleLabel() { return this.mode() === 'dark' ? '☀ Light' : '☾ Dark'; },
  /* Light/dark switch for the top bar and the sign-in page (nothing when the administrator has turned it off). */
  toggleButton(cls = 'btn-sm') {
    if (!this.current.theme.userSwitch) return '';
    const next = this.mode() === 'dark' ? 'light' : 'dark';
    return `<button type="button" class="${cls} theme-toggle" data-theme-toggle title="Switch to ${next} mode" aria-label="Switch to ${next} mode">${this.toggleLabel()}</button>`;
  },

  /* Every screen colour for one mode. Text colours are worked out from their backgrounds, so they always read clearly. */
  palette(b = this.current, mode = this.mode(b)) {
    const P = b.colors.primary, t = b.theme[mode] || b.theme.light;
    const bg = t.background, surface = t.surface, sd = this.isDark(surface);
    const sidebar = t.sidebar || this.mix(P, '#000000', 0.58);
    const header = t.header || surface;
    const footer = t.footer || surface;
    const login = t.login || sidebar;
    const text = base => { const fg = this.onColor(base); return [fg, this.tier(base, fg, 0.22, 7), this.tier(base, fg, 0.42, 4.5)]; };
    const v = {};
    const [ink, ink2, ink3] = text(surface), [pink, pink2, pink3] = text(bg);
    Object.assign(v, {
      '--bg': bg, '--card': surface,
      '--ink': ink, '--ink-2': ink2, '--ink-3': ink3,
      '--surface-ink': ink, '--surface-ink-2': ink2, '--surface-ink-3': ink3,
      '--page-ink': pink, '--page-ink-2': pink2, '--page-ink-3': pink3,
      '--line': this.mix(surface, ink, sd ? 0.17 : 0.11), '--line-2': this.mix(surface, ink, sd ? 0.1 : 0.06),
      '--grey-50': this.mix(surface, ink, sd ? 0.08 : 0.05), '--th-bg': this.mix(surface, ink, sd ? 0.04 : 0.02),
      '--row-hover': this.mix(surface, P, sd ? 0.09 : 0.03),
      '--input-bg': sd ? this.mix(surface, '#000000', 0.22) : surface, '--input-line': this.mix(surface, ink, sd ? 0.28 : 0.2),
      '--btn-bg': surface,
      '--blue': P, '--blue-700': this.mix(P, '#000000', 0.18), '--on-primary': this.onColor(P),
      '--blue-50': this.mix(surface, P, sd ? 0.16 : 0.07), '--blue-100': this.mix(surface, P, sd ? 0.32 : 0.16),
      '--link': this.ensure(P, surface, 4.5),
      '--brand-accent': b.colors.accent, '--brand-highlight': b.colors.highlight,
      '--logo-band': b.theme.logoBand,
    });
    v['--surface-line'] = v['--line'];
    v['--brand-ink'] = v['--blue-900'] = this.ensure(this.mix(P, sd ? '#ffffff' : '#000000', 0.55), v['--blue-50'], 7);
    // Status colours: the fills stay; their tints and text are re-worked for the background.
    [['red', '#e11d2e'], ['green', '#0b7a43'], ['amber', '#9a5b00'], ['violet', '#5b35c4'], ['teal', '#0b6f75']].forEach(([n, base]) => {
      const tint = this.mix(surface, base, sd ? 0.2 : 0.1);
      v[`--${n}-50`] = tint;
      v[`--${n}-fg`] = this.ensure(base, tint, 4.5);
      v[`--${n}-ink`] = this.ensure(base, tint, 7);
      v[`--${n}-line`] = this.mix(surface, base, sd ? 0.45 : 0.3);
    });
    const sfg = this.onColor(sidebar);
    const active = this.contrast(P, sidebar) >= 1.6 ? P : this.mix(sidebar, sfg, 0.2);   // keep the selected item visible
    Object.assign(v, {
      '--sidebar-bg': sidebar, '--sidebar-fg': sfg, '--sidebar-fg2': this.tier(sidebar, sfg, 0.16, 7), '--sidebar-fg3': this.tier(sidebar, sfg, 0.4, 4.5),
      '--sidebar-line': this.mix(sidebar, sfg, 0.12), '--sidebar-hover': this.mix(sidebar, sfg, 0.08), '--sidebar-chip': this.mix(sidebar, sfg, 0.16),
      '--nav-active': active, '--nav-active-fg': this.onColor(active),
    });
    const [hfg, hfg2, hfg3] = text(header);
    Object.assign(v, { '--header-bg': header, '--header-fg': hfg, '--header-fg2': hfg2, '--header-fg3': hfg3,
      '--header-line': this.mix(header, hfg, 0.13), '--header-btn': this.isDark(header) ? this.mix(header, hfg, 0.1) : header });
    const ffg = this.onColor(footer);
    Object.assign(v, { '--footer-bg': footer, '--footer-fg': ffg, '--footer-fg3': this.tier(footer, ffg, 0.35, 4.5), '--footer-line': this.mix(footer, ffg, 0.12) });
    Object.assign(v, { '--login-bg': login, '--login-fg3': this.tier(login, this.onColor(login), 0.4, 4.5) });
    return v;
  },

  /* Colour the page for the current mode. Safe to call any time. */
  paint() {
    const b = this.current;
    if (!b) return null;
    const mode = this.mode(b), v = this.palette(b, mode), root = document.documentElement;
    Object.entries(v).forEach(([k, x]) => root.style.setProperty(k, x));
    root.dataset.theme = mode;
    root.style.colorScheme = this.isDark(b.theme[mode].surface) ? 'dark' : 'light';   // native controls and scrollbars
    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
      btn.classList.toggle('hidden', !b.theme.userSwitch);
      const next = mode === 'dark' ? 'light' : 'dark';
      btn.textContent = this.toggleLabel(); btn.title = `Switch to ${next} mode`; btn.setAttribute('aria-label', btn.title);
    });
    return mode;
  },

  /* Apply branding to the page: colours, names, logo and tab icon. Safe to call any time. */
  apply(over) {
    const b = this.current = this.merge(over);
    const q = sel => document.querySelector(sel);
    const icon = q('link[rel="icon"]');
    if (icon) { icon.href = b.icon; icon.type = /^data:image\/svg|\.svg$/i.test(b.icon) ? 'image/svg+xml' : ''; }
    document.querySelectorAll('img[data-brand-logo]').forEach(img => { img.src = b.logo; img.alt = b.bankName; });
    if (q('#brand-product')) q('#brand-product').textContent = b.productName;
    if (q('#brand-tagline')) q('#brand-tagline').textContent = b.tagline;
    if (!document.title || /Forex Applications|·/.test(document.title)) document.title = `${b.productName} · ${b.bankName}`;
    this.paint();
    return b;
  },

  /* ---------- email layout ---------- */
  emailColors(b = this.current) {
    const e = b.email, P = b.colors.primary;
    const header = e.header || P, button = e.button || P;
    const text = this.ensure(e.text, e.card, 4.5);
    return {
      background: e.background, card: e.card, text, muted: this.tier(e.card, text, 0.35, 4.5),
      header, headerText: this.onColor(header), button, buttonText: this.onColor(button), link: this.ensure(button, e.card, 4.5),
      footer: e.footer, footerText: this.tier(e.footer, this.onColor(e.footer), 0.3, 4.5),
      outside: this.tier(e.background, this.onColor(e.background), 0.35, 4.5),
      textAdjusted: text !== e.text,
    };
  },
  /* A complete HTML email (inline styles and tables, as mail programs need) from a plain-text message. */
  emailHtml(m, b = this.current) {
    const k = this.emailColors(b), e = b.email, c = b.colors;
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const urlRe = /https?:\/\/[^\s<]+/g;
    const font = 'font-family:Segoe UI,Helvetica,Arial,sans-serif';
    const paras = String(m.body || '').trim().split(/\n{2,}/).map(p =>
      `<p style="margin:0 0 14px">${esc(p).replace(urlRe, u => `<a href="${u}" style="color:${k.link};word-break:break-all">${u}</a>`).replace(/\n/g, '<br>')}</p>`).join('');
    const first = (String(m.body || '').match(urlRe) || [])[0];
    const button = first ? `<p style="margin:4px 0 16px"><a href="${esc(first)}" style="display:inline-block;background:${k.button};color:${k.buttonText};padding:10px 20px;border-radius:6px;font-weight:600;text-decoration:none">Open the link</a></p>` : '';
    const foot = [m.footer ? esc(m.footer).replace(/\n/g, '<br>') : '', `This is an automated message from ${esc(b.bankName)}. Please do not reply to this email.`].filter(Boolean).join('<br><br>');
    // A mail program cannot open a path relative to this site, so the logo needs its full address.
    let logo = b.logo;
    try { if (!/^(data:|https?:)/i.test(logo)) logo = new URL(logo, location.href).href; } catch (err) { /* keep as is */ }
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(m.subject)}</title></head>
<body style="margin:0;padding:0;background:${k.background}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${k.background}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${k.card};border-radius:10px;overflow:hidden;${font};font-size:15px;line-height:1.5;color:${k.text}">
${e.showLogo ? `<tr><td style="background:${b.theme.logoBand};padding:18px 24px"><img src="${esc(logo)}" alt="${esc(b.bankName)}" style="display:block;max-height:46px;max-width:230px;border:0"></td></tr>` : ''}
${e.stripe ? `<tr><td style="padding:0;font-size:0;line-height:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="55%" height="4" style="background:${c.primary}"></td><td width="23%" height="4" style="background:${c.accent}"></td><td width="22%" height="4" style="background:${c.highlight}"></td></tr></table></td></tr>` : ''}
<tr><td style="background:${k.header};color:${k.headerText};padding:14px 24px;font-size:17px;font-weight:600">${esc(m.subject)}</td></tr>
<tr><td style="padding:22px 24px 8px">${paras}${button}</td></tr>
<tr><td style="background:${k.footer};color:${k.footerText};padding:14px 24px;font-size:12.5px;line-height:1.45">${foot}</td></tr>
</table>
<div style="${font};color:${k.outside};font-size:11.5px;margin-top:12px">${esc(b.bankName)} · ${esc(b.productName)}</div>
</td></tr></table></body></html>`;
  },

  /* Colours in the forms the exporters need. */
  hex(k) { return this.current.colors[k]; },
  tint(k, t) { return this.mix(this.current.colors[k], '#ffffff', t); },
  office(hex) { return hex.replace('#', '').toUpperCase(); },          // Word: '1F5FBF'
  argb(hex) { return 'FF' + hex.replace('#', '').toUpperCase(); },     // Excel: 'FF1F5FBF'
  pdf(hex) { return this.rgb(hex).map(v => (v / 255).toFixed(3)).join(' '); },   // PDF: '0.122 0.373 0.749'
};

Brand.apply(null);

/* Repaint when the device theme changes ("follow the device"), around printing, in other tabs, and when the switch is used. */
(() => {
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  if (mq && mq.addEventListener) mq.addEventListener('change', () => Brand.paint());
  window.addEventListener('beforeprint', () => { Brand.printing = true; Brand.paint(); });
  window.addEventListener('afterprint', () => { Brand.printing = false; Brand.paint(); });
  window.addEventListener('storage', e => { if (e.key === Brand.PREF_KEY) Brand.paint(); });
  // Leaving Admin → Branding ends its light/dark preview (the saved branding is re-applied by the page that opens).
  window.addEventListener('hashchange', () => { if (Brand.previewMode && location.hash !== '#/admin/branding') { Brand.previewMode = null; Brand.paint(); } });
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('[data-theme-toggle]')) Brand.toggle(); });
})();
