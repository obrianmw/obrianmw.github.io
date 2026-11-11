'use strict';

/* Capture / edit form. Works on a copy of the application (Form.app) and saves through Engine.save. */
const Form = {
  app: null,
  original: null,
  showErrors: false,
  MAX_FILE: 10 * 1024 * 1024,

  async storeFile(file, code) {
    if (file.size > this.MAX_FILE) throw new WorkflowError(`${file.name} is larger than 10 MB.`);
    const id = U.uid('doc');
    await FileStore.put(id, file);
    return { id, code, name: file.name, size: file.size, mime: file.type, uploadedAt: Store.now().toISOString(), uploadedBy: Store.user().id };
  },

  render(id) {
    const u = Store.user();
    let app;
    if (id) {
      const existing = Store.app(id);
      if (!existing || !Engine.can('edit', existing)) {
        UI.toast('This application cannot be edited in its current status.', 'error');
        location.hash = existing ? `#/app/${id}` : '#/dashboard';
        return;
      }
      app = U.clone(existing);
    } else {
      if (!Engine.can('create')) { location.hash = '#/dashboard'; return; }
      app = Engine.blank(u);
    }
    this.app = app;
    this.original = id ? U.clone(app) : null;
    this.showErrors = false;
    this.histFor = null;
    this.unrecFor = null;
    UI.setTitle(id ? `Edit ${app.ref}` : 'New forex application', id ? `${STATUS[app.status].label} · ${UI.branchName(app.branchId)}` : `Inputter · ${UI.branchName(u.branchId)}`);

    const isAuth = app.status === 'PENDING_AUTH';
    document.getElementById('view').innerHTML = `
      ${app.status === 'RETURNED' ? Form.returnedNote(app) : ''}
      ${isAuth ? '<div class="alert info" style="margin-bottom:16px">You are editing as Authoriser. Every change is recorded in the audit trail.</div>' : ''}
      <datalist id="countries">${COUNTRIES.map(c => `<option value="${c}">`).join('')}</datalist>
      <div class="cols">
        <div class="stack" id="form-main">
          ${!id && Engine.branchesOf(u).length > 1 ? `<div class="card"><div class="card-b"><label class="f" style="margin:0"><span>Branch this application is for <b class="req">*</b></span><select data-path="branchId">${Engine.branchesOf(u).map(b => `<option value="${b}" ${app.branchId === b ? 'selected' : ''}>${U.esc(UI.branchName(b))}</option>`).join('')}</select><div class="hint">You are assigned to ${Engine.branchesOf(u).length} branches. The reference, queues and authorisation follow the branch chosen here.</div></label></div></div>` : ''}
          <div class="card"><div class="card-h"><h2>1. Customer</h2><button type="button" class="btn-sm btn-primary" id="cbs-fetch">⟳ Fetch from CBS</button></div><div class="card-b grid g3">
            <div class="span-all btn-row" style="gap:8px;align-items:flex-end;flex-wrap:wrap"><label class="f" style="margin:0;flex:0 1 230px"><span>Customer number</span><input id="cust-no" inputmode="numeric" placeholder="e.g. 15750947" autocomplete="off"></label>
              <button type="button" class="btn-sm" id="cust-fetch">Find the customer's accounts</button><small class="muted" style="flex:1 1 220px">Or enter the account number below. A customer with several accounts gets a list to choose the account for this transaction.</small></div>
            <div id="cbs-status" class="span-all"></div>
            ${UI.field(app, 'customer.account', 'Account number', { req: true, attrs: 'inputmode="numeric"', hint: 'Fetches the name, balance, address and contacts from the core banking system' })}
            ${UI.field(app, 'customer.name', 'Customer name', { req: true, cls: 'span2' })}
            ${UI.field(app, 'customer.accountType', 'Account type', { req: true, options: Object.entries(ACCOUNT_TYPES), placeholder: false })}
            <label class="f" data-field="customer.idType" for="f_customer_idType"><span>ID type <b class="req">*</b></span>
              <select id="f_customer_idType" data-path="customer.idType"><option value="">Select…</option>
                ${Object.entries(ID_TYPES).map(([g, list]) => `<optgroup label="${U.esc(g)}">${list.map(([v, l]) => `<option value="${v}" ${app.customer.idType === v ? 'selected' : ''}>${U.esc(l)}</option>`).join('')}</optgroup>`).join('')}
              </select><div class="field-err"></div></label>
            ${UI.field(app, 'customer.idNumber', 'ID number', { req: true, placeholder: 'As shown on the ID document', hint: 'Used to find unreconciled items for this client' })}
            ${UI.field(app, 'customer.phone', 'Contact number', { req: true, type: 'tel', placeholder: '+265 …' })}
            ${UI.field(app, 'customer.email', 'Email (optional)', { type: 'email', hint: 'Without email, the client gets SMS notifications' })}
            ${UI.field(app, 'customer.address', 'Address', { req: true, type: 'textarea', cls: 'span-all' })}
            <div id="contacts" class="span-all"></div>
          </div></div>

          <div class="card"><div class="card-h"><h2>2. Transaction</h2></div><div class="card-b grid g3">
            ${UI.field(app, 'type', 'Transaction type', { req: true, options: Object.entries(TXN_TYPES).map(([k, t]) => [k, `${t.label}`]), cls: 'span2' })}
            <div id="maint-for"></div>
            <div class="f" data-field="balance"><label class="f" style="margin:0"><span>Account balance <b class="req">*</b></span></label>
              <div class="inline">${Form.bare('balance', 'number', '0.01')}${Form.bareSelect('balanceCurrency', ACCOUNT_CURRENCIES)}</div><div class="field-err"></div></div>
            <div class="f" data-field="amount"><label class="f" style="margin:0"><span>Amount applied <b class="req">*</b></span></label>
              <div class="inline">${Form.bare('amount', 'number', '0.01')}${Form.bareSelect('currency', CURRENCIES)}</div><div class="field-err"></div></div>
            <div><label class="f"><span>Equivalent</span></label><div id="equiv" class="muted" style="padding-top:6px"></div></div>
          </div></div>

          <div class="card"><div class="card-h"><h2>3. Beneficiary</h2><span class="btn-row">${Beneficiaries.can() ? '<a class="btn btn-sm" href="#/beneficiaries" target="_blank" rel="noopener">Manage saved…</a>' : ''}<button class="btn-sm" id="ben-self" type="button">Same as customer</button></span></div><div class="card-b grid g2">
            <div id="ben-saved" class="span-all"></div>
            ${UI.field(app, 'beneficiary.name', 'Beneficiary name', { req: true })}
            ${UI.field(app, 'beneficiary.country', 'Country of remittance', { req: true, list: 'countries' })}
            ${UI.field(app, 'beneficiary.address', 'Beneficiary address', { req: true, type: 'textarea' })}
            ${UI.field(app, 'beneficiary.product', 'Product / service applying for', { req: true, type: 'textarea' })}
            ${UI.field(app, 'beneficiary.bankName', 'Beneficiary bank (optional)')}
            ${UI.field(app, 'beneficiary.swift', 'SWIFT / BIC (optional)', { attrs: 'style="text-transform:uppercase" maxlength="11"' })}
            ${UI.field(app, 'beneficiary.accountNumber', 'Beneficiary account number / IBAN (optional)')}
            <div id="ben-extra" class="span-all"></div>
            ${Beneficiaries.can() ? `<label class="btn-row span-all"><input type="checkbox" id="ben-save" ${app.beneficiary.savedId ? '' : 'checked'}> Save this beneficiary for this client (updates the saved record if it already exists)</label>` : ''}
          </div></div>

          <div class="card" id="type-card"><div class="card-h"><h2 id="type-title">4. Details</h2></div><div class="card-b" id="type-body"></div></div>

          <div class="card"><div class="card-h"><h2>5. Supporting documents</h2><small>PDF or images, max 10 MB each</small></div><div class="card-b" id="docs"></div></div>
        </div>

        <div class="side">
          <div class="card hidden" id="unrec-card" style="border-color:var(--red-line, #f6c3c8)"><div class="card-h" style="background:var(--red-50)"><h2 style="color:var(--red-ink, #8d1220)">Unreconciled items</h2><small id="unrec-sum"></small></div><div class="card-b" id="unrec"></div></div>
          <div class="card hidden" id="hist-card"><div class="card-h"><h2>Client history</h2><small id="hist-sum"></small></div><div class="card-b tight" id="hist"></div></div>
          <div class="card"><div class="card-h"><h2>Checklist</h2><small id="chk-sum"></small></div><div class="card-b" id="checklist"></div></div>
          <div class="card"><div class="card-b">
            <label class="f" style="margin-bottom:10px"><span>Comment (optional)</span><textarea id="form-comment" rows="2" placeholder="${isAuth ? 'Reason for the changes' : 'Note to the authoriser'}"></textarea></label>
            <div style="display:flex;flex-direction:column;gap:8px">
              ${isAuth ? '<button class="btn-primary" id="btn-save" style="justify-content:center">Save changes</button>'
                : `<button class="btn-primary" id="btn-submit" style="justify-content:center">Submit for review</button>
                   <button id="btn-save" style="justify-content:center">Save as draft</button>`}
              <a class="btn" href="${id ? `#/app/${id}` : '#/dashboard'}" style="justify-content:center">Cancel</a>
            </div>
          </div></div>
        </div>
      </div>`;

    const main = U.$('#form-main');
    main.addEventListener('input', e => Form.onInput(e));
    main.addEventListener('change', e => Form.onInput(e, true));
    U.$('#ben-self').addEventListener('click', () => {
      const c = Form.app.customer;
      Object.assign(Form.app.beneficiary, { name: c.name || '', address: c.address || '' });
      ['name', 'address'].forEach(k => { const el = U.$(`[data-path="beneficiary.${k}"]`); if (el) el.value = Form.app.beneficiary[k]; });
      Form.refresh();
    });
    U.$('#btn-save').addEventListener('click', () => Form.save(false));
    U.$('#btn-submit')?.addEventListener('click', () => Form.save(true));
    U.$('#cbs-fetch').addEventListener('click', () => Form.fetchCbs(true));
    U.$('#cust-fetch').addEventListener('click', () => Form.fetchCustomer());
    U.$('#cust-no').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); Form.fetchCustomer(); } });
    this.custPick = null;
    Form.renderContacts();
    Form.renderCbs();
    Form.renderTypeParts();
  },

  /* ---------- core banking (CBS) ---------- */
  async fetchCbs(manual) {
    const app = this.app, no = app.customer.account;
    if (Engine.normAccount(no).length < 6) { if (manual) UI.toast('Enter the account number first.', 'error'); return; }
    U.$('#cbs-status').innerHTML = '<div class="alert info"><div>Fetching the account from the core banking system…</div></div>';
    try {
      const rec = await CBS.lookup(no);
      if (Engine.normAccount(app.customer.account) !== Engine.normAccount(no)) return;   // the number changed meanwhile
      CBS.apply(app, rec);
      ['name', 'accountType', 'idType', 'idNumber', 'address', 'phone', 'email'].forEach(k => { const el = U.$(`[data-path="customer.${k}"]`); if (el) el.value = app.customer[k] || ''; });
      ['balance', 'balanceCurrency'].forEach(k => { const el = U.$(`[data-path="${k}"]`); if (el) el.value = app[k]; });
      this.histFor = null;
      this.renderContacts();
      UI.toast(`${rec.name}: details and balance fetched from ${rec.source}. Check the contact details with the client.`, 'ok');
    } catch (e) {
      this.cbsError = e.message;
    }
    this.renderCbs();
    this.refresh();
  },

  /* A customer number: the customer's accounts from the CBS. One open account is fetched at once; several are offered
     in the account list (renderCbs) for the inputter to choose the account for this transaction. */
  async fetchCustomer() {
    const no = U.$('#cust-no').value.trim();
    if (!no) { UI.toast('Enter the customer number.', 'error'); return; }
    U.$('#cbs-status').innerHTML = '<div class="alert info"><div>Finding the customer in the core banking system…</div></div>';
    try {
      const rec = await CBS.customerLookup(no);
      this.custPick = rec;
      this.cbsError = null;
      const open = rec.accounts.filter(a => a.status !== 'CLOSED');
      if (open.length === 1) return this.pickAccount(open[0].accountNumber);
      if (!open.length) this.cbsError = `Customer ${rec.customerNumber} (${rec.name}) has no open accounts.`;
      else UI.toast(`${rec.name}: ${open.length} accounts – choose the account for this transaction.`, 'ok');
    } catch (e) { this.custPick = null; this.cbsError = e.message; }
    this.renderCbs();
  },

  /* The account chosen for this transaction: fetched from the CBS (name, balance, contacts). */
  pickAccount(no) {
    const el = U.$('[data-path="customer.account"]');
    if (el) el.value = no;
    this.app.customer.account = no;
    this.cbsError = null;
    return this.fetchCbs(true);
  },

  /* Status line and locks: name, account type and balance come only from the CBS while the account is linked. */
  renderCbs() {
    const app = this.app, c = app.customer, linked = CBS.linked(app), k = c.cbs;
    const lock = (path, on) => { const el = U.$(`[data-path="${path}"]`); if (!el) return; if (el.tagName === 'SELECT') el.disabled = on; else el.readOnly = on; el.title = on ? 'From the core banking system (CBS)' : ''; };
    ['customer.name', 'customer.accountType', 'balance', 'balanceCurrency'].forEach(p => lock(p, linked));
    const amended = linked ? CBS.amended(app) : [];
    // The customer the account belongs to: number, name and the customer's other accounts (branches, projects, funds).
    const cust = linked && k.customerNumber ? `<br>Customer number <b class="mono">${U.esc(k.customerNumber)}</b> · ${U.esc(k.customerName || k.name)}${k.customerType ? ` <small>(${U.esc(k.customerType)})</small>` : ''}${k.accountStatus && k.accountStatus !== 'ACTIVE' ? ` ${UI.tag(`Account ${k.accountStatus.toLowerCase()}`, 'red')}` : ''}
        ` : '';
    // The customer's accounts, to choose the one for this transaction: from a customer-number search, or from the
    // fetched account's customer.
    let pick = this.custPick;
    if (linked && pick && pick.customerNumber !== k.customerNumber) pick = this.custPick = null;
    const accounts = pick ? pick.accounts : linked ? (k.related || []) : [];
    const current = Engine.normAccount(c.account), known = accounts.some(x => Engine.normAccount(x.accountNumber) === current);
    const chooser = accounts.length > 1 ? `<label class="f" style="margin:10px 0 0"><span>Account for this transaction${pick && !linked ? ` – ${U.esc(pick.name)} (customer ${U.esc(pick.customerNumber)})` : ''}</span>
        <select id="cbs-acct">${!linked || !known ? '<option value="">Choose the account…</option>' : ''}${accounts.map(x => { const st = String(x.status || '').toUpperCase();
          return `<option value="${U.esc(x.accountNumber)}" ${linked && Engine.normAccount(x.accountNumber) === current ? 'selected' : ''} ${st === 'CLOSED' ? 'disabled' : ''}>${U.esc(x.accountNumber)} · ${U.esc(x.accountName || '')} · ${U.esc(x.currency || '')}${st && st !== 'ACTIVE' ? ` (${U.esc(st.toLowerCase())})` : ''}</option>`; }).join('')}</select>
        <div class="hint">${accounts.length} account(s) under this customer number; all of them are checked for unreconciled items.</div></label>` : '';
    U.$('#cbs-status').innerHTML = (linked
      ? `<div class="alert ok"><div>Available balance <b>${U.money(k.balance, k.currency)}</b> on account <b class="mono">${U.esc(k.account)}</b>${k.name ? ` (${U.esc(k.name)})` : ''}. Name, account type and balance come from the core banking system and are locked; address and contacts can be amended.${cust}${amended.length ? `<br>${UI.tag(`Amended: ${amended.join(', ')}`, 'amber')}` : ''}${chooser}</div></div>`
      : this.cbsError ? `<div class="alert warn"><div>${U.esc(this.cbsError)}</div></div>${chooser}`
        : chooser ? `<div class="alert info"><div>${chooser}</div></div>`
          : '<div class="muted" style="font-size:12.5px">Enter the customer number and press <b>Find the customer&#39;s accounts</b>, or enter the account number and press <b>Fetch from CBS</b> (or leave the field), to fill the customer details and balance.</div>');
    U.$('#cbs-acct')?.addEventListener('change', e => { if (e.target.value) this.pickAccount(e.target.value); });
  },

  /* Additional phone numbers and email addresses (directors, signatories…) – all receive the client alerts. */
  renderContacts() {
    const c = this.app.customer;
    c.contacts = c.contacts || [];
    const box = U.$('#contacts');
    box.innerHTML = `<div class="contacts-box"><div class="head"><b>Additional phone numbers and email addresses</b>
        <span class="btn-row"><button type="button" class="btn-sm" data-ct-add="phone">+ Phone number</button><button type="button" class="btn-sm" data-ct-add="email">+ Email address</button></span></div>
      <small class="muted">Recommended for companies and accounts with several signatories. Every number gets the client SMS alerts and every address the emails; each alert names the customer.</small>
      ${c.contacts.map((k, i) => `<div class="ct-row" data-field="customer.contacts.${i}">
          <span class="badge plain t-${k.kind === 'email' ? 'blue' : 'violet'}">${k.kind === 'email' ? 'Email' : 'Phone'}</span>
          <input data-ct="${i}" data-ct-key="value" type="${k.kind === 'email' ? 'email' : 'tel'}" value="${U.esc(k.value || '')}" placeholder="${k.kind === 'email' ? 'name@company.mw' : '+265 …'}" aria-label="${k.kind === 'email' ? 'Email address' : 'Phone number'} ${i + 1}">
          <input data-ct="${i}" data-ct-key="name" value="${U.esc(k.name || '')}" placeholder="Name / role, e.g. Finance Director (signatory)" aria-label="Name or role ${i + 1}">
          <button type="button" class="btn-sm btn-danger" data-ct-del="${i}" aria-label="Remove">✕</button>
          <div class="field-err"></div></div>`).join('')}</div>`;
    box.querySelectorAll('[data-ct-add]').forEach(b => b.addEventListener('click', () => { c.contacts.push({ kind: b.dataset.ctAdd, value: '', name: '' }); this.renderContacts(); this.refresh(); box.querySelector(`[data-ct="${c.contacts.length - 1}"]`)?.focus(); }));
    box.querySelectorAll('[data-ct-del]').forEach(b => b.addEventListener('click', () => { c.contacts.splice(Number(b.dataset.ctDel), 1); this.renderContacts(); this.refresh(); }));
    box.querySelectorAll('[data-ct]').forEach(inp => inp.addEventListener('input', () => { c.contacts[Number(inp.dataset.ct)][inp.dataset.ctKey] = inp.value; this.refresh(); }));
  },

  bare(path, type, step) {
    const v = U.getPath(this.app, path) ?? '';
    return `<input type="${type}" data-path="${path}" ${type === 'number' ? 'data-num' : ''} step="${step || ''}" value="${U.esc(v)}" min="0" aria-label="${path}">`;
  },
  bareSelect(path, options) {
    const v = U.getPath(this.app, path) ?? '';
    return `<select data-path="${path}" aria-label="${path}">${options.map(o => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  },

  returnedNote(app) {
    const last = [...app.comments].reverse().find(c => c.kind === 'Returned');
    return `<div class="alert warn" style="margin-bottom:16px"><div><b>Returned by ${U.esc(last?.userName || 'authoriser')}</b><br>${U.esc(last?.text || '')}</div></div>`;
  },

  onInput(e, isChange) {
    const el = e.target;
    if (!el.dataset.path) return;
    U.setPath(this.app, el.dataset.path, UI.readInput(el));
    if (el.dataset.path === 'customer.account') { this.cbsError = null; if (isChange) { this.fetchCbs(false); return; } }
    const structural = ['type', 'details.maintenanceFor'].includes(el.dataset.path);
    if (structural && isChange) this.renderTypeParts();
    else if (['amount', 'currency', 'details.travelDate', 'details.returnDate'].includes(el.dataset.path)) { this.renderDocs(); this.refresh(); }
    else this.refresh();
  },

  /* Re-render the parts of the form that depend on the transaction type. */
  renderTypeParts() {
    const app = this.app, t = TXN_TYPES[app.type];
    const d = app.details;
    U.$('#maint-for').innerHTML = app.type === 'MAINTENANCE'
      ? UI.field(app, 'details.maintenanceFor', 'Maintenance for', { req: true, options: [['STUDENT', 'Student'], ['OTHER', 'Other (e.g. rentals)']], placeholder: false })
      : '';
    if (app.type === 'MAINTENANCE' && !d.maintenanceFor) d.maintenanceFor = 'STUDENT';
    U.$('#ben-extra').innerHTML = app.type === 'GIFTS'
      ? `<div class="grid g2">${UI.field(app, 'beneficiary.relationship', 'Relationship to beneficiary', { req: true, placeholder: 'e.g. Son, Sister, Friend' })}</div>` : '';

    let body = '', title = '4. Details';
    if (Rules.isStudentCase(app)) {
      title = '4. Student details';
      body = `<div class="grid g4">
        ${UI.field(app, 'details.studentName', 'Student name', { req: true, cls: 'span2' })}
        ${UI.field(app, 'details.visaExpiry', 'Visa / permit expiry date', { req: true, type: 'date' })}
        <div></div>
        ${UI.field(app, 'details.studyStart', 'Study start date', { req: true, type: 'date' })}
        ${UI.field(app, 'details.studyEnd', 'Study finish date', { req: true, type: 'date' })}
      </div>`;
    } else if (t?.travel) {
      title = `4. Travel details – ${t.label}`;
      body = `<div class="alert info" style="margin-bottom:12px">${t.label.split(' (')[0]} is a travel expense, so a passport or travel document is a MUST. The ticket must show travel and return dates, and the amount must match the period at USD ${Store.state.settings.perDiemUSD} per day or equivalent.</div>
        <div class="grid g4">
        ${UI.field(app, 'details.travellerName', 'Traveller name', { req: true, cls: 'span2' })}
        ${UI.field(app, 'details.passportNumber', 'Passport / travel doc no.', { req: true, cls: 'span2' })}
        ${UI.field(app, 'details.travelDate', 'Travel date', { req: true, type: 'date' })}
        ${UI.field(app, 'details.returnDate', 'Return date', { req: true, type: 'date' })}
        <div class="span2" id="travel-calc"></div>
        ${app.type === 'MEDICAL' ? `${UI.field(app, 'details.invoiceNumber', 'Medical invoice number (optional)', { cls: 'span2' })}${UI.field(app, 'details.invoiceDate', 'Medical invoice date (optional)', { type: 'date', attrs: `max="${U.dayKey(Store.now())}"` })}` : ''}
      </div>`;
    } else if (['ADVANCE', 'FREIGHT', 'OPEN_ACCOUNT'].includes(app.type)) {
      title = '4. Import details';
      body = `<div class="grid g3">${UI.field(app, 'details.invoiceNumber', 'Invoice number')}${UI.field(app, 'details.invoiceDate', 'Invoice date', { req: true, type: 'date', attrs: `max="${U.dayKey(Store.now())}"` })}${UI.field(app, 'details.invoiceAmount', 'Invoice total (in the currency applied for)', { req: true, type: 'number', num: true, step: '0.01', min: 0, hint: 'The full invoice amount. The same invoice can never be paid beyond this, across all applications.' })}</div>${app.type === 'ADVANCE' ? `<div class="alert info" style="margin-top:12px">Advance payments are for imports only. After full payment the transaction must be reconciled within ${Store.state.settings.reconDays} days. The client gets reminders automatically.</div>` : ''}`;
    } else if (app.type === 'MAINTENANCE') {
      title = '4. Maintenance details';
      body = '<div class="muted">Upload the supporting document (e.g. a rental agreement for rentals) and proof of the required payment below.</div>';
    }
    U.$('#type-title').textContent = title;
    U.$('#type-body').innerHTML = body;
    U.$('#type-card').classList.toggle('hidden', !body);
    this.renderDocs();
    this.refresh();
  },

  renderDocs() {
    const app = this.app;
    const req = Rules.requiredDocs(app);
    const known = new Set(req.map(r => r.code));
    const others = app.documents.filter(f => !known.has(f.code));
    const slot = (code, label, required, note, files) => `
      <div class="doc-slot ${required && !files.length ? 'missing' : ''}" data-field="doc.${code}">
        <div class="head"><b>${U.esc(label)} ${required ? '<b class="req" style="color:var(--red-fg, var(--red))">*</b>' : ''}</b>
          <span class="btn-row">${UI.tag(required ? 'Required' : 'Optional', required ? 'red' : 'grey')}
          <label class="btn btn-sm upload-btn">⇪ Upload<input type="file" data-upload="${code}" multiple accept=".pdf,image/*,.doc,.docx,.xls,.xlsx,.csv,.txt"></label></span></div>
        ${note ? `<small>${U.esc(note)}</small>` : ''}
        <div class="files">${files.map(f => `<div class="file"><span>📄</span><span class="name">${U.esc(f.name)}</span><small>${U.fileSize(f.size)}</small>${DocView.buttons(f)}<button type="button" class="btn-sm btn-danger" data-remove="${f.id}" aria-label="Remove ${U.esc(f.name)}">✕</button></div>`).join('')}</div>
      </div>`;
    U.$('#docs').innerHTML = (app.type ? '' : '<div class="muted" style="margin-bottom:10px">Select a transaction type to see the required documents.</div>')
      + req.map(r => slot(r.code, r.label, r.required, r.note, r.files)).join('')
      + slot('OTHER', 'Other supporting documents', false, 'Anything else relevant to the application', others);

    U.$$('#docs [data-upload]').forEach(inp => inp.addEventListener('change', async () => {
      try {
        for (const f of inp.files) app.documents.push(await Form.storeFile(f, inp.dataset.upload));
      } catch (e) { UI.error(e); }
      Form.renderDocs(); Form.refresh();
    }));
    U.$$('#docs [data-remove]').forEach(b => b.addEventListener('click', () => {
      app.documents = app.documents.filter(f => f.id !== b.dataset.remove);
      Form.renderDocs(); Form.refresh();
    }));
    DocView.bind(U.$('#docs'), app.documents);
  },

  /* Unreconciled advance payments for this client (account or ID number, all branches). */
  renderUnreconciled() {
    const app = this.app;
    const key = `${Engine.normAccount(app.customer?.account)}|${Engine.normId(app.customer?.idNumber)}|${Engine.customerNo(app.customer)}`;
    if (key === this.unrecFor) return;
    this.unrecFor = key;
    const items = Engine.unreconciledFor(app);
    U.$('#unrec-card').classList.toggle('hidden', !items.length);
    if (!items.length) return;
    const today = U.dayKey(Store.now());
    U.$('#unrec-sum').textContent = `${items.length} item(s)`;
    const ub = Rules.unreconciledBlock(app);
    U.$('#unrec').innerHTML = `<div class="alert ${ub.blocking.length ? 'error' : 'warn'}" style="margin-bottom:10px"><div>${ub.blocking.length
        ? `<b>Cannot proceed:</b> this client has advance payment(s) that have not been reconciled – found from the account and ID numbers, including the client's other accounts and earlier applications at any branch. The application <b>cannot be submitted until ${ub.mode === 'OVERDUE' ? 'the overdue one(s) are' : 'they are'} reconciled</b>. Reject it here and advise the client, or save it as a draft.`
        : 'This client has advance payment(s) not yet reconciled (not overdue). Check them before continuing.'}</div></div>
      <ul class="checklist">${items.map(a => {
        const d = U.daysBetween(Store.now(), a.recon.dueDate);
        return `<li><span class="ico ${a.recon.dueDate < today ? 'no' : 'warn'}">!</span><span><b class="mono">${U.esc(a.ref)}</b> · ${U.money(a.amount, a.currency)}<br><small>${U.esc(UI.branchName(a.branchId))} · due ${U.fmtDate(a.recon.dueDate)} (${d < 0 ? `${-d} days overdue` : `${d} days left`})<br>Matched: ${U.esc(Engine.unreconciledMatch(app, a))}</small></span></li>`;
      }).join('')}</ul>
      ${Access.has(Store.user(), 'act.capture') && ['DRAFT', 'RETURNED'].includes(app.status) ? '<button type="button" class="btn-danger" id="unrec-reject" style="width:100%;justify-content:center;margin-top:10px">✕ Reject application – unreconciled items</button>' : ''}`;
    U.$('#unrec-reject')?.addEventListener('click', () => {
      // Save first so the rejected application becomes part of the client's history.
      try {
        const res = Engine.save(this.app, {});
        this.app.id = res.app.id;
        Actions.inputReject(res.app, true);
      } catch (e) { UI.error(e); }
    });
  },

  /* Previous applications for the account number being captured (all branches). */
  renderHistory() {
    const app = this.app;
    const acct = String(app.customer?.account || '').trim();
    const card = U.$('#hist-card');
    if (acct === this.histFor) return;
    this.histFor = acct;
    const h = acct.length >= 6 ? Engine.clientHistory(acct, app.id) : [];
    card.classList.toggle('hidden', !h.length);
    if (!h.length) return;
    const last = h[0].customer;
    U.$('#hist-sum').textContent = `${h.length} previous`;
    U.$('#hist').innerHTML = `<div style="padding:10px 12px 0"><div class="alert info"><div>This account has applied before as <b>${U.esc(last.name)}</b>. The history below covers all branches.</div></div>
        <button type="button" class="btn-sm" id="hist-fill" style="margin:8px 0">Use customer details from latest application</button></div>
      ${Views.historyTable(h.slice(0, 5), true)}${h.length > 5 ? `<div class="muted" style="padding:8px 12px">…and ${h.length - 5} more in Reports → Client history</div>` : ''}`;
    U.$('#hist-fill').addEventListener('click', () => this.fillCustomer(last, false));
    // Auto-populate: a new capture with no customer details yet is filled from the client's latest application.
    if (!app.customer.name?.trim() && !app.customer.idNumber?.trim() && ['DRAFT', 'RETURNED'].includes(app.status)) this.fillCustomer(last, true);
  },

  fillCustomer(last, auto) {
    const app = this.app;
    ['name', 'accountType', 'idType', 'idNumber', 'address', 'email', 'phone'].forEach(k => {
      if (auto && app.customer[k] && k !== 'accountType') return;   // never overwrite what was typed
      app.customer[k] = last[k] || '';
      const el = U.$(`[data-path="customer.${k}"]`);
      if (el) el.value = app.customer[k];
    });
    if (!auto || !app.customer.contacts?.length) { app.customer.contacts = U.clone(last.contacts || []); this.renderContacts(); }
    this.refresh();
    // A silent auto-fill: the CBS lookup that follows (on leaving the account field) shows its own message.
    if (!auto) UI.toast('Customer details filled from the latest application. Please confirm they are still correct.');
  },

  /* Update equivalents, travel calculation, checklist and inline errors. */
  refresh() {
    const app = this.app;
    const v = Rules.validate(app);
    const usd = Rules.toUSD(app.amount, app.currency), mwk = Rules.toMWK(app.amount, app.currency);
    U.$('#equiv').innerHTML = app.amount > 0 ? `≈ USD ${U.num(usd)}<br>≈ MWK ${U.num(mwk)}` : '—';

    const tc = U.$('#travel-calc');
    if (tc) {
      const t = Rules.travel(app);
      tc.innerHTML = t.days ? `<div class="alert ${t.amountUSD > t.maxUSD + 0.01 ? (TXN_TYPES[app.type].perDiem === 'strict' ? 'error' : 'warn') : 'ok'}">
          <div>${t.days} day(s) × USD ${Store.state.settings.perDiemUSD} = <b>max USD ${U.num(t.maxUSD)}</b>${app.currency !== 'USD' && t.maxInCcy ? ` (≈ ${app.currency} ${U.num(t.maxInCcy)})` : ''}<br>
          Applied ≈ USD ${U.num(t.amountUSD)} · Ticket ${t.ticketRequired ? '<b>required</b>' : 'not required'}</div></div>` : '<div class="muted" style="padding-top:22px">Enter travel and return dates to check the allowance.</div>';
    }

    this.renderHistory();
    this.renderUnreconciled();
    this.renderCbs();
    Beneficiaries.renderPicker(app);
    const docs = v.docs;
    const req = docs.filter(d => d.required);
    const fieldErrors = v.errors.filter(e => !e.field.startsWith('doc.'));
    U.$('#chk-sum').textContent = v.errors.length ? `${v.errors.length} to fix` : 'Ready';
    U.$('#checklist').innerHTML = `
      <ul class="checklist">
        <li><span class="ico ${fieldErrors.length ? 'no' : 'ok'}">${fieldErrors.length ? '✕' : '✓'}</span><span>Application details ${fieldErrors.length ? `<small>(${fieldErrors.length} missing or invalid)</small>` : 'complete'}</span></li>
        ${docs.map(d => `<li><span class="ico ${d.present ? 'ok' : d.required ? 'no' : 'opt'}">${d.present ? '✓' : d.required ? '✕' : '–'}</span><span>${U.esc(d.label)}${d.required ? '' : ' <small>(optional)</small>'}</span></li>`).join('')}
        ${!req.length && app.type ? '<li><span class="ico opt">–</span><span>No mandatory documents for this type</span></li>' : ''}
      </ul>
      ${this.showErrors ? v.errors.map(e => `<div class="alert error" style="margin-top:8px">✕ ${U.esc(e.msg)}</div>`).join('') : ''}
      ${v.warnings.map(w => `<div class="alert warn" style="margin-top:8px">! ${U.esc(w.msg)}</div>`).join('')}`;

    U.$$('#form-main [data-field]').forEach(el => {
      const errs = this.showErrors ? v.errors.filter(e => e.field === el.dataset.field) : [];
      el.classList.toggle('has-error', errs.length > 0);
      const holder = el.querySelector(':scope > .field-err');
      if (holder) holder.textContent = errs.map(e => e.msg).join('; ');
    });
    return v;
  },

  save(submit) {
    const comment = U.$('#form-comment').value;
    try {
      // "Save this beneficiary": keep or update it in the saved list (needs at least a name and country).
      const b = this.app.beneficiary;
      if (U.$('#ben-save')?.checked && b.name?.trim() && b.country?.trim() && b.address?.trim()) {
        try { Beneficiaries.upsertFromApp(this.app); } catch (e) { UI.toast(`Beneficiary not saved to the list: ${e.message}`, 'error'); }
      }
      if (submit) {
        const v = Rules.validate(this.app);
        if (v.errors.length) {
          this.showErrors = true;
          this.refresh();
          const res = Engine.save(this.app, { submit: false });
          this.app.id = res.app.id;
          UI.toast(`Saved as draft ${res.app.ref}. Fix ${v.errors.length} issue(s) to submit.`, 'error');
          history.replaceState(null, '', `#/edit/${res.app.id}`);
          const first = U.$('#form-main .has-error');
          if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
      }
      const res = Engine.save(this.app, { submit, comment });
      UI.toast(submit ? `${res.app.ref} submitted for authorisation.` : `${res.app.ref} saved.`, 'ok');
      location.hash = `#/app/${res.app.id}`;
    } catch (e) { UI.error(e); }
  },
};
