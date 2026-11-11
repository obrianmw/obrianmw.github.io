'use strict';

/* Sign-in, password policy, first-login change, lockout, forgotten-password links and idle timeout.
   Prototype: hashing runs in the browser (PBKDF2-SHA256). In production this all moves server-side
   (e.g. Spring Security with the bank's directory) and reset emails go through the mail server. */
const AUTH_ACTOR = { id: 'system', name: 'System (sign-in)', role: 'SYSTEM' };

const Auth = {
  ITERATIONS: 100000,
  lastActivity: Date.now(),

  settings() { return Store.state.settings; },

  randomHex(bytes) {
    const a = new Uint8Array(bytes);
    crypto.getRandomValues(a);
    return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
  },

  async hash(password, salt) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: this.ITERATIONS }, key, 256);
    return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
  },

  COMMON_PASSWORDS: ['password', 'passwort', 'welcome', 'qwerty', 'letmein', 'admin', 'administrator', 'changeme', 'iloveyou', 'monkey', 'dragon', 'football', 'secret', 'login', 'abc', 'abcd', 'abcdef', 'master', 'summer', 'winter', 'spring', 'autumn', 'bank', 'forex', 'demobank', 'uganda'],
  minLength() { return Math.max(12, this.settings().passwordMinLength || 12); },
  maxFailed() { return Math.max(1, Math.min(3, this.settings().maxFailedLogins || 3)); },
  /* "P@ssw0rd123!" reads as "password". */
  isCommon(pw) {
    const plain = pw.replace(/[^A-Za-z]+$/, '').toLowerCase().replace(/[@4]/g, 'a').replace(/3/g, 'e').replace(/0/g, 'o').replace(/1/g, 'l').replace(/\$/g, 's').replace(/7/g, 't');
    return this.COMMON_PASSWORDS.includes(plain.replace(/^[^a-z]+/, ''));
  },

  /* Returns a list of unmet rules (empty when the password is acceptable). */
  policyChecks(pw, user) {
    const min = this.minLength();
    return [
      [pw.length >= min, `At least ${min} characters`],
      [/[A-Z]/.test(pw), 'An uppercase letter'],
      [/[a-z]/.test(pw), 'A lowercase letter'],
      [/\d/.test(pw), 'A number'],
      [/[^A-Za-z0-9]/.test(pw), 'A symbol (e.g. ! @ # $)'],
      [!user || !pw.toLowerCase().includes(String(user.username || '').toLowerCase().split('@')[0]), 'Does not contain your username'],
      [!this.isCommon(pw), 'Not based on a common word'],
    ];
  },
  policyErrors(pw, user) { return this.policyChecks(pw, user).filter(([ok]) => !ok).map(([, label]) => label); },

  async setPassword(user, password, { temporary }) {
    user.salt = this.randomHex(16);
    user.passwordHash = await this.hash(password, user.salt);
    user.mustChangePassword = !!temporary;
    user.passwordChangedAt = Store.now().toISOString();
    user.failedAttempts = 0;
    user.locked = false;
    delete user.pendingPassword;
  },

  /* Hash any seeded demo passwords and sign everyone out the first time sign-in is introduced. */
  async init() {
    const S = Store.state;
    for (const u of S.users) {
      if (!u.username) u.username = u.email;
      if (!u.passwordHash) await this.setPassword(u, u.pendingPassword || DEMO_PASSWORD, { temporary: false });
    }
    if (!S.authVersion) { S.authVersion = 1; S.currentUserId = null; }
    S.resetTokens = S.resetTokens || [];
    Store.save();
  },

  /* Failed sign-ins from this browser: more than 5 in 15 minutes blocks it for 15 minutes and locks the account tried. */
  MACHINE_KEY: 'forex-signin-failures',
  machineRecord() {
    let r = null;
    try { r = JSON.parse(localStorage.getItem(this.MACHINE_KEY)); } catch (e) { /* no storage */ }
    return r && Date.now() - r.first <= 900000 ? r : { fails: 0, first: Date.now(), until: r ? r.until : 0 };
  },
  machineBlockedMs() { return Math.max(0, this.machineRecord().until - Date.now()); },
  machineFailure(user) {
    const r = this.machineRecord();
    r.fails += 1;
    if (r.fails > 5) {
      r.until = Date.now() + 900000;
      Store.audit('LOGIN_SOURCE_BLOCKED', null, 'Sign-in refused from this computer for 15 minutes: more than 5 failed attempts', null, AUTH_ACTOR);
      if (user && !user.locked) {
        this.lock(user);
        Store.audit('ACCOUNT_LOCKED', null, 'Locked: more than 5 failed sign-in attempts from this computer', null, user);
      }
    }
    try { localStorage.setItem(this.MACHINE_KEY, JSON.stringify(r)); } catch (e) { /* no storage */ }
  },

  findUser(login) {
    const key = String(login || '').trim().toLowerCase();
    if (!key) return null;
    return Store.state.users.find(u => String(u.username || '').toLowerCase() === key || String(u.email || '').toLowerCase() === key) || null;
  },

  async signIn(login, password) {
    // A prototype: all of this runs in the browser and can be bypassed. The Live and Universal servers enforce it for real.
    const generic = 'Incorrect username or password, or the account is locked. An account locks after 3 failed attempts: ask your administrator to unlock it.';
    const wait = this.machineBlockedMs();
    if (wait > 0) return { ok: false, error: `Too many failed sign-in attempts from this computer. Try again in ${Math.floor(wait / 60000) + 1} minute(s), or ask the administrator.` };
    if (typeof Approvals !== 'undefined') Approvals.sweepInactive();   // users not used for 30 days are disabled
    const u = this.findUser(login);
    // Disabled for not signing in: told why, but only with the right password.
    if (u && u.active === false && u.disabledReason === 'INACTIVE' && await this.hash(password, u.salt) === u.passwordHash) {
      return { ok: false, error: `Your account was disabled because it was not used for ${Approvals.INACTIVE_DAYS} days. Ask an administrator to activate it.` };
    }
    if (!u || u.active === false || u.pendingApproval === true) {   // awaiting another administrator's approval
      await this.hash(password, 'no-such-account');
      Store.audit('LOGIN_FAILED', null, `Failed sign-in for "${String(login).slice(0, 60)}"`, null, AUTH_ACTOR);
      this.machineFailure(null);
      Store.save();
      return { ok: false, error: generic };
    }
    if (u.locked) {
      await this.hash(password, u.salt);
      Store.audit('LOGIN_FAILED', null, 'Sign-in attempt on a locked account', null, u);
      this.machineFailure(u);
      Store.save();
      return { ok: false, error: generic };
    }
    if (await this.hash(password, u.salt) !== u.passwordHash) {
      u.failedAttempts = (u.failedAttempts || 0) + 1;
      const max = this.maxFailed();
      if (u.failedAttempts >= max) {
        this.lock(u);
        Store.audit('ACCOUNT_LOCKED', null, `Locked after ${max} failed sign-in attempts`, null, u);
      } else {
        Store.audit('LOGIN_FAILED', null, `Wrong password (${u.failedAttempts} of ${max})`, null, u);
      }
      this.machineFailure(u);
      Store.save();
      await new Promise(done => setTimeout(done, Math.min(2000, 250 * this.machineRecord().fails)));
      return { ok: false, error: generic };
    }
    u.failedAttempts = 0;
    u.lastLoginAt = Store.now().toISOString();
    Store.state.currentUserId = u.id;
    this.lastActivity = Date.now();
    Store.audit('LOGIN', null, u.mustChangePassword ? 'Signed in with a temporary password' : 'Signed in', null, u);
    Store.save();
    return { ok: true, user: u };
  },

  signOut(reason = '') {
    const u = Store.user();
    if (u) Store.audit('LOGOUT', null, reason === 'timeout' ? `Signed out after ${this.settings().sessionTimeoutMinutes} minutes of inactivity` : 'Signed out', null, u);
    Store.state.currentUserId = null;
    Store.save();
    location.hash = '#/login';
    App.render();
    if (reason === 'timeout') AuthViews.notice = 'You were signed out after a period of inactivity.';
  },

  async changePassword(user, current, next) {
    if (await this.hash(current, user.salt) !== user.passwordHash) {
      user.failedAttempts = (user.failedAttempts || 0) + 1;
      if (user.failedAttempts >= this.maxFailed()) {
        this.lock(user);
        Store.audit('ACCOUNT_LOCKED', null, `Locked after ${this.maxFailed()} wrong current passwords when changing password`, null, user);
        Store.save();
        this.signOut();
      } else Store.save();
      throw new WorkflowError('Your current password is not correct.');
    }
    user.failedAttempts = 0;
    if (current === next) throw new WorkflowError('The new password must be different from the current one.');
    const errs = this.policyErrors(next, user);
    if (errs.length) throw new WorkflowError(`Password needs: ${errs.join(', ').toLowerCase()}.`);
    await this.setPassword(user, next, { temporary: false });
    Store.audit('PASSWORD_CHANGED', null, 'Password changed by the user', null, user);
    this.mail(user, 'PASSWORD_CHANGED', {});
    Store.save();
  },

  /* Admin sets a temporary password; the user must change it at next sign-in. */
  /* A link asked for earlier must not get round a lock. */
  lock(user) {
    user.locked = true;
    Store.state.resetTokens = (Store.state.resetTokens || []).filter(t => t.userId !== user.id);
  },

  /* An administrator's password is always reset by another administrator, never by themselves. */
  assertNotSelf(user) { if (Store.user() && user && user.id === Store.user().id) throw new WorkflowError('Your own password must be reset by another administrator. To change it, use Change password.'); },

  async adminSetTemporary(user, password) {
    this.assertNotSelf(user);
    const errs = this.policyErrors(password, user);
    if (errs.length) throw new WorkflowError(`Temporary password needs: ${errs.join(', ').toLowerCase()}.`);
    await this.setPassword(user, password, { temporary: true });
    Store.audit('PASSWORD_SET_BY_ADMIN', null, `Temporary password set for ${user.name} (must change at next sign-in)`);
    Store.save();
  },

  unlock(user) {
    if (Store.user() && user && user.id === Store.user().id) throw new WorkflowError('Your own account must be unlocked by another administrator.');
    user.locked = false;
    user.failedAttempts = 0;
    Store.audit('ACCOUNT_UNLOCKED', null, `${user.name} unlocked`);
    Store.save();
  },

  /* Forgotten password: emails a single-use link. Always answers the same way so it does not reveal which accounts exist. */
  requestReset(login, actor = null) {
    const u = this.findUser(login);
    // Administrators cannot reset a forgotten password themselves: another administrator must do it.
    if (u && u.role === 'ADMIN' && u.active !== false && !actor) {
      Store.audit('PASSWORD_RESET_REFUSED', null, 'Forgotten-password request for an administrator account refused – another administrator must reset it', null, u);
      Store.save();
      return null;
    }
    // A locked account is unlocked or reset only by an administrator.
    if (u && u.locked && u.active !== false && !actor) {
      Store.audit('PASSWORD_RESET_REFUSED', null, 'Forgotten-password request for a locked account refused – an administrator must unlock or reset it', null, u);
      Store.save();
      return null;
    }
    if (actor) this.assertNotSelf(u);
    if (!u || u.active === false || !u.email) {
      Store.audit('PASSWORD_RESET_REQUESTED', null, `Reset requested for unknown or inactive account "${String(login).slice(0, 60)}"`, null, AUTH_ACTOR);
      Store.save();
      return null;
    }
    const S = Store.state;
    S.resetTokens = S.resetTokens.filter(t => t.userId !== u.id);   // a new link cancels any older one
    const token = this.randomHex(24);
    const minutes = this.settings().passwordResetMinutes;
    S.resetTokens.push({ token, userId: u.id, createdAt: Store.now().toISOString(), expiresAt: new Date(Store.now().getTime() + minutes * 60000).toISOString(), used: false });
    const link = `${location.origin}${location.pathname}#/reset/${token}`;
    const msg = this.mail(u, 'PASSWORD_RESET', { resetLink: link, expiryMinutes: minutes });
    Store.audit('PASSWORD_RESET_REQUESTED', null, actor ? `Reset link sent to ${u.email} by ${actor.name}` : `Reset link sent to ${u.email}`, null, actor || u);
    Store.save();
    return msg;
  },

  tokenRecord(token) {
    const t = (Store.state.resetTokens || []).find(x => x.token === token);
    if (!t) return { error: 'This reset link is not valid. Request a new one.' };
    if (t.used) return { error: 'This reset link has already been used. Request a new one if you still need it.' };
    if (new Date(t.expiresAt) <= Store.now()) return { error: 'This reset link has expired. Request a new one.' };
    return { t, user: Store.userById(t.userId) };
  },

  async resetWithToken(token, password) {
    const { t, user, error } = this.tokenRecord(token);
    if (error) throw new WorkflowError(error);
    const errs = this.policyErrors(password, user);
    if (errs.length) throw new WorkflowError(`Password needs: ${errs.join(', ').toLowerCase()}.`);
    await this.setPassword(user, password, { temporary: false });   // also unlocks the account
    t.used = true;
    Store.audit('PASSWORD_RESET', null, 'Password reset with an emailed link', null, user);
    this.mail(user, 'PASSWORD_CHANGED', {});
    Store.save();
  },

  /* System emails to staff, sent from the no-reply address. */
  mail(user, code, extra) {
    const S = Store.state, tpl = S.templates[code];
    if (!tpl || tpl.enabled === false) return null;
    const vars = Object.assign({ userName: user.name, username: user.username, bankName: S.bank.name, bankPhone: S.bank.phone, bankEmail: S.bank.email, changedAt: U.fmtDateTime(Store.now()) }, extra);
    const msg = {
      id: U.uid('msg'), at: Store.now().toISOString(), code, template: tpl.name, appId: null, ref: null,
      subject: Engine.render(tpl.subject, vars), body: Engine.render(tpl.body, vars),
      audience: 'Staff', channel: 'Email', to: user.email, toLabel: user.name, from: `${S.bank.senderName} <${S.bank.noReplyEmail}>`,
      userIds: [], readBy: [],
    };
    S.outbox.push(msg);
    return msg;
  },

  /* Sign out after a period of inactivity (real time). */
  startIdleTimer() {
    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(ev => window.addEventListener(ev, () => { this.lastActivity = Date.now(); }, { passive: true }));
    setInterval(() => {
      if (Store.user() && Date.now() - this.lastActivity > this.settings().sessionTimeoutMinutes * 60000) this.signOut('timeout');
    }, 30000);
  },
};

