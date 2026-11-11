'use strict';

/* Shell: sidebar navigation, top bar (simulated clock, inbox, user switcher) and hash router. */
const App = {
  routes: [
    [/^#\/dashboard$/, () => Views.dashboard()],
    [/^#\/apps\/(\w+)$/, q => Views.list(q)],
    [/^#\/app\/(\w+)$/, id => Views.detail(id)],
    [/^#\/new$/, () => Form.render()],
    [/^#\/edit\/(\w+)$/, id => Form.render(id)],
    [/^#\/messages(?:\/(\w+))?$/, tab => Views.messages(tab)],
    [/^#\/unreconciled(?:\/(\w+))?$/, mode => Views.unreconciledPage(mode)],
    [/^#\/reports(?:\/(\w+))?$/, name => Reports.render(name)],
    [/^#\/admin(?:\/(\w+))?$/, tab => Admin.render(tab)],
  ],

  async start() {
    await Store.open();
    Store.load();
    Brand.apply(Store.state.branding || null);     // saved branding (Admin → Branding), also on the sign-in page
    await Auth.init();
    Auth.startIdleTimer();
    const n = Engine.runScheduler();
    Store.save();
    if (!location.hash) location.hash = '#/dashboard';
    window.addEventListener('hashchange', () => App.render());
    document.getElementById('view').addEventListener('click', e => {
      const tr = e.target.closest('tr[data-href]');
      if (tr && !e.target.closest('a,button')) location.hash = tr.dataset.href;
    });
    App.render();
    if (n) UI.toast(`${n} scheduled notification(s) generated since last visit.`);
  },

  render() {
    // Idempotent and cheap: catches time-based alerts that become due after an action (e.g. a late allocation).
    if (Engine.runScheduler()) Store.save();
    const hash = location.hash || '#/dashboard';
    // Signed-out screens. A reset link works whether or not someone is signed in on this browser.
    const reset = hash.match(/^#\/reset\/(\w+)$/);
    if (reset) return AuthViews.reset(reset[1]);
    const u = Store.user();
    if (!u) return hash === '#/forgot' ? AuthViews.forgot() : AuthViews.login();
    if (u.mustChangePassword) return AuthViews.change();
    if (['#/login', '#/forgot'].includes(hash)) { location.hash = '#/dashboard'; return; }
    document.body.classList.remove('signed-out');
    App.renderChrome();
    for (const [re, fn] of App.routes) {
      const m = hash.match(re);
      if (m) {
        try { fn(m[1]); } catch (e) { UI.error(e); }
        window.scrollTo(0, 0);
        return;
      }
    }
    location.hash = '#/dashboard';
  },

  /** Sidebar groups the user has collapsed (keys), remembered in this browser. */
  navCollapsed() {
    if (!this.navState) { try { this.navState = JSON.parse(localStorage.getItem('fx-nav-collapsed') || '[]'); } catch (e) { this.navState = []; } }
    return Array.isArray(this.navState) ? this.navState : [];
  },

  renderChrome() {
    const u = Store.user();
    const S = Store.state;
    const hash = location.hash;
    const link = (href, label, count = null, alert = false) =>
      `<a href="${href}" class="${hash === href || (href !== '#/dashboard' && hash.startsWith(href + '/')) ? 'active' : ''}"><span>${label}</span>${count != null ? `<span class="count" style="${alert && count ? 'background:var(--red)' : ''}">${count}</span>` : ''}</a>`;

    const unrec = Engine.unreconciled();
    const overdue = unrec.filter(a => a.recon.dueDate < U.dayKey(Store.now())).length;
    let nav = link('#/dashboard', 'Dashboard') + (Access.has(u, 'view.unreconciled') ? link('#/unreconciled', 'Unreconciled items', unrec.length, overdue > 0) : '');
    if (Access.has(u, 'act.capture')) nav += link('#/new', '+ New application');
    const queues = Queues.forUser(u);
    // Each group can be collapsed from its heading (remembered in this browser). A collapsed group shows the total of
    // its counts (red when any needs attention); its heading is highlighted when the page showing is inside it.
    const group = (key, title, items) => {
      const html = items.map(([href, label, count, alert]) => link(href, label, count, alert)).join('');
      const here = items.some(([href]) => hash === href || hash.startsWith(href + '/'));
      const open = !App.navCollapsed().includes(key);
      const total = items.reduce((t, [, , c]) => t + (c || 0), 0), alert = items.some(([, , c, a]) => a && c);
      return `<button type="button" class="nav-group${here && !open ? ' has-active' : ''}" data-nav-group="${key}" aria-expanded="${open}">
          <span class="ng-chev" aria-hidden="true">▾</span><span class="ng-title">${title}</span>${!open && total ? `<span class="count" style="${alert ? 'background:var(--red)' : ''}">${total}</span>` : ''}</button>
        <div class="nav-items"${open ? '' : ' hidden'}>${html}</div>`;
    };
    if (queues.length) nav += group('queues', 'Work queues', queues.map(q => [`#/apps/${q.id}`, q.label, Queues.list(q.id).length, q.alert]));
    nav += group('comms', 'Communication', [['#/messages/inbox', 'My inbox', Engine.unreadCount(), true]].concat(Access.has(u, 'view.outbox') ? [['#/messages/outbox', 'Outgoing messages']] : []));
    const reports = Reports.allowed(u);
    if (reports.length) nav += group('reports', 'Reports', reports.map(([k, l]) => [`#/reports/${k}`, l]));
    if (u.role === 'ADMIN') nav += group('admin', 'Administration', Admin.tabs.map(([k, l]) => [`#/admin/${k}`, l]));
    const navEl = document.getElementById('nav');
    navEl.innerHTML = nav;
    if (!navEl.dataset.groups) {
      navEl.dataset.groups = '1';
      navEl.addEventListener('click', e => {
        const b = e.target.closest('[data-nav-group]');
        if (!b) return;
        const key = b.dataset.navGroup, list = App.navCollapsed().filter(k => k !== key);
        if (b.getAttribute('aria-expanded') === 'true') list.push(key);
        try { localStorage.setItem('fx-nav-collapsed', JSON.stringify(list)); } catch (err) { /* private window: just not remembered */ }
        App.navState = list;
        App.renderChrome();
      });
    }

    const now = Store.now();
    document.getElementById('clock').innerHTML = `
      <div class="when"><small>System date ${U.isWeekend(now) ? '· weekend' : ''}</small>${U.weekday(now)} ${U.fmtDateTime(now)}</div>
      <button class="btn-sm" data-adv="h" title="Advance 1 hour">+1h</button>
      <button class="btn-sm" data-adv="d" title="Advance 1 day">+1d</button>
      <button class="btn-sm" data-adv="w" title="Advance 7 days">+7d</button>
      <button class="btn-sm" data-adv="x" title="Jump to a date and time">…</button>`;
    document.querySelectorAll('#clock [data-adv]').forEach(b => b.addEventListener('click', () => App.advance(b.dataset.adv)));

    const unread = Engine.unreadCount();
    document.getElementById('bell').innerHTML = `<a class="btn btn-ghost" href="#/messages/inbox" aria-label="Inbox, ${unread} unread">✉${unread ? `<span class="dot">${unread}</span>` : ''}</a>`;

    const box = document.getElementById('user-box');
    // Under the name: the branch the user is working in. Several branches: switch, and a quick way back to the home branch.
    const wb = Engine.workingBranch(u), mine = Engine.assignedBranches(u);
    box.innerHTML = `<div class="who"><b>${U.esc(u.name)}</b><small>${U.esc(ROLES[u.role])} · <span class="wb-name" title="Branch you are working in">${U.esc(UI.branchName(wb))}</span>${mine.length > 1 && wb === u.branchId ? ' (Home)' : ''}</small></div>
      ${mine.length > 1 ? `<select id="ub-branch" class="ub-branch" aria-label="Switch branch" title="Switch branch">${mine.map(b => `<option value="${b}" ${b === wb ? 'selected' : ''}>${U.esc(UI.branchName(b))}${b === u.branchId ? ' (Home)' : ''}</option>`).join('')}</select>
        ${wb !== u.branchId ? `<button class="btn-sm" id="ub-home" title="Back to ${U.esc(UI.branchName(u.branchId))}">⌂ Home Branch</button>` : ''}` : ''}
      <button class="btn-sm" id="ub-pw" title="Change password">Change password</button>
      <button class="btn-sm" id="ub-out">Sign out</button>`;
    const switchTo = id => { Engine.setWorkingBranch(id); UI.toast(`Working in ${UI.branchName(id)}.`, 'ok'); App.render(); };
    box.querySelector('#ub-branch')?.addEventListener('change', ev => switchTo(ev.target.value));
    box.querySelector('#ub-home')?.addEventListener('click', () => switchTo(u.branchId));
    box.querySelector('#ub-pw').addEventListener('click', () => AuthViews.changeModal());
    box.querySelector('#ub-out').addEventListener('click', () => Auth.signOut());

    // Branding (unless Admin → Branding is previewing unsaved changes), the light/dark switch and the page footer.
    if (hash !== '#/admin/branding') Brand.apply(S.branding || null);
    box.insertAdjacentHTML('afterbegin', Brand.toggleButton());
    document.getElementById('app-footer').innerHTML = `<span>© ${new Date().getFullYear()} <b>${U.esc(Brand.current.bankName)}</b> · ${U.esc(Brand.current.productName)}</span>
      <span>${U.esc(Brand.current.tagline)} · Prototype – data stored in this browser only</span>`;
  },

  advance(kind) {
    const now = Store.now();
    const go = (target) => {
      try {
        const n = Engine.setClock(target);
        Store.audit('CLOCK_ADVANCED', null, `Clock moved to ${U.fmtDateTime(target)}`);
        Store.save();
        App.render();
        UI.toast(n ? `Clock moved to ${U.fmtDateTime(target)} – ${n} scheduled notification(s) sent.` : `Clock moved to ${U.fmtDateTime(target)}.`, n ? 'ok' : 'info');
      } catch (e) { UI.error(e); }
    };
    if (kind === 'h') return go(new Date(now.getTime() + 3600000));
    if (kind === 'd') return go(U.addDays(now, 1));
    if (kind === 'w') return go(U.addDays(now, 7));
    const local = `${U.dayKey(now)}T${U.pad(now.getHours())}:${U.pad(now.getMinutes())}`;
    UI.modal({
      title: 'Move the system clock',
      body: `<div class="alert info" style="margin-bottom:12px">Prototype only. Moving the clock forward runs the scheduler for every day in between: 4PM forfeitures, travel notices, reconciliation reminders. In production these run as scheduled jobs on the server.</div>
        <label class="f"><span>New date & time</span><input type="datetime-local" name="to" value="${local}" min="${local}"></label>
        <div class="btn-row" style="margin-top:10px"><button type="button" class="btn-sm" data-q="cutoff">Today just after cut-off (${Store.state.settings.fundingCutoff})</button><button type="button" class="btn-sm" data-q="m">+30 days</button></div>`,
      onOpen: el => el.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => {
        let d;
        if (b.dataset.q === 'm') d = U.addDays(now, 30);
        else { const [h, m] = Store.state.settings.fundingCutoff.split(':').map(Number); d = new Date(now); d.setHours(h, m + 1, 0, 0); if (d < now) d = U.addDays(d, 1); }
        el.querySelector('[name=to]').value = `${U.dayKey(d)}T${U.pad(d.getHours())}:${U.pad(d.getMinutes())}`;
      })),
      actions: [{ label: 'Move clock', onClick: el => { const v = el.querySelector('[name=to]').value; if (!v) return false; go(new Date(v)); } }],
    });
  },
};

document.addEventListener('DOMContentLoaded', () => App.start());
