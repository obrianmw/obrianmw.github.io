'use strict';

/* Saved beneficiaries: a maintained list of the people and companies clients send money to.
   - Each beneficiary belongs to one client account, or is "shared" (e.g. a university or supplier many clients pay).
   - Anyone with the capture right can add, edit and remove them (Beneficiaries screen, or "Save this beneficiary"
     while capturing). Removing keeps the record (marked removed) so past applications still make sense; it can be
     restored. Every change is in the audit trail.
   - On the application form, the client's saved beneficiaries, shared ones, and beneficiaries from the client's
     earlier applications are offered; picking one fills all beneficiary fields.
   Stored in Store.state.beneficiaries (server versions: the shared "beneficiaries" collection). */

const BEN_FIELDS = ['name', 'address', 'country', 'product', 'relationship', 'bankName', 'accountNumber', 'swift'];

const Beneficiaries = {
  list() { Store.state.beneficiaries = Store.state.beneficiaries || []; return Store.state.beneficiaries; },
  can(user = Store.user()) { return !!user && Access.has(user, 'act.capture'); },
  norm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); },
  key(b) { return `${this.norm(b.name)}|${this.norm(b.country)}`; },
  get(id) { return this.list().find(b => b.id === id); },

  /* Saved beneficiaries usable for a client account (its own first, then shared), active only. */
  forClient(account) {
    const acct = Engine.normAccount(account);
    const all = this.list().filter(b => b.active !== false);
    return [...all.filter(b => acct && Engine.normAccount(b.clientAccount) === acct), ...all.filter(b => b.scope === 'SHARED')]
      .sort((a, b) => (b.lastUsedAt || '').localeCompare(a.lastUsedAt || '') || a.name.localeCompare(b.name));
  },

  /* Beneficiaries from the client's earlier applications that are not saved yet (newest first, one per name+country). */
  suggestions(account) {
    const saved = new Set(this.forClient(account).map(b => this.key(b)));
    const seen = new Set(), out = [];
    Engine.clientHistory(account).forEach(a => {
      const b = a.beneficiary || {};
      if (!b.name?.trim() || !b.country?.trim()) return;
      const k = this.key(b);
      if (saved.has(k) || seen.has(k)) return;
      seen.add(k);
      out.push(Object.assign({ fromRef: a.ref, fromDate: Engine.appliedAt(a) }, ...BEN_FIELDS.map(f => ({ [f]: b[f] || '' }))));
    });
    return out;
  },

  clientName(account) {
    const h = Engine.clientHistory(account);
    return h[0]?.customer?.name || this.list().find(b => Engine.normAccount(b.clientAccount) === Engine.normAccount(account) && b.clientName)?.clientName || '';
  },

  validate(b) {
    const errs = [];
    if (!b.name?.trim()) errs.push('Beneficiary name is required.');
    if (!b.country?.trim()) errs.push('Country is required.');
    if (!b.address?.trim()) errs.push('Address is required.');
    if (b.scope !== 'SHARED' && !/^\d{6,16}$/.test(Engine.normAccount(b.clientAccount))) errs.push('Client account number is required (6–16 digits), or make the beneficiary shared.');
    if (b.swift?.trim() && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(b.swift.trim().toUpperCase())) errs.push('SWIFT / BIC must be 8 or 11 letters and digits (e.g. SBZAZAJJ).');
    return errs;
  },

  /* Same name + country for the same client (or shared) = duplicate. */
  duplicateOf(b) {
    return this.list().find(x => x.id !== b.id && x.active !== false && this.key(x) === this.key(b)
      && (x.scope === 'SHARED' ? b.scope === 'SHARED' : Engine.normAccount(x.clientAccount) === Engine.normAccount(b.clientAccount)));
  },

  save(data) {
    if (!this.can()) throw new WorkflowError('You do not have the right to maintain beneficiaries (it comes with "Capture applications").');
    const b = Object.assign({}, data);
    BEN_FIELDS.concat(['clientAccount', 'clientName', 'notes']).forEach(f => { b[f] = String(b[f] ?? '').trim(); });
    b.swift = b.swift.toUpperCase().replace(/\s+/g, '');
    b.clientAccount = b.scope === 'SHARED' ? '' : Engine.normAccount(b.clientAccount);
    const errs = this.validate(b);
    if (errs.length) throw new WorkflowError(errs.join(' '));
    const dup = this.duplicateOf(b);
    if (dup) throw new WorkflowError(`${dup.name} (${dup.country}) is already saved for ${dup.scope === 'SHARED' ? 'all clients' : `account ${dup.clientAccount}`}. Edit that one instead.`);
    const u = Store.user(), now = Store.now().toISOString();
    const existing = b.id && this.get(b.id);
    if (existing) {
      const changes = BEN_FIELDS.concat(['clientAccount', 'scope', 'notes']).filter(f => (existing[f] || '') !== (b[f] || '')).map(f => ({ field: f, from: existing[f] || '', to: b[f] || '' }));
      Object.assign(existing, b, { updatedAt: now, updatedBy: u.id });
      Store.audit('BENEFICIARY_SAVED', null, `Beneficiary updated: ${b.name} (${b.country})`, changes);
      Store.save();
      return existing;
    }
    const rec = Object.assign(b, { id: U.uid('ben'), active: true, createdAt: now, createdBy: u.id, createdByName: u.name, branchId: Engine.workingBranch(u), uses: 0, clientName: b.clientName || this.clientName(b.clientAccount) });
    this.list().push(rec);
    Store.audit('BENEFICIARY_SAVED', null, `Beneficiary added: ${rec.name} (${rec.country}) for ${rec.scope === 'SHARED' ? 'all clients' : `account ${rec.clientAccount}`}`);
    Store.save();
    return rec;
  },

  setActive(b, active) {
    if (!this.can()) throw new WorkflowError('You do not have the right to maintain beneficiaries.');
    b.active = active;
    b[active ? 'restoredAt' : 'removedAt'] = Store.now().toISOString();
    b[active ? 'restoredBy' : 'removedBy'] = Store.user().name;
    Store.audit(active ? 'BENEFICIARY_SAVED' : 'BENEFICIARY_REMOVED', null, `Beneficiary ${active ? 'restored' : 'removed'}: ${b.name} (${b.country})`);
    Store.save();
  },

  /* From the application form: save (or update the matching saved record) with the beneficiary just captured. */
  upsertFromApp(app) {
    const src = app.beneficiary || {};
    const acct = Engine.normAccount(app.customer?.account);
    const match = (src.savedId && this.get(src.savedId)) || this.list().find(x => x.active !== false && this.key(x) === this.key(src) && (x.scope === 'SHARED' || Engine.normAccount(x.clientAccount) === acct));
    const data = Object.assign({}, match || { scope: 'CLIENT', clientAccount: acct, clientName: app.customer?.name || '' }, ...BEN_FIELDS.map(f => ({ [f]: src[f] || (match ? match[f] : '') || '' })));
    const rec = this.save(data);
    src.savedId = rec.id;
    return rec;
  },

  markUsed(id) {
    const b = this.get(id);
    if (!b) return;
    b.uses = (b.uses || 0) + 1;
    b.lastUsedAt = Store.now().toISOString();
  },

  /* ---------- the application form ---------- */
  fill(app, b, savedId) {
    BEN_FIELDS.forEach(f => {
      if (f === 'relationship' && !b[f]) return;
      app.beneficiary[f] = b[f] || '';
      const el = document.querySelector(`[data-path="beneficiary.${f}"]`);
      if (el) el.value = app.beneficiary[f];
    });
    app.beneficiary.savedId = savedId || null;
  },

  renderPicker(app) {
    const box = document.getElementById('ben-saved');
    if (!box) return;
    const acct = Engine.normAccount(app.customer?.account);
    const sig = `${acct}|${this.list().length}|${app.beneficiary?.savedId || ''}`;
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    const saved = this.forClient(acct), sugg = acct.length >= 6 ? this.suggestions(acct) : [];
    if (!saved.length && !sugg.length) {
      box.innerHTML = acct.length >= 6 ? '<div class="muted" style="margin-bottom:8px">No saved beneficiaries for this client yet. Tick "Save this beneficiary" below to keep this one.</div>' : '<div class="muted" style="margin-bottom:8px">Enter the client\'s account number to see their saved beneficiaries.</div>';
      return;
    }
    const opt = (v, label) => `<option value="${U.esc(v)}">${U.esc(label)}</option>`;
    box.innerHTML = `<label class="f" style="margin-bottom:10px"><span>Fill from a saved beneficiary</span><select id="ben-pick"><option value="">Choose… (${saved.length + sugg.length} available)</option>
      ${saved.length ? `<optgroup label="Saved for this client${saved.some(b => b.scope === 'SHARED') ? ' / shared' : ''}">${saved.map(b => opt(`s:${b.id}`, `${b.name} – ${b.country}${b.scope === 'SHARED' ? ' (shared)' : ''}${b.bankName ? ` · ${b.bankName}` : ''}`)).join('')}</optgroup>` : ''}
      ${sugg.length ? `<optgroup label="From earlier applications (not saved yet)">${sugg.map((b, i) => opt(`h:${i}`, `${b.name} – ${b.country} (${b.fromRef})`)).join('')}</optgroup>` : ''}
    </select></label>`;
    document.getElementById('ben-pick').addEventListener('change', e => {
      const v = e.target.value;
      if (!v) return;
      const b = v.startsWith('s:') ? this.get(v.slice(2)) : sugg[Number(v.slice(2))];
      this.fill(app, b, v.startsWith('s:') ? b.id : null);
      const tick = document.getElementById('ben-save');
      if (tick) tick.checked = !v.startsWith('s:');
      UI.toast(`Beneficiary details filled from ${v.startsWith('s:') ? 'the saved record' : `application ${b.fromRef}`}. Check them before submitting.`);
      Form.refresh();
    });
  },

  /* ---------- Beneficiaries screen: #/beneficiaries ---------- */
  filter: { q: '', show: 'active' },

  render() {
    if (!this.can()) { location.hash = '#/dashboard'; return; }
    UI.setTitle('Beneficiaries', 'Saved for clients');
    const f = this.filter;
    const term = this.norm(f.q);
    const rows = this.list().filter(b => (f.show === 'all' || (f.show === 'removed' ? b.active === false : b.active !== false))
      && (!term || [b.name, b.country, b.clientAccount, b.clientName, b.bankName, b.swift, b.accountNumber, b.product].some(x => this.norm(x).includes(term))))
      .sort((a, b) => a.name.localeCompare(b.name));
    document.getElementById('view').innerHTML = `
      <div class="toolbar">
        <input type="search" id="bn-q" placeholder="Search name, client account, country, bank, SWIFT…" value="${U.esc(f.q)}" style="flex:1;min-width:260px">
        <div class="pill-group">${[['active', 'Active'], ['removed', 'Removed'], ['all', 'All']].map(([k, l]) => `<button data-show="${k}" class="${f.show === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <span class="muted">${rows.length}</span>${Export.button()}
        <button class="btn-primary" id="bn-add">+ Add beneficiary</button>
      </div>
      <div class="card"><div class="card-b tight"><div class="table-wrap"><table>
        <thead><tr><th>Beneficiary</th><th>Client</th><th>Country</th><th>Bank</th><th>Usual purpose</th><th class="num">Used</th><th></th></tr></thead>
        <tbody>${rows.map(b => `<tr class="${b.active === false ? 'muted' : ''}">
          <td><b>${U.esc(b.name)}</b>${b.relationship ? `<br><small>${U.esc(b.relationship)}</small>` : ''}${b.active === false ? ` ${UI.tag('Removed', 'grey')}` : ''}</td>
          <td>${b.scope === 'SHARED' ? UI.tag('Shared – all clients', 'blue') : `${U.esc(b.clientName || '')}<br><small class="mono">${U.esc(b.clientAccount)}</small>`}</td>
          <td>${U.esc(b.country)}</td>
          <td>${U.esc(b.bankName || '')}${b.swift ? `<br><small class="mono">${U.esc(b.swift)}</small>` : ''}${b.accountNumber ? `<br><small class="mono">${U.esc(b.accountNumber)}</small>` : ''}</td>
          <td>${U.esc(b.product || '')}</td>
          <td class="num">${b.uses || 0}${b.lastUsedAt ? `<br><small>${U.fmtDate(b.lastUsedAt)}</small>` : ''}</td>
          <td class="nowrap"><button class="btn-sm" data-edit="${b.id}">Edit</button> ${b.active === false ? `<button class="btn-sm" data-restore="${b.id}">Restore</button>` : `<button class="btn-sm btn-danger" data-remove="${b.id}">Remove</button>`}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No beneficiaries found.</td></tr>'}</tbody>
      </table></div></div></div>`;
    const q = U.$('#bn-q');
    q.addEventListener('input', e => { f.q = e.target.value; this.render(); const n = U.$('#bn-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
    U.$$('[data-show]').forEach(b => b.addEventListener('click', () => { f.show = b.dataset.show; this.render(); }));
    U.$('#bn-add').addEventListener('click', () => this.edit(null));
    U.$$('[data-edit]').forEach(b => b.addEventListener('click', () => this.edit(this.get(b.dataset.edit))));
    U.$$('[data-remove]').forEach(b => b.addEventListener('click', async () => {
      const rec = this.get(b.dataset.remove);
      if (!await UI.confirm('Remove beneficiary?', `<p><b>${U.esc(rec.name)}</b> will no longer be offered on applications. Applications already made are not changed, and it can be restored later.</p>`, 'Remove', 'btn-danger')) return;
      try { this.setActive(rec, false); this.render(); } catch (e) { UI.error(e); }
    }));
    U.$$('[data-restore]').forEach(b => b.addEventListener('click', () => { try { this.setActive(this.get(b.dataset.restore), true); this.render(); } catch (e) { UI.error(e); } }));
    Export.attach(U.$('#view'), () => ({
      title: 'Saved beneficiaries', subtitle: `${f.show === 'all' ? 'All' : f.show === 'removed' ? 'Removed' : 'Active'}${f.q ? ` · "${f.q}"` : ''}`, filename: 'beneficiaries',
      sections: [{ heading: 'Beneficiaries', columns: [{ label: 'Name' }, { label: 'Scope' }, { label: 'Client account' }, { label: 'Client name' }, { label: 'Country' }, { label: 'Address' }, { label: 'Relationship' }, { label: 'Bank' }, { label: 'Account / IBAN' }, { label: 'SWIFT / BIC' }, { label: 'Usual purpose' }, { label: 'Times used', num: 0 }, { label: 'Status' }],
        rows: rows.map(b => [b.name, b.scope === 'SHARED' ? 'Shared' : 'Client', b.clientAccount, b.clientName, b.country, b.address, b.relationship, b.bankName, b.accountNumber, b.swift, b.product, b.uses || 0, b.active === false ? 'Removed' : 'Active']) }],
    }));
  },

  edit(b) {
    const d = b ? Object.assign({}, b) : { scope: 'CLIENT', clientAccount: '', name: '', country: '', address: '', product: '', relationship: '', bankName: '', accountNumber: '', swift: '', notes: '' };
    const fld = (k, label, attrs = '') => `<label class="f"><span>${label}</span><input name="${k}" value="${U.esc(d[k] || '')}" ${attrs}></label>`;
    UI.modal({
      title: b ? `Edit ${b.name}` : 'Add beneficiary', wide: true,
      body: `<datalist id="ben-countries">${COUNTRIES.map(c => `<option value="${U.esc(c)}">`).join('')}</datalist><div class="grid g2">
        <label class="f"><span>For</span><select name="scope"><option value="CLIENT" ${d.scope !== 'SHARED' ? 'selected' : ''}>One client (account number)</option><option value="SHARED" ${d.scope === 'SHARED' ? 'selected' : ''}>Shared – any client (e.g. university, supplier)</option></select></label>
        <label class="f" data-for="CLIENT"><span>Client account number *</span><input name="clientAccount" value="${U.esc(d.clientAccount || '')}" inputmode="numeric"><div class="hint" id="bn-client"></div></label>
        ${fld('name', 'Beneficiary name *')}${fld('country', 'Country *', 'list="ben-countries"')}
        <label class="f span-all"><span>Address *</span><textarea name="address" rows="2">${U.esc(d.address || '')}</textarea></label>
        ${fld('product', 'Usual purpose / product (optional)')}${fld('relationship', 'Relationship to the client (optional)')}
        ${fld('bankName', 'Beneficiary bank (optional)')}${fld('swift', 'SWIFT / BIC (optional)', 'style="text-transform:uppercase"')}
        ${fld('accountNumber', 'Account number / IBAN (optional)')}${fld('notes', 'Notes (optional)')}</div>`,
      onOpen: el => {
        const sync = () => {
          const shared = el.querySelector('[name=scope]').value === 'SHARED';
          el.querySelectorAll('[data-for]').forEach(x => { x.hidden = shared; });
          const acct = el.querySelector('[name=clientAccount]').value;
          const n = this.clientName(acct);
          el.querySelector('#bn-client').textContent = shared ? '' : (n ? `Client: ${n}` : (Engine.normAccount(acct).length >= 6 ? 'No applications yet for this account' : ''));
        };
        el.querySelector('[name=scope]').addEventListener('change', sync);
        el.querySelector('[name=clientAccount]').addEventListener('input', sync);
        sync();
      },
      actions: [{ label: 'Save beneficiary', onClick: el => {
        const v = UI.formData(el);
        try { this.save(Object.assign({}, b || {}, v, { clientName: v.scope === 'SHARED' ? '' : this.clientName(v.clientAccount) })); } catch (e) { UI.error(e); return false; }
        UI.toast('Beneficiary saved.', 'ok');
        this.render();
      } }],
    });
  },
};

/* ---------- hooks: menu, route, form ---------- */
(() => {
  App.routes.push([/^#\/beneficiaries$/, () => Beneficiaries.render()]);
  const baseChrome = App.renderChrome.bind(App);
  App.renderChrome = function () {
    baseChrome();
    const u = Store.user();
    if (!u || !Beneficiaries.can(u)) return;
    const nav = document.getElementById('nav');
    const link = `<a href="#/beneficiaries" class="${location.hash === '#/beneficiaries' ? 'active' : ''}"><span>Beneficiaries</span></a>`;
    const anchor = nav.querySelector('a[href="#/new"]');
    if (anchor) anchor.insertAdjacentHTML('afterend', link);
    else { const g = nav.querySelector('.nav-group'); if (g) g.insertAdjacentHTML('beforebegin', link); else nav.insertAdjacentHTML('beforeend', link); }
  };
  const baseLabel = Views.actionLabel.bind(Views);
  Views.actionLabel = a => ({ BENEFICIARY_SAVED: 'Beneficiary saved', BENEFICIARY_REMOVED: 'Beneficiary removed' })[a] || baseLabel(a);
  // Count each use of a saved beneficiary when an application is saved with it.
  const baseSave = Engine.save.bind(Engine);
  Engine.save = function (app, opts) {
    const res = baseSave(app, opts);
    const id = res?.app?.beneficiary?.savedId;
    if (id && opts?.submit) { Beneficiaries.markUsed(id); Store.save(); }
    return res;
  };
})();
