'use strict';

/* Alerts to the client, written by staff.

   Any user with "Send alerts to clients" (every role by default) can email and/or SMS the client about an application
   ("Send alert to client" on the application and reconciliation pages): to any of the client's phone numbers and
   email addresses (on the application and, after a CBS fetch, the customer's CBS contacts) and to other recipients
   typed in. Starter texts with placeholders are offered. Each alert is recorded in Outgoing messages with the
   application, on the application's comments and in the audit trail, like the system's own notifications. */

ACCESS_FIXED.push(['act.clientAlert', 'Actions', 'Send alerts to clients', 'Email or SMS a client about an application, to one or more recipients.', ALL_ROLES]);

const ALERT_STARTERS = [
  ['General update', 'Update on your application {{ref}}',
    'Dear {{customerName}},\n\nThis is an update on your foreign currency application {{ref}} ({{type}}, {{currency}} {{amount}}), which is currently: {{statusLabel}}.\n\n\n\nFor any queries, please contact {{branchName}} on {{branchPhone}}.\n\nYours faithfully,\n{{bankName}}',
    '{{bankName}}: {{customerName}}, update on application {{ref}}: '],
  ['Documents required', 'Documents required – application {{ref}}',
    'Dear {{customerName}},\n\nTo proceed with application {{ref}} ({{currency}} {{amount}}), we need the following document(s):\n\n- \n\nPlease bring or send them to {{branchName}} as soon as possible.\n\nYours faithfully,\n{{bankName}}',
    '{{bankName}}: {{customerName}}, we need documents to proceed with application {{ref}}. Please contact {{branchName}} on {{branchPhone}}.'],
  ['Fund your account', 'Please fund your account – application {{ref}}',
    'Dear {{customerName}},\n\nPlease make sure account {{account}} has enough funds for application {{ref}} ({{currency}} {{amount}}).\n\nYours faithfully,\n{{bankName}}',
    '{{bankName}}: {{customerName}}, please fund account {{account}} for application {{ref}}. Queries: {{branchPhone}}.'],
  ['Please contact the branch', 'Please contact us about application {{ref}}',
    'Dear {{customerName}},\n\nPlease contact {{branchName}} on {{branchPhone}} or {{branchEmail}} about your application {{ref}}.\n\nYours faithfully,\n{{bankName}}',
    '{{bankName}}: {{customerName}}, please contact {{branchName}} on {{branchPhone}} about application {{ref}}.'],
  ['Reconciliation documents', 'Import documents for advance payment {{ref}}',
    'Dear {{customerName}},\n\nAdvance payment {{ref}} ({{currency}} {{amount}}) must be reconciled by {{reconDate}}. Please bring the customs entry / bill of entry and the final invoice to {{branchName}}.\n\nYours faithfully,\n{{bankName}}',
    '{{bankName}}: {{customerName}}, please bring the import documents for advance payment {{ref}} to {{branchName}} by {{reconDate}}.'],
];

