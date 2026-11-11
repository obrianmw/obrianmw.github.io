'use strict';

/* Generic UI helpers: toasts, modals, form fields, badges. */
const UI = {
  toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), type === 'error' ? 6000 : 3500);
  },

  /* actions: [{ label, cls, onClick(el) → false keeps the modal open }] */
  modal({ title, body, wide = false, actions = [], onOpen, closeLabel = 'Cancel' }) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `
      <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${U.esc(title)}">
        <div class="modal-h"><h2>${U.esc(title)}</h2><button class="btn-ghost btn-sm" data-close aria-label="Close">✕</button></div>
        <div class="modal-b">${body}</div>
        <div class="modal-f">
          ${closeLabel ? `<button data-close>${U.esc(closeLabel)}</button>` : ''}
          ${actions.map((a, i) => `<button class="${a.cls || 'btn-primary'}" data-act="${i}">${U.esc(a.label)}</button>`).join('')}
        </div>
      </div>`;
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    back.addEventListener('mousedown', e => { if (e.target === back) close(); });
    back.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    back.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', async () => {
      const a = actions[Number(b.dataset.act)];
      try {
        const keep = await a.onClick(back);
        if (keep !== false) close();
      } catch (e) {
        UI.error(e);
      }
    }));
    document.getElementById('modal-root').appendChild(back);
    const first = back.querySelector('.modal-b input:not([type=hidden]), .modal-b select, .modal-b textarea');
    if (first) first.focus();
    if (onOpen) onOpen(back);
    return { el: back, close };
  },

  confirm(title, html, okLabel = 'Confirm', cls = 'btn-primary') {
    return new Promise(res => {
      let ok = false;
      const m = UI.modal({ title, body: html, actions: [{ label: okLabel, cls, onClick: () => { ok = true; } }] });
      new MutationObserver((_, obs) => { if (!m.el.isConnected) { obs.disconnect(); res(ok); } }).observe(document.getElementById('modal-root'), { childList: true });
    });
  },

  error(e) {
    if (e instanceof WorkflowError) UI.toast(e.message, 'error');
    else { console.error(e); UI.toast(`Unexpected error: ${e.message}`, 'error'); }
  },

  badge(status) {
    const s = STATUS[status] || { label: status, tone: 'grey' };
    return `<span class="badge t-${s.tone}">${U.esc(s.label)}</span>`;
  },
  tag(text, tone = 'grey') { return `<span class="badge plain t-${tone}">${U.esc(text)}</span>`; },
  typeLabel(type) { return TXN_TYPES[type]?.label || '—'; },
  userName(id) { return Store.userById(id)?.name || (id === 'system' ? 'System' : '—'); },
  branchName(id) { return Store.branch(id)?.name || '—'; },

  /* Form field bound to a dotted path on a working object via data-path. */
  field(obj, path, label, o = {}) {
    const v = U.getPath(obj, path) ?? '';
    const id = `f_${path.replace(/\W/g, '_')}`;
    const attrs = `id="${id}" data-path="${path}" ${o.num ? 'data-num' : ''} ${o.disabled ? 'disabled' : ''} ${o.attrs || ''}`;
    let input;
    if (o.options) {
      const opts = o.options.map(op => Array.isArray(op) ? op : [op, op]);
      input = `<select ${attrs}>${o.placeholder !== false ? `<option value="">${U.esc(o.placeholder || 'Select…')}</option>` : ''}${opts.map(([val, lab]) => `<option value="${U.esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${U.esc(lab)}</option>`).join('')}</select>`;
    } else if (o.type === 'textarea') {
      input = `<textarea ${attrs} rows="${o.rows || 2}" placeholder="${U.esc(o.placeholder || '')}">${U.esc(v)}</textarea>`;
    } else {
      input = `<input type="${o.type || 'text'}" ${attrs} value="${U.esc(v)}" placeholder="${U.esc(o.placeholder || '')}" ${o.step ? `step="${o.step}"` : ''} ${o.list ? `list="${o.list}"` : ''} ${o.min != null ? `min="${o.min}"` : ''}>`;
    }
    return `<label class="f ${o.cls || ''}" data-field="${path}" for="${id}"><span>${U.esc(label)}${o.req ? ' <b class="req">*</b>' : ''}</span>${input}${o.hint ? `<div class="hint">${o.hint}</div>` : ''}<div class="field-err"></div></label>`;
  },

  /* Read a field element's value respecting data-num. */
  readInput(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.hasAttribute('data-num')) return el.value === '' ? '' : Number(el.value);
    return el.value;
  },

  formData(root) {
    const out = {};
    root.querySelectorAll('[name]').forEach(el => {
      if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; return; }
      if (el.type === 'file') return;
      out[el.name] = el.value;
    });
    return out;
  },

  async openDoc(doc) {
    if (doc.sample) {
      UI.modal({ title: doc.name, body: `<div class="alert info">This is a sample record created with the demo data, so there is no file content to show. Files you upload yourself open here.</div>`, closeLabel: 'Close' });
      return;
    }
    const blob = await FileStore.get(doc.id);
    if (!blob) { UI.toast('File content not found in this browser.', 'error'); return; }
    const url = URL.createObjectURL(blob);
    const isImg = /^image\//.test(doc.mime), isPdf = doc.mime === 'application/pdf';
    const body = isImg ? `<img src="${url}" alt="${U.esc(doc.name)}" style="max-width:100%">`
      : isPdf ? `<iframe src="${url}" title="${U.esc(doc.name)}" style="width:100%;height:70vh;border:0"></iframe>`
      : `<p>Preview is not available for this file type.</p>`;
    UI.modal({
      title: doc.name, wide: true, body: body + `<p class="muted" style="margin-top:8px">${U.esc(DOC_TYPES[doc.code])} · ${U.fileSize(doc.size)} · uploaded ${U.fmtDateTime(doc.uploadedAt)} by ${U.esc(UI.userName(doc.uploadedBy))}</p>`,
      closeLabel: 'Close',
      actions: [{ label: 'Download', cls: '', onClick: () => { const a = document.createElement('a'); a.href = url; a.download = doc.name; a.click(); return false; } }],
    });
  },

  setTitle(title, crumb = '') {
    document.getElementById('page-title').innerHTML = `${crumb ? `<div class="crumb">${crumb}</div>` : ''}<h1>${U.esc(title)}</h1>`;
    document.title = `${title} · ${Brand.current.productName}`;
  },
};

