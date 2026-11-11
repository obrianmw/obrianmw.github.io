'use strict';

/* Administration: notification templates, bank/branches/correspondents, users, settings & rates, demo data. */
const Admin = {
  tabs: [['branding', 'Branding'], ['templates', 'Notification templates'], ['branches', 'Bank & branches'], ['users', 'Users'], ['settings', 'Rules & rates'], ['data', 'Demo data']],

  render(tab = 'templates') {
    if (Store.user().role !== 'ADMIN') { location.hash = '#/dashboard'; return; }
    if (tab === 'brand') tab = 'branding';                         // brand asset files are now on the Branding tab
    if (tab !== 'branding') { Brand.previewMode = null; Brand.apply(Store.state.branding); }   // drop any unsaved branding preview
    if (!Admin.tabs.some(t => t[0] === tab)) tab = 'templates';
    UI.setTitle(Admin.tabs.find(t => t[0] === tab)[1], 'Administration');
    document.getElementById('view').innerHTML = `<div class="tabs">${Admin.tabs.map(([k, l]) => `<a href="#/admin/${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div><div id="adm"></div>`;
    Admin[tab]();
  },

  /* ---------- templates (email text, and a separate SMS text for client messages) ---------- */
  templates() {
    const S = Store.state;
    const sel = Admin.tplSel = S.templates[Admin.tplSel] ? Admin.tplSel : Object.keys(S.templates)[0];
    const t = S.templates[sel];
    const client = t.audience === 'Client';
    const sample = Store.state.apps.find(a => a.status !== 'DRAFT') || Store.state.apps[0];
    const channels = x => (x.audience === 'Client' ? 'Email + SMS' : 'Email + in-app');
    U.$('#adm').innerHTML = `<div class="cols" style="grid-template-columns:300px minmax(0,1fr)">
      <div class="card"><div class="card-b tight"><div class="table-wrap"><table><tbody>${Object.entries(S.templates).map(([k, x]) => `<tr class="click" data-tpl="${k}" style="${k === sel ? 'background:var(--blue-50)' : ''}"><td><b>${U.esc(x.name)}</b><br><small>${U.esc(x.trigger)}</small><br><small>${channels(x)}</small></td><td>${UI.tag(x.audience, x.audience === 'Client' ? 'blue' : 'grey')}${x.enabled === false ? `<br>${UI.tag('Off', 'red')}` : ''}</td></tr>`).join('')}</tbody></table></div></div></div>
      <div class="stack">
        <div class="card"><div class="card-h"><h2>${U.esc(t.name)}</h2><label class="btn-row" style="font-weight:600"><input type="checkbox" id="tp-on" ${t.enabled === false ? '' : 'checked'}> Enabled</label></div>
          <div class="card-b">
            <p class="muted" style="margin-top:0">Sent when: ${U.esc(t.trigger)} · Audience: ${U.esc(t.audience)} · ${channels(t)}</p>
            <h3 style="margin-bottom:8px">Email</h3>
            <label class="f"><span>Subject</span><input id="tp-subject" value="${U.esc(t.subject)}"></label>
            <label class="f" style="margin-top:10px"><span>Email text</span><textarea id="tp-body" rows="12">${U.esc(t.body)}</textarea><div class="hint">Shown inside the email layout set in <a href="#/admin/branding">Branding</a> (logo, colours, footer).${client ? ' The no-reply footer from Bank &amp; branches is added below it.' : ''}</div></label>
            ${client ? `<h3 style="margin:16px 0 8px">SMS</h3>
              <label class="f"><span>SMS text</span><textarea id="tp-sms" rows="4">${U.esc(Messaging.smsTemplate(sel, t))}</textarea><div class="hint" id="tp-sms-count"></div><div class="hint">Sent to every phone number on the application. Plain text only; keep to 160 plain characters (no – or curly quotes) for one SMS. Placeholders work here too.</div></label>
              <div class="btn-row" style="margin-top:6px"><button class="btn-sm" id="tp-sms-std">Use the standard SMS text</button></div>`
            : '<div class="alert info" style="margin-top:14px"><div>Staff get this by email and in their inbox in the system. No SMS is sent to staff.</div></div>'}
            <div style="margin-top:12px"><small>Click a placeholder to insert it at the cursor:</small><div class="vars" style="margin-top:4px">${TEMPLATE_VARS.map(([k, l]) => `<code title="${U.esc(l)}" data-var="${k}">{{${k}}}</code>`).join('')}</div></div>
            <div class="btn-row" style="margin-top:14px"><button class="btn-primary" id="tp-save">Save template</button><button id="tp-reset">Restore default</button></div>
          </div></div>
        <div class="card"><div class="card-h"><h2>Preview</h2><div class="btn-row"><small>using ${U.esc(sample?.ref || 'sample data')}</small>${client ? '<div class="pill-group"><button class="on" data-pv="email">Email</button><button data-pv="sms">SMS</button></div>' : ''}</div></div><div class="card-b"><div id="tp-prev"></div></div></div>
      </div></div>`;
    let lastFocus = U.$('#tp-body'), showing = 'email', timer = null;
    const vars = () => (sample ? Engine.vars(sample, { comment: '(comment text)', allocatedAmount: '10,000.00', rate: '1,758.2000', mwkEquivalent: '17,582,000.00', deadline: '16:00 on 21 Oct 2026', paidAmount: '10,000.00', processingStatus: 'Fully paid. This application is now closed.',
      chargesTotal: '87,910.00', chargesText: 'Commission 0.5%', totalToFund: '17,669,910.00',
      userName: 'Grace Banda', username: `grace.banda@${Brand.current.emailDomain}`, resetLink: `${location.origin}${location.pathname}#/reset/…`, expiryMinutes: Store.state.settings.passwordResetMinutes, changedAt: U.fmtDateTime(Store.now()) }) : {});
    const smsCount = () => { if (U.$('#tp-sms')) U.$('#tp-sms-count').textContent = `As written: ${Messaging.segmentLabel(U.$('#tp-sms').value)} · with sample data: ${Messaging.segmentLabel(Engine.render(U.$('#tp-sms').value, vars()))}`; };
    const prev = () => {
      const v = vars();
      if (showing === 'sms' && U.$('#tp-sms')) {
        U.$('#tp-prev').innerHTML = Messaging.smsBubble(Engine.render(U.$('#tp-sms').value, v).replace(/[ \t]+/g, ' ').trim(), sample?.customer?.phone || '');
      } else {
        const footer = client ? Engine.render(S.bank.noReplyFooter, v).trim() : '';
        U.$('#tp-prev').innerHTML = Messaging.emailFrame({ subject: Engine.render(U.$('#tp-subject').value, v), body: Engine.render(U.$('#tp-body').value, v), footer }, 460);
      }
      smsCount();
    };
    const later = () => { clearTimeout(timer); timer = setTimeout(prev, 200); };
    ['#tp-subject', '#tp-body', '#tp-sms'].forEach(s => { const el = U.$(s); if (!el) return; el.addEventListener('input', later); el.addEventListener('focus', e => { lastFocus = e.target; if (s === '#tp-sms' && showing !== 'sms') U.$('#adm [data-pv="sms"]')?.click(); }); });
    U.$$('#adm [data-pv]').forEach(b => b.addEventListener('click', () => { showing = b.dataset.pv; U.$$('#adm [data-pv]').forEach(x => x.classList.toggle('on', x === b)); prev(); }));
    U.$$('#adm [data-var]').forEach(c => c.addEventListener('click', () => {
      const el = lastFocus, ins = `{{${c.dataset.var}}}`;
      const p = el.selectionStart ?? el.value.length;
      el.value = el.value.slice(0, p) + ins + el.value.slice(el.selectionEnd ?? p);
      el.focus(); el.setSelectionRange(p + ins.length, p + ins.length); prev();
    }));
    U.$$('#adm [data-tpl]').forEach(r => r.addEventListener('click', () => { Admin.tplSel = r.dataset.tpl; Admin.templates(); }));
    U.$('#tp-sms-std')?.addEventListener('click', () => { U.$('#tp-sms').value = DEFAULT_SMS[sel] || Messaging.smsTemplate(sel, {}); prev(); });
    U.$('#tp-save').addEventListener('click', () => {
      const upd = { subject: U.$('#tp-subject').value, body: U.$('#tp-body').value, enabled: U.$('#tp-on').checked };
      if (client) upd.sms = U.$('#tp-sms').value.trim();
      Object.assign(t, upd);
      Store.audit('TEMPLATE_UPDATED', null, client ? `${t.name} (email and SMS)` : t.name);
      Store.save(); UI.toast('Template saved.', 'ok'); Admin.templates();
    });
    U.$('#tp-reset').addEventListener('click', async () => {
      if (!await UI.confirm('Restore default?', `<p>Replace this template with the original wording${client ? ' (email and SMS)' : ''}?</p>`, 'Restore')) return;
      S.templates[sel] = U.clone(DEFAULT_TEMPLATES[sel]);
      Store.audit('TEMPLATE_UPDATED', null, `${t.name} restored to default`);
      Store.save(); Admin.templates();
    });
    prev();
  },

  /* ---------- bank, branches, correspondents ---------- */
  branches() {
    const S = Store.state;
    U.$('#adm').innerHTML = `
      <div class="card"><div class="card-h"><h2>Bank details</h2><button class="btn-sm" id="bk-edit">Edit</button></div><div class="card-b">
        <dl class="kv"><dt>Name</dt><dd>${U.esc(S.bank.name)}</dd><dt>Address</dt><dd>${U.esc(S.bank.address)}</dd><dt>Phone</dt><dd>${U.esc(S.bank.phone)}</dd><dt>Email</dt><dd>${U.esc(S.bank.email)}</dd><dt>SWIFT</dt><dd class="mono">${U.esc(S.bank.swift)}</dd></dl>
        <p class="muted" style="margin-bottom:0">Used as {{bankName}}, {{bankPhone}} and {{bankEmail}} in templates.</p></div></div>
      <div class="card"><div class="card-h"><h2>Client email sender (no-reply)</h2><button class="btn-sm" id="nr-edit">Edit</button></div><div class="card-b">
        <dl class="kv"><dt>Sent from</dt><dd>${U.esc(S.bank.senderName)} &lt;<span class="mono">${U.esc(S.bank.noReplyEmail)}</span>&gt; ${UI.tag('Does not receive mail', 'grey')}</dd>
        <dt>Footer on every client email</dt><dd><div class="msg-body">${U.esc(S.bank.noReplyFooter)}</div></dd></dl>
        <p class="muted" style="margin-bottom:0">All generated client emails come from this address. It must be an unmonitored mailbox set to reject or discard incoming mail. Do not use a branch or staff address. Clients are pointed to their branch contacts in the footer instead.</p></div></div>
      <div class="card"><div class="card-h"><h2>Branches</h2><button class="btn-sm btn-primary" data-br="">+ Add branch</button></div><div class="card-b tight"><div class="table-wrap"><table>
        <thead><tr><th>Code</th><th>Name</th><th>Address</th><th>Phone</th><th>Email</th><th>Contact person</th><th></th></tr></thead><tbody>
        ${S.branches.map(b => `<tr><td class="mono">${U.esc(b.code)}</td><td><b>${U.esc(b.name)}</b></td><td>${U.esc(b.address)}</td><td>${U.esc(b.phone)}</td><td>${U.esc(b.email)}</td><td>${U.esc(b.manager)}</td><td><button class="btn-sm" data-br="${b.id}">Edit</button></td></tr>`).join('')}
      </tbody></table></div></div></div>
      <div class="card"><div class="card-h"><h2>Correspondent banks</h2><button class="btn-sm btn-primary" data-cb="">+ Add bank</button></div><div class="card-b tight"><div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>SWIFT/BIC</th><th>Currencies</th><th></th></tr></thead><tbody>
        ${S.correspondents.map(c => `<tr><td><b>${U.esc(c.name)}</b></td><td class="mono">${U.esc(c.swift)}</td><td>${U.esc(c.currencies)}</td><td><button class="btn-sm" data-cb="${c.id}">Edit</button></td></tr>`).join('')}
      </tbody></table></div></div></div>`;
    const form = (obj, fields) => `<div class="grid g2">${fields.map(([k, l, span]) => `<label class="f ${span ? 'span-all' : ''}"><span>${l}</span><input name="${k}" value="${U.esc(obj[k] || '')}"></label>`).join('')}</div>`;
    U.$('#bk-edit').addEventListener('click', () => UI.modal({
      title: 'Bank details', body: form(S.bank, [['name', 'Name'], ['swift', 'SWIFT/BIC'], ['address', 'Address', 1], ['phone', 'Phone'], ['email', 'Email']]),
      actions: [{ label: 'Save', onClick: el => { Object.assign(S.bank, UI.formData(el)); Store.audit('BANK_UPDATED', null, S.bank.name); Store.save(); Admin.branches(); } }],
    }));
    U.$('#nr-edit').addEventListener('click', () => UI.modal({
      title: 'Client email sender (no-reply)',
      body: `<div class="grid g2">
          <label class="f"><span>Sender display name</span><input name="senderName" value="${U.esc(S.bank.senderName)}"></label>
          <label class="f"><span>No-reply address</span><input name="noReplyEmail" type="email" value="${U.esc(S.bank.noReplyEmail)}"></label>
          <label class="f span-all"><span>Footer added to every client email</span><textarea name="noReplyFooter" rows="4">${U.esc(S.bank.noReplyFooter)}</textarea><div class="hint">Placeholders like {{branchName}}, {{branchPhone}} and {{branchEmail}} can be used. Leave blank for no footer.</div></label></div>`,
      actions: [{ label: 'Save', onClick: el => {
        const d = UI.formData(el);
        const addr = d.noReplyEmail.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) { UI.toast('Enter a valid email address.', 'error'); return false; }
        const clash = [S.bank.email, ...S.branches.map(b => b.email), ...S.users.map(u => u.email)].some(e => String(e || '').trim().toLowerCase() === addr);
        if (clash) { UI.toast('Use a dedicated no-reply mailbox, not the bank, a branch or a staff address.', 'error'); return false; }
        Object.assign(S.bank, { senderName: d.senderName.trim() || S.bank.name, noReplyEmail: addr, noReplyFooter: d.noReplyFooter });
        Store.audit('BANK_UPDATED', null, `Client email sender set to ${addr}`); Store.save(); Admin.branches();
      } }],
    }));
    U.$$('#adm [data-br]').forEach(btn => btn.addEventListener('click', () => {
      const b = S.branches.find(x => x.id === btn.dataset.br) || {};
      UI.modal({
        title: b.id ? `Edit ${b.name}` : 'Add branch',
        body: form(b, [['code', 'Code'], ['name', 'Name'], ['address', 'Address', 1], ['phone', 'Phone'], ['email', 'Email'], ['manager', 'Contact person']]),
        actions: [{ label: 'Save', onClick: el => {
          const d = UI.formData(el);
          if (!d.name.trim()) { UI.toast('Name is required.', 'error'); return false; }
          if (b.id) Object.assign(b, d); else S.branches.push(Object.assign({ id: U.uid('br') }, d));
          Store.audit('BRANCH_SAVED', null, d.name); Store.save(); Admin.branches();
        } }],
      });
    }));
    U.$$('#adm [data-cb]').forEach(btn => btn.addEventListener('click', () => {
      const c = S.correspondents.find(x => x.id === btn.dataset.cb) || {};
      UI.modal({
        title: c.id ? `Edit ${c.name}` : 'Add correspondent bank',
        body: form(c, [['name', 'Name', 1], ['swift', 'SWIFT/BIC'], ['currencies', 'Currencies (comma separated)']]),
        actions: [{ label: 'Save', onClick: el => {
          const d = UI.formData(el);
          if (!d.name.trim()) { UI.toast('Name is required.', 'error'); return false; }
          if (c.id) Object.assign(c, d); else S.correspondents.push(Object.assign({ id: U.uid('cb') }, d));
          Store.audit('CORRESPONDENT_SAVED', null, d.name); Store.save(); Admin.branches();
        } }],
      });
    }));
  },

  /* ---------- users ---------- */
  users() {
    const S = Store.state;
    const status = u => u.active === false ? UI.tag('Inactive', 'grey') : u.locked ? UI.tag('Locked', 'red') : UI.tag('Active', 'green');
    U.$('#adm').innerHTML = `<div class="alert info" style="margin-bottom:12px"><div>Users sign in with their username and password. New users get a <b>temporary password</b> from you and must change it at first sign-in. Users can reset a forgotten password with an emailed link while their account is not locked. <b>A locked account is unlocked or reset only by an administrator, and an administrator's only by another administrator</b> (an administrator cannot do their own). If every administrator is locked out, IT recovers one on the database on the server. Accounts lock after ${Auth.maxFailed()} wrong passwords. In production, sign-in would normally use the bank's directory (e.g. Active Directory).</div></div>
      ${S.users.filter(x => x.role === 'ADMIN' && x.active !== false).length < 2 ? '<div class="alert warn" style="margin-bottom:12px"><div><b>Only one active administrator.</b> An administrator\'s password can only be reset by another administrator, so add a second administrator account in case this one is locked out or the password is forgotten.</div></div>' : ''}
      <div class="card"><div class="card-h"><h2>Users</h2><button class="btn-sm btn-primary" data-u="">+ Add user</button></div><div class="card-b tight"><div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Branch</th><th>Status</th><th>Password</th><th>Last sign-in</th><th></th></tr></thead><tbody>
      ${S.users.map(u => `<tr><td><b>${U.esc(u.name)}</b><br><small>${U.esc(u.email)}</small></td><td class="mono">${U.esc(u.username)}</td><td>${ROLES[u.role]}</td><td>${U.esc(UI.branchName(u.branchId))}${(u.extraBranchIds || []).length ? `<br><small>+ ${U.esc(u.extraBranchIds.map(b => UI.branchName(b)).join(', '))}</small>` : ''}</td>
        <td>${status(u)}${u.failedAttempts && !u.locked ? `<br><small>${u.failedAttempts} failed attempt(s)</small>` : ''}</td>
        <td>${u.mustChangePassword ? UI.tag('Temporary – must change', 'amber') : `<small>Changed ${U.fmtDate(u.passwordChangedAt)}</small>`}</td>
        <td class="nowrap"><small>${u.lastLoginAt ? U.fmtDateTime(u.lastLoginAt) : 'Never'}</small></td>
        <td><div class="btn-row" style="flex-wrap:nowrap"><button class="btn-sm" data-u="${u.id}">Edit</button><button class="btn-sm" data-pw="${u.id}" ${u.id === Store.user().id ? 'disabled title="Your own password must be reset by another administrator. Use Change password to change it."' : ''}>Password…</button>${u.locked ? `<button class="btn-sm btn-success" data-unlock="${u.id}">Unlock</button>` : ''}</div></td></tr>`).join('')}
      </tbody></table></div></div></div>`;

    const pwFields = (label) => `<label class="f"><span>${label} <b class="req">*</b></span><input name="pw" type="password" autocomplete="new-password"></label>
      <label class="f"><span>Confirm <b class="req">*</b></span><input name="pw2" type="password" autocomplete="new-password"></label>
      <div class="span-all hint">At least ${Auth.minLength()} characters with upper and lower case letters, a number and a symbol. Give it to the user privately; they must change it at first sign-in.</div>`;

    U.$$('#adm [data-u]').forEach(btn => btn.addEventListener('click', () => {
      const u = S.users.find(x => x.id === btn.dataset.u) || { active: true };
      const isNew = !u.id;
      UI.modal({
        title: isNew ? 'Add user' : `Edit ${u.name}`,
        body: `<div class="grid g2">
          <label class="f"><span>Name <b class="req">*</b></span><input name="name" value="${U.esc(u.name || '')}"></label>
          <label class="f"><span>Email <b class="req">*</b></span><input name="email" type="email" value="${U.esc(u.email || '')}"></label>
          <label class="f"><span>Username <b class="req">*</b></span><input name="username" value="${U.esc(u.username || '')}" placeholder="Defaults to the email"></label>
          <label class="f"><span>Role</span><select name="role">${Object.entries(ROLES).map(([k, l]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="f"><span>Branch</span><select name="branchId">${S.branches.map(b => `<option value="${b.id}" ${u.branchId === b.id ? 'selected' : ''}>${U.esc(b.code)} · ${U.esc(b.name)}</option>`).join('')}</select></label>
          <div class="f span-all" id="xb-box"><span>Further branches <small class="muted">(inputters and authorisers – they work for each, as for their own branch)</small></span>
            <div style="display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:4px;max-height:140px;overflow:auto">${S.branches.map(b => `<label class="btn-row" style="gap:5px"><input type="checkbox" data-xb value="${b.id}" ${(u.extraBranchIds || []).includes(b.id) ? 'checked' : ''}> ${U.esc(b.code)} · ${U.esc(b.name)}</label>`).join('')}</div></div>
          <label class="f"><span>Status</span><select name="active"><option value="1" ${u.active !== false ? 'selected' : ''}>Active</option><option value="0" ${u.active === false ? 'selected' : ''}>Inactive</option></select></label>
          ${isNew ? pwFields('Temporary password') : ''}</div>`,
        actions: [{ label: 'Save', onClick: async el => {
          const d = UI.formData(el);
          d.extraBranchIds = ['INPUTTER', 'AUTHORISER'].includes(d.role) ? [...el.querySelectorAll('[data-xb]:checked')].map(x => x.value).filter(b => b !== d.branchId) : [];
          d.name = d.name.trim(); d.email = d.email.trim(); d.username = (d.username.trim() || d.email).toLowerCase();
          if (!d.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) { UI.toast('Name and a valid email are required.', 'error'); return false; }
          if (S.users.some(x => x.id !== u.id && (x.username || '').toLowerCase() === d.username)) { UI.toast('That username is already taken.', 'error'); return false; }
          d.active = d.active === '1';
          if (u.id === Store.user().id && (!d.active || d.role !== 'ADMIN')) { UI.toast('You cannot remove your own admin access.', 'error'); return false; }
          const { pw, pw2 } = d; delete d.pw; delete d.pw2;
          if (isNew) {
            if (pw !== pw2) { UI.toast('The passwords do not match.', 'error'); return false; }
            const nu = Object.assign({ id: U.uid('u') }, d);
            // Two or more administrators: a new user waits for another administrator's approval (js/approvals.js).
            Object.assign(nu, { createdAt: Store.now().toISOString(), createdBy: Store.user().id, createdByName: Store.user().name });
            if (Approvals.needed()) nu.pendingApproval = true;
            await Auth.adminSetTemporary(nu, pw);      // throws if the password breaks the policy
            S.users.push(nu);
          } else {
            if (u.active === false && d.active) { Object.assign(d, { reactivatedAt: Store.now().toISOString() }); delete u.disabledReason; delete u.disabledAt; }
            // Two or more administrators: name, email, username, role and branch changes wait for another administrator (js/approvals.js).
            let waits = false;
            try { waits = Approvals.proposeUserChange(u, d); } catch (e) { UI.error(e); return false; }
            if (waits) { Store.save(); App.render(); UI.toast(`Saved. The change to ${u.name} waits for another administrator's approval.`, 'ok'); return; }
            Object.assign(u, d);
          }
          Store.audit('USER_SAVED', null, `${d.name} (${d.username}) – ${ROLES[d.role]}, ${UI.branchName(d.branchId)}${d.extraBranchIds.length ? ` and ${d.extraBranchIds.map(b => UI.branchName(b)).join(', ')}` : ''}${d.active ? '' : ', inactive'}`);
          Store.save(); App.render();
          if (isNew) UI.toast(Approvals.needed() && S.users.find(x => x.username === d.username)?.pendingApproval ? `${d.name} created and waiting for another administrator's approval. They cannot sign in until approved.` : `${d.name} created. Give them the temporary password; they must change it at first sign-in.`, 'ok');
        } }],
      });
    }));

    U.$$('#adm [data-pw]').forEach(btn => btn.addEventListener('click', () => {
      const u = S.users.find(x => x.id === btn.dataset.pw);
      UI.modal({
        title: `Password – ${u.name}`,
        body: `<div class="radio-row" style="margin-bottom:12px">
            <label class="radio-card"><input type="radio" name="how" value="TEMP" checked><span><b>Set a temporary password</b><small>You give it to the user; they must change it at next sign-in. Also unlocks the account.</small></span></label>
            <label class="radio-card"><input type="radio" name="how" value="LINK"><span><b>Email a reset link</b><small>Sends a single-use link to ${U.esc(u.email)} (valid ${S.settings.passwordResetMinutes} minutes).</small></span></label></div>
          <div class="grid g2" id="pw-temp">${pwFields('Temporary password')}</div>`,
        onOpen: el => el.querySelectorAll('[name=how]').forEach(r => r.addEventListener('change', () => U.$('#pw-temp', el).classList.toggle('hidden', UI.formData(el).how !== 'TEMP'))),
        actions: [{ label: 'Apply', onClick: async el => {
          const d = UI.formData(el);
          if (d.how === 'LINK') {
            Auth.requestReset(u.username, Store.user());
            UI.toast(`Reset link emailed to ${u.email}.`, 'ok');
          } else {
            if (d.pw !== d.pw2) { UI.toast('The passwords do not match.', 'error'); return false; }
            await Auth.adminSetTemporary(u, d.pw);
            UI.toast(`Temporary password set. ${u.name} must change it at next sign-in.`, 'ok');
          }
          Admin.users();
        } }],
      });
    }));

    U.$$('#adm [data-unlock]').forEach(btn => btn.addEventListener('click', () => {
      Auth.unlock(S.users.find(x => x.id === btn.dataset.unlock));
      UI.toast('Account unlocked.', 'ok');
      Admin.users();
    }));
  },

  /* ---------- settings ---------- */
  settings() {
    const s = Store.state.settings;
    U.$('#adm').innerHTML = `<div class="grid g2" style="align-items:start">
      <div class="card"><div class="card-h"><h2>Business rules</h2></div><div class="card-b grid g2">
        <label class="f"><span>Travel allowance per day (USD)</span><input name="perDiemUSD" type="number" value="${s.perDiemUSD}"></label>
        <label class="f"><span>Ticket required above (USD)</span><input name="ticketThresholdUSD" type="number" value="${s.ticketThresholdUSD}"></label>
        <label class="f"><span>Funding cut-off time</span><input name="fundingCutoff" type="time" value="${s.fundingCutoff}"></label>
        <label class="f"><span>Advance reconciliation (days after full payment)</span><input name="reconDays" type="number" value="${s.reconDays}"></label>
        <label class="f"><span>Client with unreconciled advance payments (any branch)</span><select name="unreconciledBlock">${[['ANY', 'Block new applications until all are reconciled'], ['OVERDUE', 'Block only when one is overdue'], ['WARN', 'Warn only (do not block)']].map(([k, l]) => `<option value="${k}" ${(s.unreconciledBlock || 'ANY') === k ? 'selected' : ''}>${l}</option>`).join('')}</select><div class="hint">Checked on the account and ID number at capture; blocks submission and authorisation</div></label>
        <label class="f"><span>Reconciliation reminders (days before due)</span><input name="reconPreDueOffsets" value="${s.reconPreDueOffsets.join(', ')}"><div class="hint">Default 14, 11, 7, 4 = twice a week for 2 weeks</div></label>
        <label class="f"><span>Overdue reminder every (days)</span><input name="reconOverdueEveryDays" type="number" value="${s.reconOverdueEveryDays}"></label>
        <label class="f"><span>Travel notice every (days)</span><input name="travelWeeklyEveryDays" type="number" value="${s.travelWeeklyEveryDays}"></label>
        <label class="f"><span>Daily travel notices for last (days)</span><input name="travelDailyLastDays" type="number" value="${s.travelDailyLastDays}"></label>
        <div class="span-all" style="border-top:1px solid var(--line-2);padding-top:10px"><h3>Branch alerts</h3></div>
        <label class="f"><span>Expiry alerts (days before)</span><input name="expiryAlertDays" value="${s.expiryAlertDays.join(', ')}"><div class="hint">Travel date, visa expiry and reconciliation date</div></label>
        <label class="f"><span>Funding deadline alert (hours before)</span><input name="fundingReminderHours" type="number" step="0.5" value="${s.fundingReminderHours}"></label>
        <label class="f"><span>Alert when open longer than (days)</span><input name="agingDays" type="number" value="${s.agingDays}"></label>
        <label class="f"><span>…then repeat every (days)</span><input name="agingRepeatDays" type="number" value="${s.agingRepeatDays}"></label>
        <div class="span-all" style="border-top:1px solid var(--line-2);padding-top:10px"><h3>Sign-in security</h3></div>
        <label class="f"><span>Minimum password length</span><input name="passwordMinLength" type="number" min="12" value="${Auth.minLength()}"></label>
        <label class="f"><span>Lock after failed attempts</span><input name="maxFailedLogins" type="number" min="1" max="3" value="${Auth.maxFailed()}"></label>
        <label class="f"><span>Reset link valid for (minutes)</span><input name="passwordResetMinutes" type="number" value="${s.passwordResetMinutes}"></label>
        <label class="f"><span>Sign out after inactivity (minutes)</span><input name="sessionTimeoutMinutes" type="number" value="${s.sessionTimeoutMinutes}"></label>
      </div></div>
      <div class="card"><div class="card-h"><h2>Indicative rates (MWK per unit)</h2></div><div class="card-b grid g2">
        ${CURRENCIES.map(c => `<label class="f"><span>${c}</span><input name="rate_${c}" type="number" step="0.0001" value="${s.rates[c]}"></label>`).join('')}
        <div class="span-all hint">Used for equivalents and validations (USD 500/day, USD 3,000 ticket threshold). Treasury sets the actual deal rate on each allocation.</div>
      </div></div></div>
      <div class="btn-row" style="margin-top:16px"><button class="btn-primary" id="st-save">Save settings</button></div>`;
    U.$('#st-save').addEventListener('click', () => {
      const d = UI.formData(U.$('#adm'));
      const n = k => Number(d[k]);
      const offsets = d.reconPreDueOffsets.split(',').map(x => parseInt(x, 10)).filter(x => x > 0);
      const expiryDays = d.expiryAlertDays.split(',').map(x => parseInt(x, 10)).filter(x => x > 0);
      if ([n('perDiemUSD'), n('ticketThresholdUSD'), n('reconDays'), n('reconOverdueEveryDays'), n('travelWeeklyEveryDays'), n('fundingReminderHours'), n('agingDays'), n('agingRepeatDays'), n('maxFailedLogins'), n('passwordResetMinutes'), n('sessionTimeoutMinutes')].some(x => !(x > 0)) || !(n('passwordMinLength') >= 8) || !offsets.length || !expiryDays.length || !/^\d\d:\d\d$/.test(d.fundingCutoff)) {
        UI.toast('Check the values – numbers must be greater than zero.', 'error'); return;
      }
      Object.assign(s, {
        perDiemUSD: n('perDiemUSD'), ticketThresholdUSD: n('ticketThresholdUSD'), fundingCutoff: d.fundingCutoff, reconDays: n('reconDays'), unreconciledBlock: d.unreconciledBlock || 'ANY',
        reconPreDueOffsets: offsets, reconOverdueEveryDays: n('reconOverdueEveryDays'), travelWeeklyEveryDays: n('travelWeeklyEveryDays'),
        travelDailyLastDays: Math.max(0, n('travelDailyLastDays')),
        expiryAlertDays: expiryDays, fundingReminderHours: n('fundingReminderHours'), agingDays: n('agingDays'), agingRepeatDays: n('agingRepeatDays'),
        passwordMinLength: Math.max(12, n('passwordMinLength')), maxFailedLogins: Math.max(1, Math.min(3, n('maxFailedLogins'))), passwordResetMinutes: n('passwordResetMinutes'), sessionTimeoutMinutes: n('sessionTimeoutMinutes'),
      });
      CURRENCIES.forEach(c => { if (n(`rate_${c}`) > 0) s.rates[c] = n(`rate_${c}`); });
      Store.audit('SETTINGS_UPDATED', null, 'Business rules and indicative rates');
      Store.save(); UI.toast('Settings saved.', 'ok');
    });
  },

  /* ---------- branding (white-label for presentations and new clients) ---------- */
  branding() {
    const S = Store.state;
    const draft = Admin.brPending || Brand.merge(S.branding);   // brPending: a brand file just loaded, not saved yet
    Admin.brPending = null;
    Brand.previewMode = null;
    let editMode = Admin.brEditMode || (Brand.mode(draft) === 'dark' ? 'dark' : 'light');
    Brand.previewMode = editMode;

    const COLORS = [['primary', 'Main colour', 'Buttons, links, headings, the selected menu item; the automatic sidebar is a darker shade'], ['accent', 'Accent colour', 'Second stripe colour under the logo; exports'], ['highlight', 'Highlight colour', 'Third stripe colour under the logo; exports']];
    const THEME_ROWS = [
      ['background', 'Page background', 'Behind the cards on every page', '--bg', '--page-ink'],
      ['surface', 'Cards & panels', 'Cards, tables, forms and pop-ups', '--card', '--surface-ink'],
      ['header', 'Header (top bar)', 'Page title, user, light/dark switch', '--header-bg', '--header-fg'],
      ['sidebar', 'Sidebar', 'Logo, product name and menu on the left', '--sidebar-bg', '--sidebar-fg'],
      ['footer', 'Footer', 'Line at the bottom of every page', '--footer-bg', '--footer-fg'],
      ['login', 'Sign-in screen', 'Sign-in, forgotten-password and reset pages', '--login-bg', null],
    ];
    const EMAIL_ROWS = [
      ['background', 'Outer background', 'Around the message', k => [k.background, k.outside]],
      ['card', 'Message background', 'Behind the message text', k => [k.card, k.text]],
      ['text', 'Message text', 'Made darker or lighter automatically if hard to read', k => [k.card, k.text]],
      ['header', 'Title bar', 'Subject line under the logo · automatic = main colour', k => [k.header, k.headerText]],
      ['button', 'Links & buttons', 'Automatic = main colour', k => [k.button, k.buttonText]],
      ['footer', 'Footer', 'No-reply notice and branch contacts', k => [k.footer, k.footerText]],
    ];
    const at = (o, p) => p.split('.').reduce((x, k) => x[k], o);
    const put = (p, v) => { const ks = p.split('.'), last = ks.pop(); ks.reduce((x, k) => x[k], draft)[last] = v; };
    const canAuto = p => at(BRAND_DEFAULTS, p) === '';
    const chip = (r, min = 4.5) => `<span class="contrast ${r >= min ? 'ok' : 'low'}" title="Text contrast ${r.toFixed(1)}:1 – readable text needs at least ${min}:1 (WCAG AA)">${r >= min ? '✓' : '⚠'} ${r.toFixed(1)}:1</span>`;
    const swatch = (p, label, hint) => `<div class="swatch-row" data-row="${p}"><div class="lbl"><b>${label}</b><small>${hint}</small></div>
      <input type="color" data-path="${p}" aria-label="${U.esc(label)}"><input class="mono" data-hex="${p}" maxlength="7" aria-label="${U.esc(label)} (hex)">
      <div class="btn-row" style="gap:6px;flex-wrap:nowrap"><span data-chip="${p}"></span>${canAuto(p) ? `<label class="auto"><input type="checkbox" data-auto="${p}"> Automatic</label>` : ''}</div></div>`;
    const field = (k, label, hint = '') => `<label class="f"><span>${label}</span><input data-b="${k}" value="${U.esc(draft[k])}">${hint ? `<div class="hint">${hint}</div>` : ''}</label>`;

    U.$('#adm').innerHTML = `
      <div class="alert info" style="margin-bottom:12px"><div>Present the system in a client's name, logo and colours – from the sign-in screen to every page, email and SMS. Changes preview on this page at once; <b>Save branding</b> applies them for every user. Text colours are chosen automatically so every view stays readable; the ✓ ratios show the text contrast (4.5:1 or more is readable). The starting values come from <span class="mono">${BRAND_FILE}</span>; the logo and image files are at the bottom of this page.</div></div>
      <div class="cols">
        <div class="stack">
          <div class="card"><div class="card-h"><h2>Name</h2></div><div class="card-b grid g2">
            ${field('bankName', 'Client / bank name', 'Shown in titles, exports, emails, SMS and the sign-in card')}
            ${field('productName', 'Product name')}
            <label class="f span-all"><span>Tagline</span><input data-b="tagline" value="${U.esc(draft.tagline)}"></label>
            ${field('emailDomain', 'Email domain for demo and test users', 'Used for the demo / test users created by the test-data tools')}
            <label class="f" style="align-self:end"><span style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" id="br-bank" ${S.bank.name === draft.bankName || S.bank.name === BRAND_DEFAULTS.bankName ? 'checked' : ''}> Also use this name as the bank name in emails</span></label>
          </div></div>
          <div class="card"><div class="card-h"><h2>Brand colours</h2></div><div class="card-b grid g3">
            ${COLORS.map(([k, label, hint]) => `<label class="f"><span>${label}</span><div class="inline" style="align-items:center"><input type="color" data-path="colors.${k}" style="flex:0 0 52px;width:52px;height:36px;padding:2px;cursor:pointer"><input data-hex="colors.${k}" maxlength="7" class="mono"></div><div class="hint">${hint}</div></label>`).join('')}
          </div></div>
          <div class="card"><div class="card-h"><h2>Screen colours</h2><div class="pill-group" role="tablist" aria-label="Colours for"><button data-edit="light">☀ Light mode</button><button data-edit="dark">☾ Dark mode</button></div></div><div class="card-b">
            <div class="grid g2" style="margin-bottom:10px">
              <label class="f"><span>Mode everyone starts in</span><select id="br-mode">${[['light', 'Light'], ['dark', 'Dark'], ['system', 'Follow each device (light or dark)']].map(([k, l]) => `<option value="${k}" ${draft.theme.mode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
              <label class="f" style="align-self:end"><span style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" id="br-switch" ${draft.theme.userSwitch ? 'checked' : ''}> Let each user switch between light and dark (button in the top bar and on the sign-in page)</span></label>
            </div>
            <p class="muted" style="margin:0 0 4px;font-size:12.5px" id="br-editing"></p>
            <div id="br-theme">${THEME_ROWS.map(([k, label, hint]) => swatch(`theme.${editMode}.${k}`, label, hint)).join('')}</div>
            <div style="border-top:1px solid var(--line-2);margin-top:6px;padding-top:4px">${swatch('theme.logoBand', 'Logo band', 'Behind the logo in the sidebar, sign-in card and emails (both modes)')}</div>
          </div></div>
          <div class="card"><div class="card-h"><h2>Email layout</h2><small>Every email the system sends</small></div><div class="card-b">
            <div id="br-email">${EMAIL_ROWS.map(([k, label, hint]) => swatch(`email.${k}`, label, hint)).join('')}</div>
            <div class="btn-row" style="margin-top:10px;gap:18px">
              <label class="btn-row" style="gap:6px;font-weight:500"><input type="checkbox" data-flag="email.showLogo" ${draft.email.showLogo ? 'checked' : ''}> Logo at the top</label>
              <label class="btn-row" style="gap:6px;font-weight:500"><input type="checkbox" data-flag="email.stripe" ${draft.email.stripe ? 'checked' : ''}> Three-colour stripe under the logo</label>
            </div>
            <p class="muted" style="margin:10px 0 0;font-size:12.5px">SMS are plain text and carry no colours; their wording is set per template in <a href="#/admin/templates">Notification templates</a> and starts with the client name.</p>
          </div></div>
          <div class="card"><div class="card-h"><h2>Logo and icon</h2></div><div class="card-b grid g2">
            <label class="f"><span>Logo – wide, shown on the logo band (SVG or PNG, max 400 KB)</span><input type="file" data-file="logo" accept=".svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg"></label>
            <label class="f"><span>Browser-tab icon – square (SVG or PNG, max 100 KB)</span><input type="file" data-file="icon" accept=".svg,.png,image/svg+xml,image/png"></label>
            <div class="span-all btn-row"><button class="btn-sm" id="br-logo-default">Use the default logo and icon</button></div>
          </div></div>
          <div class="btn-row"><button class="btn-primary" id="br-save">Save branding</button><button id="br-discard">Discard changes</button><button class="btn-danger" id="br-reset">Reset to defaults…</button>
            <span class="grow"></span><button id="br-download">⇩ Download brand file</button><label class="btn upload-btn">⇪ Load brand file<input type="file" id="br-upload" accept=".json,application/json"></label></div>
        </div>
        <div class="side">
          <div class="card"><div class="card-h"><h2>Preview</h2><small id="br-state">Saved</small></div><div class="card-b" id="br-preview"></div></div>
          <div class="card"><div class="card-h"><h2>Email preview</h2></div><div class="card-b" id="br-mail"></div></div>
        </div>
      </div>
      <div class="card" style="margin-top:16px"><div class="card-h"><h2>Brand asset files</h2><small>in <span class="mono">${U.esc(BRAND_ASSET_DIR)}</span></small></div><div class="card-b">${Admin.brandAssets()}</div></div>`;

    const root = U.$('#adm');
    const sampleMail = () => {
      const m = [...(S.outbox || [])].reverse().find(x => x.channel === 'Email' && x.audience === 'Client');
      if (m) { const footer = Messaging.clientFooter(m); return { subject: m.subject, body: footer && m.body.endsWith(footer) ? m.body.slice(0, -footer.length).trim() : m.body, footer }; }
      return { subject: 'Foreign currency allocated – please fund your account', footer: Engine.render(S.bank.noReplyFooter, { branchName: 'City Centre branch', branchPhone: '+000 000 000', branchEmail: `citycentre@${draft.emailDomain}` }).trim(),
        body: `Dear Customer,\n\nWe are pleased to advise that USD 10,000.00 has been allocated to your application FX2026-00012.\n\nPlease ensure your account is funded by 16:00 today.\n\nYours faithfully,\n${draft.bankName}` };
    };
    // Colour pickers and hex boxes show the colour in use (the worked-out one when "Automatic" is ticked).
    const refresh = () => {
      const pal = Brand.palette(draft, editMode), k = Brand.emailColors(draft);
      const shown = { 'theme.logoBand': draft.theme.logoBand };
      Object.keys(draft.colors).forEach(c => { shown[`colors.${c}`] = draft.colors[c]; });
      THEME_ROWS.forEach(([key, , , bgVar]) => { shown[`theme.${editMode}.${key}`] = pal[bgVar]; });
      EMAIL_ROWS.forEach(([key]) => { shown[`email.${key}`] = key === 'text' ? draft.email.text : ({ background: k.background, card: k.card, header: k.header, button: k.button, footer: k.footer })[key]; });
      Object.entries(shown).forEach(([p, v]) => {
        const auto = canAuto(p) && at(draft, p) === '';
        const c = root.querySelector(`[data-path="${p}"]`), h = root.querySelector(`[data-hex="${p}"]`), a = root.querySelector(`[data-auto="${p}"]`);
        if (c) { c.value = v; c.disabled = auto; }
        if (h && document.activeElement !== h) { h.value = auto ? '' : v; h.placeholder = auto ? `auto ${v}` : ''; h.disabled = auto; }
        if (a) a.checked = auto;
      });
      THEME_ROWS.forEach(([key, , , bgVar, fgVar]) => {
        const bg = pal[bgVar], fg = fgVar ? pal[fgVar] : Brand.onColor(bg);
        let html = chip(Brand.contrast(fg, bg));
        if (key === 'sidebar' && pal['--nav-active'] !== draft.colors.primary) html += ' <span class="contrast low" title="The main colour is too close to the sidebar, so the selected menu item uses a neutral highlight instead">selected item adjusted</span>';
        root.querySelector(`[data-chip="theme.${editMode}.${key}"]`).innerHTML = html;
      });
      EMAIL_ROWS.forEach(([key, , , pair]) => {
        const [bg, fg] = pair(k);
        let html = chip(Brand.contrast(fg, bg));
        if (key === 'text' && k.textAdjusted) html += ` <span class="contrast low" title="The chosen text colour was too faint on the message background">shown as ${k.text}</span>`;
        root.querySelector(`[data-chip="email.${key}"]`).innerHTML = html;
      });
      root.querySelector('[data-chip="theme.logoBand"]').innerHTML = '';
      root.querySelectorAll('[data-edit]').forEach(b => b.classList.toggle('on', b.dataset.edit === editMode));
      U.$('#br-editing').textContent = `Editing the ${editMode} mode colours – the whole page is previewing ${editMode} mode.`;
    };
    let mailTimer = null;
    const preview = () => {
      Brand.previewMode = editMode;
      Brand.apply(draft);
      const c = draft.colors, e = U.esc;
      U.$('#br-preview').innerHTML = `
        <div style="border:1px solid var(--line);border-radius:10px;overflow:hidden;font-size:12px">
          <div style="background:var(--logo-band);padding:10px 12px;position:relative"><img src="${e(draft.logo)}" alt="" style="max-width:100%;max-height:52px;display:block">
            <div style="position:absolute;left:0;right:0;bottom:0;height:4px;background:linear-gradient(90deg, ${c.primary} 0 55%, ${c.accent} 55% 78%, ${c.highlight} 78% 100%)"></div></div>
          <div style="display:grid;grid-template-columns:112px minmax(0,1fr);min-height:170px">
            <div style="background:var(--sidebar-bg);color:var(--sidebar-fg2);padding:10px 8px"><b style="color:var(--sidebar-fg);display:block;line-height:1.25">${e(draft.productName)}</b>
              <div style="margin-top:8px;background:var(--nav-active);color:var(--nav-active-fg);border-radius:6px;padding:4px 7px">Dashboard</div><div style="padding:4px 7px">Work queue</div><div style="padding:4px 7px">Reports</div></div>
            <div style="background:var(--bg);display:flex;flex-direction:column;min-width:0">
              <div style="background:var(--header-bg);color:var(--header-fg);border-bottom:1px solid var(--header-line);padding:6px 9px;font-weight:650;display:flex;justify-content:space-between;gap:6px">Page title<span style="color:var(--header-fg3);font-weight:400">${Brand.toggleLabel()}</span></div>
              <div style="padding:8px 9px;flex:1;color:var(--page-ink)"><div class="card" style="padding:8px 9px"><b>Card title</b><div class="muted">Muted text and labels</div>
                <div class="btn-row" style="margin-top:6px;gap:5px"><button class="btn-primary btn-sm">Primary</button><span class="badge t-blue">Status</span><a href="#/admin/branding">Link</a></div></div></div>
              <div style="background:var(--footer-bg);color:var(--footer-fg3);border-top:1px solid var(--footer-line);padding:5px 9px;font-size:11px">© <b style="color:var(--footer-fg)">${e(draft.bankName)}</b></div>
            </div></div></div>
        <div style="background:var(--login-bg);border-radius:10px;padding:14px;margin-top:10px;text-align:center">
          <div style="background:var(--card);color:var(--surface-ink);border-radius:8px;display:inline-block;min-width:150px;overflow:hidden;text-align:left"><div style="background:var(--logo-band);padding:6px 8px"><img src="${e(draft.logo)}" alt="" style="max-height:22px;max-width:120px;display:block"></div><div style="padding:6px 8px 8px"><b>Sign in</b><div style="height:14px;border:1px solid var(--input-line);background:var(--input-bg);border-radius:4px;margin-top:4px"></div></div></div>
          <div style="color:var(--login-fg3);font-size:11px;margin-top:6px">Sign-in screen · ${e(draft.productName)}</div></div>
        <p class="muted" style="margin-bottom:0;font-size:12px">The whole page behind you is previewing these settings too.</p>`;
      U.$('#br-state').textContent = JSON.stringify(Brand.merge(S.branding)) === JSON.stringify(draft) ? 'Saved' : 'Not saved yet';
      refresh();
      clearTimeout(mailTimer);
      mailTimer = setTimeout(() => { U.$('#br-mail').innerHTML = Messaging.emailFrame(sampleMail(), 480); }, 150);
    };

    root.addEventListener('input', ev => {
      const el = ev.target;
      if (el.dataset.b) { draft[el.dataset.b] = el.value; preview(); }
      else if (el.dataset.path) { put(el.dataset.path, Brand.norm(el.value)); preview(); }
      else if (el.dataset.hex && Brand.valid(el.value)) { put(el.dataset.hex, Brand.norm(el.value)); preview(); }
    });
    root.addEventListener('change', ev => {
      const el = ev.target;
      if (el.dataset.auto) { put(el.dataset.auto, el.checked ? '' : root.querySelector(`[data-path="${el.dataset.auto}"]`).value); preview(); }
      else if (el.dataset.flag) { put(el.dataset.flag, el.checked); preview(); }
      else if (el.id === 'br-mode') { draft.theme.mode = el.value; preview(); }
      else if (el.id === 'br-switch') { draft.theme.userSwitch = el.checked; preview(); }
      else if (el.dataset.hex) refresh();          // an unfinished hex code goes back to the colour in use
    });
    root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
      editMode = Admin.brEditMode = b.dataset.edit;
      U.$('#br-theme').innerHTML = THEME_ROWS.map(([k, label, hint]) => swatch(`theme.${editMode}.${k}`, label, hint)).join('');
      preview();
    }));
    // The light/dark switch in the top bar also changes which mode this page edits and previews.
    if (!Admin.brModeHook) {
      Admin.brModeHook = true;
      document.addEventListener('brand:mode', e => document.querySelector(`#adm [data-edit="${e.detail}"]`)?.click());
    }
    root.querySelectorAll('[data-file]').forEach(el => el.addEventListener('change', async () => {
      const f = el.files[0];
      if (!f) return;
      const max = el.dataset.file === 'logo' ? 400 * 1024 : 100 * 1024;
      if (f.size > max) { UI.toast(`${f.name} is larger than ${max / 1024} KB. Use a smaller or optimised file.`, 'error'); el.value = ''; return; }
      const why = await FileScan.brandProblem(f);                    // security check (filescan.js)
      if (why) { el.value = ''; try { FileScan.refuse(f.name, why); } catch (err) { UI.error(err); } return; }
      const r = new FileReader();
      r.onload = () => { draft[el.dataset.file] = r.result; preview(); };
      r.readAsDataURL(f);
    }));
    U.$('#br-logo-default').addEventListener('click', () => { draft.logo = BRAND_DEFAULTS.logo; draft.icon = BRAND_DEFAULTS.icon; preview(); });
    root.querySelectorAll('[data-use]').forEach(b => b.addEventListener('click', () => {
      draft[b.dataset.use] = b.dataset.url; preview();
      UI.toast(`${b.dataset.name} set as the ${b.dataset.use === 'logo' ? 'logo' : 'browser-tab icon'}. Save branding to keep it.`);
    }));

    const save = (value, msg) => {
      const before = Brand.merge(S.branding);
      S.branding = value;
      const b = Brand.merge(value);
      if (U.$('#br-bank')?.checked) { S.bank.name = b.bankName; S.bank.senderName = b.bankName; }
      // A new email domain also moves the no-reply sender, bank and branch addresses that still use the old one.
      if (before.emailDomain !== b.emailDomain) {
        const old = new RegExp(`@${before.emailDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        const swap = addr => String(addr || '').replace(old, `@${b.emailDomain}`);
        S.bank.noReplyEmail = swap(S.bank.noReplyEmail);
        S.bank.email = swap(S.bank.email);
        S.branches.forEach(br => { br.email = swap(br.email); });
      }
      Store.audit('BRANDING_UPDATED', null, `Branding set to ${b.bankName} (${b.productName}); starts in ${b.theme.mode} mode${b.theme.userSwitch ? ', users may switch' : ''}`);
      Store.save();
      Brand.apply(S.branding);
      App.renderChrome();
      UI.toast(msg, 'ok');
      Admin.branding();
    };
    U.$('#br-save').addEventListener('click', () => {
      if (!draft.bankName.trim() || !draft.productName.trim()) { UI.toast('Enter the client name and the product name.', 'error'); return; }
      save(JSON.parse(JSON.stringify(draft)), 'Branding saved for all users.');
    });
    U.$('#br-discard').addEventListener('click', () => Admin.branding());
    U.$('#br-reset').addEventListener('click', async () => {
      if (await UI.confirm('Reset branding?', '<p>Go back to the defaults in <span class="mono">brand/brand.js</span> for every user – names, logo, screen colours for both modes and the email layout?</p>', 'Reset', 'btn-danger')) save({}, 'Branding reset to the defaults.');
    });
    U.$('#br-download').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `brand-${draft.bankName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
      a.click();
    });
    U.$('#br-upload').addEventListener('change', e => {
      const f = e.target.files[0];
      if (!f) return;
      e.target.value = '';
      if (f.size > 2 * 1024 * 1024) { UI.toast('That file is too large to be a brand file.', 'error'); return; }
      const r = new FileReader();
      r.onload = async () => {
        let loaded;
        try { loaded = Brand.merge(JSON.parse(r.result)); } catch (err) { UI.toast('That file is not a valid brand file.', 'error'); return; }
        // The logo and icon inside a brand file get the same security check as an uploaded image.
        for (const k of ['logo', 'icon']) {
          const why = await FileScan.brandValueProblem(loaded[k]);
          if (why) { try { FileScan.refuse(`${f.name} (${k})`, why); } catch (err) { UI.error(err); } return; }
        }
        Admin.brPending = loaded;
        Admin.branding();
        UI.toast(`Loaded ${f.name}. Check the preview, then Save branding.`);
      };
      r.readAsText(f);
    });
    preview();
  },

  /* ---------- brand asset files (shown at the bottom of the Branding tab) ---------- */
  brandAssets() {
    return `<p class="muted" style="margin-top:0">The logo and image files that come with the system. Large files show no preview to keep this page fast; open them to view. <b>Use as logo</b> or <b>Use as icon</b> puts a file into the branding above (then Save branding).</p>
      <div class="grid g3">${BRAND_ASSETS.map(a => {
        const url = `${BRAND_ASSET_DIR}${a.file}`;
        const use = a.preview ? `<button class="btn-sm" data-use="logo" data-url="${U.esc(url)}" data-name="${U.esc(a.name)}">Use as logo</button><button class="btn-sm" data-use="icon" data-url="${U.esc(url)}" data-name="${U.esc(a.name)}">Use as icon</button>` : '';
        return `<div style="border:1px solid var(--line);border-radius:8px;padding:12px">
          <div style="height:130px;display:grid;place-items:center;border-radius:8px;margin-bottom:10px;background:${a.dark ? '#0a0d14' : '#ffffff'};border:1px solid var(--line-2)">
            ${a.preview ? `<img src="${url}" alt="${U.esc(a.name)}" style="max-width:90%;max-height:110px">` : `<span style="color:#8fa3cc">${U.esc(a.size)} · no preview</span>`}</div>
          <b>${U.esc(a.name)}</b><div class="muted" style="font-size:12.5px">${U.esc(a.use)}</div>
          <div class="mono muted" style="margin:6px 0 10px;overflow-wrap:anywhere">${U.esc(a.file)} · ${U.esc(a.size)}</div>
          <div class="btn-row"><a class="btn btn-sm" href="${url}" target="_blank" rel="noopener">Open</a><a class="btn btn-sm" href="${url}" download>⇩ Download</a>${use}</div>
        </div>`;
      }).join('')}</div>`;
  },

  /* ---------- demo data ---------- */
  /* A clean start, then the generator. The same person stays signed in. */
  async loadTestData(progress) {
    const me = Store.user().id;
    await Store.reset();
    const S = Store.state;
    Object.assign(S, { currentUserId: me, apps: [], audit: [], outbox: [] });
    return TestData.run(progress);
  },

  data() {
    const S = Store.state;
    U.$('#adm').innerHTML = `<div class="card"><div class="card-h"><h2>Demo data</h2></div><div class="card-b">
      <p>All data is kept in this browser only (localStorage, or IndexedDB when it is large, and IndexedDB for uploaded files): ${S.apps.length} applications, ${S.outbox.length} messages, ${S.audit.length} audit entries.</p>
      <div class="btn-row"><button id="dd-export">⇩ Export all data (JSON)</button><button class="btn-danger" id="dd-reset">Reset to sample data</button></div>
      <div id="dd-progress" class="muted" style="margin-top:10px"></div>
    </div></div>`;
    U.$('#dd-export').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `forex-data-${U.dayKey(Store.now())}.json`; a.click();
    });
    U.$("#dd-load")?.addEventListener('click', async () => {
      if (!await UI.confirm('Load test data?', '<p>About 660 test applications across all types, branches and stages, and about 40 test users, <b>replace everything in this browser</b>. Other browsers are not affected.</p><p>A <b>full backup is taken automatically first</b> (to the backup destinations – by default a download).</p>', 'Back up & load', 'btn-danger')) return;
      let bk;
      try { bk = await Backups.run('Automatic backup before loading the test data', 'MANUAL'); } catch (e) { bk = { ok: false, error: e.message }; }
      if (!bk.ok && !await UI.confirm('Backup did not complete', `<p>The automatic backup failed: ${U.esc(String(bk.error || 'see the backup log').replace(/\.+$/, ''))}.</p><p>Load anyway, without a backup?</p>`, 'Load without backup', 'btn-danger')) return;
      const out = U.$('#dd-progress');
      U.$$('#adm button').forEach(b => { b.disabled = true; });
      try {
        const r = await this.loadTestData(msg => { out.textContent = msg; });
        UI.toast(`${r.apps} test applications loaded.`, 'ok');
      } catch (e) { UI.error(e); }
      location.hash = '#/dashboard'; App.render();
    });
    U.$('#dd-reset').addEventListener('click', async () => {
      if (!await UI.confirm('Reset demo data?', '<p>This replaces everything in this browser with fresh sample data, including uploaded files and the clock.</p><p>A <b>full backup is taken automatically first</b> (to the backup destinations – by default a download), so the data can be restored under End of day / backups → Backups → Restore if this was a mistake.</p>', 'Back up & reset', 'btn-danger')) return;
      // Automatic backup before the data is replaced, in case the reset was started by mistake.
      let bk;
      try { bk = await Backups.run('Automatic backup before resetting the demo data', 'MANUAL'); } catch (e) { bk = { ok: false, error: e.message }; }
      if (!bk.ok && !await UI.confirm('Backup did not complete', `<p>The automatic backup failed: ${U.esc(String(bk.error || 'see the backup log').replace(/\.+$/, ''))}.</p><p>Reset anyway, without a backup?</p>`, 'Reset without backup', 'btn-danger')) return;
      await Store.reset();
      UI.toast(bk.ok ? 'Backup taken, then the demo data was reset.' : 'Demo data reset (no backup).', 'ok');
      location.hash = '#/dashboard'; App.render();
    });
  },
};