const Alerts = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  PHONE: /^\+?[\d\s()-]{7,}$/,

  can(app, user = Store.user()) { return !!app?.ref && Access.has(user, 'act.clientAlert') && Engine.can('view', app, user); },

  /* Everyone the alert can go to: the application's contacts, then the customer's CBS contacts. */
  contacts(app) {
    const c = app.customer || {}, out = [], seen = new Set();
    const add = (kind, value, label, onApp) => {
      const v = String(value || '').trim(), key = kind === 'email' ? v.toLowerCase() : v.replace(/\D/g, '');
      if (!v || seen.has(key)) return;
      seen.add(key);
      out.push({ kind, value: kind === 'email' ? v.toLowerCase() : v, label, onApp });
    };
    add('phone', c.phone, 'Main contact number', true);
    add('email', c.email, 'Main email', true);
    (c.contacts || []).forEach(k => add(k.kind, k.value, k.name || 'Additional contact', true));
    const cust = Engine.customerNo(c) ? Customers.customer(Engine.customerNo(c)) : null;
    (cust?.phones || []).forEach(p => add('phone', p.number, `CBS: ${p.name || 'phone'}`, false));
    (cust?.emails || []).forEach(m => add('email', m.address, `CBS: ${m.name || 'email'}`, false));
    (c.cbs?.phones || []).forEach(p => add('phone', p, 'CBS record', false));
    (c.cbs?.emails || []).forEach(m => add('email', m, 'CBS record', false));
    return out;
  },

  /* Other recipients typed in: emails and phone numbers separated by commas, semicolons or new lines. */
  parseOthers(text) {
    const emails = [], phones = [], bad = [];
    String(text || '').split(/[,;\n]+/).map(x => x.trim()).filter(Boolean).forEach(x => {
      if (this.EMAIL.test(x)) emails.push(x.toLowerCase());
      else if (this.PHONE.test(x)) phones.push(x);
      else bad.push(x);
    });
    return { emails, phones, bad };
  },

  send(app, { emails, phones, subject, body, sms }) {
    if (!this.can(app)) throw new WorkflowError('You cannot send alerts about this application.');
    emails = [...new Set(emails)]; phones = [...new Set(phones)];
    if (!emails.length && !phones.length) throw new WorkflowError('Choose at least one recipient.');
    if (emails.length && !(subject?.trim() && body?.trim())) throw new WorkflowError('Write the email subject and message.');
    if (phones.length && !sms?.trim()) throw new WorkflowError('Write the SMS text.');
    const S = Store.state, u = Store.user(), vars = Engine.vars(app), c = app.customer || {}, at = Engine.nowISO();
    const subj = Engine.render(subject || '', vars).trim();
    const base = { at, code: 'CLIENT_ALERT', template: `Alert to client – written by ${u.name}`, appId: app.id, ref: app.ref, audience: 'Client', userIds: [], readBy: [], sentBy: u.id };
    if (emails.length) {
      const footer = Engine.render(S.bank.noReplyFooter, vars).trim(), text = Engine.render(body, vars).trim();
      S.outbox.push(Object.assign({ id: U.uid('msg'), channel: 'Email', to: emails.join('; '), toLabel: `${c.name}${emails.length > 1 ? ` – ${emails.length} addresses` : ''}`,
        from: `${S.bank.senderName} <${S.bank.noReplyEmail}>`, subject: subj, body: footer ? `${text}\n\n${footer}` : text }, base));
    }
    if (phones.length) {
      const text = Engine.render(sms, vars).replace(/[ \t]+/g, ' ').trim();
      S.outbox.push(Object.assign({ id: U.uid('msg'), channel: 'SMS', to: phones.join('; '), toLabel: `${c.name}${phones.length > 1 ? ` – ${phones.length} numbers` : ''}`,
        subject: subj || 'SMS alert', body: text, smsParts: Messaging.segments(text).parts }, base));
    }
    const how = [emails.length && `email to ${emails.length} address(es)`, phones.length && `SMS to ${phones.length} number(s)`].filter(Boolean).join(' and ');
    Engine.addComment(app, 'Alert sent to client', `${subj || 'SMS'} – ${how}`);
    Engine.touch(app);
    Store.audit('CLIENT_ALERT_SENT', app, `Alert sent to the client by ${how}: ${subj || 'SMS'} (${[...emails, ...phones].join(', ')})`);
    Store.save();
    return how;
  },

  modal(app) {
    if (!this.can(app)) { UI.toast('You cannot send alerts about this application.', 'error'); return; }
    const list = this.contacts(app), e = U.esc, vars = Engine.vars(app);
    const [, s0, b0, m0] = ALERT_STARTERS[0];
    UI.modal({
      title: `Alert client – ${app.ref}`, wide: true,
      body: `<p style="margin-top:0">${e(app.customer?.name || 'Client')} · account <span class="mono">${e(app.customer?.account || '')}</span></p>
        <div class="grid g2" style="align-items:start">
          <div>
            <h3 style="margin:0 0 6px">Recipients</h3>
            <div class="checks" style="display:flex;flex-direction:column;gap:4px">${list.map((k, i) => `<label class="btn-row" style="gap:6px"><input type="checkbox" data-rc="${i}" ${k.onApp ? 'checked' : ''}> ${k.kind === 'email' ? '✉' : '☎'} <span class="mono">${e(k.value)}</span> <small class="muted">${e(k.label)}</small></label>`).join('') || '<div class="muted">No contacts on the application.</div>'}</div>
            <label class="f" style="margin-top:10px"><span>Other recipients (optional)</span><textarea id="al-others" rows="3" placeholder="Email addresses or phone numbers, separated by commas or new lines"></textarea></label>
            <label class="f"><span>Send by</span><select id="al-channel"><option value="BOTH">Email and SMS (each recipient by their kind)</option><option value="EMAIL">Email only</option><option value="SMS">SMS only</option></select></label>
            <label class="f"><span>Starting text</span><select id="al-starter">${ALERT_STARTERS.map(([l], i) => `<option value="${i}">${e(l)}</option>`).join('')}</select><div class="hint">Placeholders such as {{ref}} and {{customerName}} are filled in when sent.</div></label>
          </div>
          <div>
            <label class="f"><span>Email subject</span><input id="al-subject" value="${e(s0)}"></label>
            <label class="f"><span>Email message</span><textarea id="al-body" rows="9">${e(b0)}</textarea></label>
            <label class="f"><span>SMS text</span><textarea id="al-sms" rows="3">${e(m0)}</textarea><div class="hint" id="al-sms-count"></div></label>
          </div>
        </div>`,
      onOpen: el => {
        const count = () => { el.querySelector('#al-sms-count').textContent = Messaging.segmentLabel(Engine.render(el.querySelector('#al-sms').value, vars)); };
        el.querySelector('#al-sms').addEventListener('input', count);
        el.querySelector('#al-starter').addEventListener('change', ev => {
          const [, s, b, m] = ALERT_STARTERS[Number(ev.target.value)];
          el.querySelector('#al-subject').value = s; el.querySelector('#al-body').value = b; el.querySelector('#al-sms').value = m; count();
        });
        count();
      },
      actions: [{ label: 'Send alert', onClick: el => {
        const channel = el.querySelector('#al-channel').value, others = this.parseOthers(el.querySelector('#al-others').value);
        if (others.bad.length) { UI.toast(`Not an email address or phone number: ${others.bad.join(', ')}`, 'error'); return false; }
        const chosen = [...el.querySelectorAll('[data-rc]')].filter(x => x.checked).map(x => list[Number(x.dataset.rc)]);
        const emails = channel === 'SMS' ? [] : [...chosen.filter(k => k.kind === 'email').map(k => k.value), ...others.emails];
        const phones = channel === 'EMAIL' ? [] : [...chosen.filter(k => k.kind === 'phone').map(k => k.value), ...others.phones];
        const how = this.send(app, { emails, phones, subject: el.querySelector('#al-subject').value, body: el.querySelector('#al-body').value, sms: el.querySelector('#al-sms').value });
        UI.toast(`Alert sent: ${how}. It is in Outgoing messages.`, 'ok');
        App.render();
      } }],
    });
  },
};

(() => {
  const baseButtons = Views.actionButtons.bind(Views);
  Views.actionButtons = function (app) {
    const html = baseButtons(app);
    return Alerts.can(app) ? `${html}<button type="button" data-client-alert="${app.id}" style="width:100%;justify-content:center;margin-top:8px">✉ Send alert to client</button>` : html;
  };
  const baseRecon = Recon.detail.bind(Recon);
  Recon.detail = function (id) {
    baseRecon(id);
    const app = Store.app(id), box = document.querySelector('#view .side .card .card-b');
    if (box && Alerts.can(app)) box.insertAdjacentHTML('beforeend', `<button type="button" data-client-alert="${app.id}" style="width:100%;justify-content:center;margin-top:10px">✉ Send alert to client</button>`);
  };
  document.addEventListener('click', ev => {
    const b = ev.target.closest('[data-client-alert]');
    if (b) Alerts.modal(Store.app(b.dataset.clientAlert));
  });
  const baseLabel = Views.actionLabel.bind(Views);
  Views.actionLabel = x => (x === 'CLIENT_ALERT_SENT' ? 'Alert sent to client' : baseLabel(x));
})();