/* Signed-out screens: sign in, forgotten password, reset link, forced password change. */
const AuthViews = {
  notice: '',

  shell(inner) {
    document.body.classList.add('signed-out');
    const el = document.getElementById('auth');
    el.innerHTML = `<div class="auth-card"><div class="auth-brand"><img data-brand-logo src="${U.esc(Brand.current.logo)}" alt="${U.esc(Brand.current.bankName)}"></div>
      <div class="auth-body">${inner}</div></div>
      <div class="auth-foot"><span class="af-text">${U.esc(Brand.current.productName)} · ${U.esc(Brand.current.bankName)} · Prototype</span>${Brand.toggleButton()}</div>`;
    document.title = `Sign in · ${Brand.current.productName}`;
    return el;
  },

  policyList(pw, user) {
    return `<ul class="checklist" style="margin-top:6px">${Auth.policyChecks(pw, user).map(([ok, label]) => `<li><span class="ico ${ok ? 'ok' : 'opt'}">${ok ? '✓' : '–'}</span><span>${U.esc(label)}</span></li>`).join('')}</ul>`;
  },

  bindPolicy(el, user) {
    const input = el.querySelector('[name=next]');
    const out = el.querySelector('#pw-policy');
    const upd = () => { out.innerHTML = this.policyList(input.value, user); };
    input.addEventListener('input', upd);
    upd();
  },

  login() {
    const notice = this.notice; this.notice = '';
    const demo = Store.state.users.filter(u => u.active !== false);
    const el = this.shell(`
      <h1>Sign in</h1><p class="muted" style="margin-top:4px">${U.esc(Brand.current.productName)}</p>
      ${notice ? `<div class="alert ok" style="margin:12px 0">${U.esc(notice)}</div>` : ''}
      <div class="alert error hidden" id="lg-err" style="margin:12px 0"></div>
      <form id="lg-form" autocomplete="on">
        <label class="f"><span>Username or email</span><input name="login" autocomplete="username" required></label>
        <label class="f" style="margin-top:10px"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn-primary" type="submit" style="width:100%;justify-content:center;margin-top:16px">Sign in</button>
      </form>
      <div style="text-align:center;margin-top:12px"><a href="#/forgot">Forgot password?</a></div>
      <details class="demo-box"><summary>Prototype demo accounts</summary>
        <p class="muted" style="margin:6px 0">All demo users share the demo password <b class="mono">${U.esc(DEMO_PASSWORD)}</b> (also in the README). Users created by the admin get a temporary password and must change it at first sign-in.</p>
        <table><tbody>${demo.map(u => `<tr class="click" data-login="${U.esc(u.username)}"><td>${U.esc(u.name)}<br><small class="mono">${U.esc(u.username)}</small></td><td><small>${ROLES[u.role]}<br>${U.esc(UI.branchName(u.branchId))}</small></td></tr>`).join('')}</tbody></table>
      </details>`);
    const form = el.querySelector('#lg-form');
    el.querySelectorAll('[data-login]').forEach(tr => tr.addEventListener('click', () => { form.login.value = tr.dataset.login; form.password.focus(); }));
    form.login.focus();
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = form.querySelector('button'); btn.disabled = true;
      const res = await Auth.signIn(form.login.value, form.password.value);
      btn.disabled = false;
      if (!res.ok) {
        const box = el.querySelector('#lg-err'); box.textContent = res.error; box.classList.remove('hidden');
        form.password.value = ''; form.password.focus();
        return;
      }
      location.hash = '#/dashboard';
      App.render();
      UI.toast(`Welcome, ${res.user.name}.`);
    });
  },

  forgot() {
    const el = this.shell(`
      <h1>Forgot password</h1>
      <p class="muted">Enter your username or email. If an active account matches and is not locked, we will email a link to reset your password. The link works once and expires after ${Store.state.settings.passwordResetMinutes} minutes. A locked account, or an administrator's, can only be reset by an administrator: contact yours.</p>
      <form id="fg-form"><label class="f"><span>Username or email</span><input name="login" autocomplete="username" required></label>
        <button class="btn-primary" type="submit" style="width:100%;justify-content:center;margin-top:14px">Send reset link</button></form>
      <div id="fg-done"></div>
      <div style="text-align:center;margin-top:12px"><a href="#/login">← Back to sign in</a></div>`);
    const form = el.querySelector('#fg-form');
    form.login.focus();
    form.addEventListener('submit', e => {
      e.preventDefault();
      const msg = Auth.requestReset(form.login.value);
      form.classList.add('hidden');
      el.querySelector('#fg-done').innerHTML = `<div class="alert ok" style="margin-top:12px"><div>If an account matches <b>${U.esc(form.login.value)}</b> and is not locked, a reset link has been sent to its email address. If you get no email, your account may be locked: contact your administrator.</div></div>
        ${msg ? `<div class="alert info" style="margin-top:8px"><div><b>Prototype:</b> emails are not really sent. <a href="#" id="fg-view">Open the email</a> to use the link.</div></div>` : ''}`;
      el.querySelector('#fg-view')?.addEventListener('click', ev => { ev.preventDefault(); AuthViews.showMail(msg); });
    });
  },

  showMail(m) {
    const link = (m.body.match(/https?:\/\/\S+/) || [])[0];
    UI.modal({
      title: m.subject, wide: true, closeLabel: 'Close',
      body: `<dl class="kv" style="margin-bottom:12px"><dt>From</dt><dd>${U.esc(m.from)}</dd><dt>To</dt><dd>${U.esc(m.toLabel)} &lt;${U.esc(m.to)}&gt;</dd><dt>Sent</dt><dd>${U.fmtDateTime(m.at)}</dd></dl>
        <div class="msg-body">${U.esc(m.body).replace(U.esc(link || '§'), link ? `<a href="${U.esc(link)}" data-close>${U.esc(link)}</a>` : '')}</div>`,
    });
  },

  reset(token) {
    const rec = Auth.tokenRecord(token);
    if (rec.error) {
      this.shell(`<h1>Reset password</h1><div class="alert error" style="margin:12px 0">${U.esc(rec.error)}</div><div style="text-align:center"><a href="#/forgot">Request a new link</a> · <a href="#/login">Sign in</a></div>`);
      return;
    }
    const el = this.shell(`
      <h1>Choose a new password</h1><p class="muted">For <b>${U.esc(rec.user.name)}</b> (${U.esc(rec.user.username)})</p>
      <form id="rs-form">
        <label class="f"><span>New password</span><input name="next" type="password" autocomplete="new-password" required></label>
        <div id="pw-policy"></div>
        <label class="f" style="margin-top:10px"><span>Confirm new password</span><input name="confirm" type="password" autocomplete="new-password" required></label>
        <button class="btn-primary" type="submit" style="width:100%;justify-content:center;margin-top:14px">Set password</button>
      </form>`);
    this.bindPolicy(el, rec.user);
    el.querySelector('#rs-form').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;
      if (f.next.value !== f.confirm.value) { UI.toast('The passwords do not match.', 'error'); return; }
      try {
        await Auth.resetWithToken(token, f.next.value);
        if (Store.state.currentUserId === rec.user.id) Store.state.currentUserId = null;
        Store.save();
        this.notice = 'Your password has been reset. Sign in with your new password.';
        location.hash = '#/login';
      } catch (err) { UI.error(err); }
    });
  },

  /* Forced at first sign-in after the admin sets a temporary password. */
  change() {
    const u = Store.user();
    const el = this.shell(`
      <h1>Change your password</h1>
      <div class="alert warn" style="margin:12px 0"><div>You signed in with a temporary password set by the administrator. Choose your own password to continue.</div></div>
      <form id="ch-form">
        <label class="f"><span>Temporary password</span><input name="current" type="password" autocomplete="current-password" required></label>
        <label class="f" style="margin-top:10px"><span>New password</span><input name="next" type="password" autocomplete="new-password" required></label>
        <div id="pw-policy"></div>
        <label class="f" style="margin-top:10px"><span>Confirm new password</span><input name="confirm" type="password" autocomplete="new-password" required></label>
        <button class="btn-primary" type="submit" style="width:100%;justify-content:center;margin-top:14px">Change password & continue</button>
      </form>
      <div style="text-align:center;margin-top:12px"><a href="#" id="ch-out">Sign out</a></div>`);
    this.bindPolicy(el, u);
    el.querySelector('#ch-out').addEventListener('click', e => { e.preventDefault(); Auth.signOut(); });
    el.querySelector('#ch-form').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;
      if (f.next.value !== f.confirm.value) { UI.toast('The passwords do not match.', 'error'); return; }
      try {
        await Auth.changePassword(u, f.current.value, f.next.value);
        location.hash = '#/dashboard';
        App.render();
        UI.toast('Password changed.', 'ok');
      } catch (err) { UI.error(err); }
    });
  },

  /* Voluntary change from the top bar while signed in. */
  changeModal() {
    const u = Store.user();
    UI.modal({
      title: 'Change password',
      body: `<label class="f"><span>Current password</span><input name="current" type="password" autocomplete="current-password"></label>
        <label class="f" style="margin-top:10px"><span>New password</span><input name="next" type="password" autocomplete="new-password"></label><div id="pw-policy"></div>
        <label class="f" style="margin-top:10px"><span>Confirm new password</span><input name="confirm" type="password" autocomplete="new-password"></label>`,
      onOpen: el => this.bindPolicy(el, u),
      actions: [{ label: 'Change password', onClick: async el => {
        const d = UI.formData(el);
        if (d.next !== d.confirm) { UI.toast('The passwords do not match.', 'error'); return false; }
        await Auth.changePassword(u, d.current, d.next);
        UI.toast('Password changed.', 'ok');
      } }],
    });
  },
};