/* Work queues shown in the navigation and dashboards. */
const Queues = {
  defs: {
    mine:        { label: 'Branch applications', roles: ['INPUTTER', 'AUTHORISER'], filter: (a, u) => Engine.inBranch(u, a.branchId) },
    travelPayout: { label: 'Travel – ready to pay out', roles: ['INPUTTER', 'AUTHORISER'], filter: (a, u) => Rules.isTravel(a) && Engine.can('pay', a, u), alert: true },
    drafts:      { label: 'Drafts & returned',   roles: ['INPUTTER'], filter: (a, u) => Engine.inBranch(u, a.branchId) && ['DRAFT', 'RETURNED'].includes(a.status), alert: true },
    assigned:    { label: 'Assigned to me',      roles: ['INPUTTER', 'AUTHORISER', 'EC', 'TREASURY'], filter: (a, u) => Engine.isAssignedTo(a, u) && Engine.totals(a).fundedUnpaid > 0, alert: true },
    pendingAuth: { label: 'Pending authorisation', roles: ['AUTHORISER'], filter: a => a.status === 'PENDING_AUTH', alert: true },
    toAllocate:  { label: 'Awaiting allocation', roles: ['TREASURY'], filter: a => ACTIVE_POST_AUTH.includes(a.status) && Engine.totals(a).unallocated > 0 && Engine.totals(a).awaitingFunding === 0, alert: true },
    awaitingFunding: { label: 'Awaiting funding (4PM)', roles: ['INPUTTER', 'AUTHORISER', 'TREASURY', 'EC'], filter: (a, u) => Engine.can('confirmFunding', a, u), alert: true },
    ecReview:    { label: 'For EC recommendation', roles: ['EC'], filter: a => ACTIVE_POST_AUTH.includes(a.status) && !a.ec, alert: true },
    processing:  { label: 'Ready to process',    roles: ['EC'], filter: (a, u) => Engine.can('pay', a, u), alert: true },
    recon:       { label: 'Reconciliation',      roles: ['EC'], filter: a => a.type === 'ADVANCE' && a.recon?.status === 'REVIEW', alert: true },
    travel:      { label: 'Travel – not allocated', roles: ['TREASURY', 'EC', 'AUTHORISER'], filter: a => Rules.isTravel(a) && a.status === 'AWAITING_ALLOCATION' },
    expiring:    { label: 'Reaching expiry', roles: ['INPUTTER', 'AUTHORISER', 'TREASURY', 'EC'], filter: a => Engine.expiries(a).length > 0, alert: true },
    aged:        { get label() { return `Open over ${Store.state.settings.agingDays} days`; }, roles: ['INPUTTER', 'AUTHORISER', 'TREASURY', 'EC'], filter: a => Engine.isOpen(a) && Engine.ageDays(a) > Store.state.settings.agingDays, alert: true },
    all:         { label: 'All applications',    roles: ['TREASURY', 'EC', 'ADMIN'], filter: () => true },
  },
  list(id, user = Store.user()) {
    const q = this.defs[id];
    if (!q) return [];
    return Store.state.apps.filter(a => q.filter(a, user) && Engine.can('view', a, user));
  },
  /* `roles` above are the defaults; Administration → Access rights decides who actually sees each queue. */
  forUser(user = Store.user()) {
    return Object.keys(this.defs).filter(id => Access.has(user, `view.queue.${id}`)).map(id => Object.assign({ id }, this.defs[id], { label: this.defs[id].label }));
  },
};
