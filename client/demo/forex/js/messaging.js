'use strict';

/* Email and SMS as separate channels.
   - Emails use the template subject and body inside the branded email layout (Admin → Branding → Email layout).
   - SMS use their own short text per template (Admin → Notification templates → SMS text). SMS go to clients only;
     staff are told by email and in-app. Loaded after every file that adds templates. */

/* Standard SMS wording for each client template. Kept short and in plain characters so most fit one SMS. */
const DEFAULT_SMS = {
  REJECTED_CLIENT: '{{bankName}}: {{customerName}}, your forex application {{ref}} for {{currency}} {{amount}} cannot proceed. Please contact {{branchName}} on {{branchPhone}}.',
  AUTHORISED_CLIENT: '{{bankName}}: {{customerName}}, we received application {{ref}} for {{currency}} {{amount}}. It now awaits forex allocation, which is not guaranteed. We will update you.',
  ALLOCATED_CLIENT: '{{bankName}}: {{currency}} {{allocatedAmount}} allocated on {{ref}} for {{customerName}}. Fund account {{account}} with MWK {{totalToFund}} by {{deadline}} or the allocation is forfeited.',
  FUNDS_SUFFICIENT_CLIENT: '{{bankName}}: {{currency}} {{allocatedAmount}} allocated on {{ref}} for {{customerName}}. MWK {{totalToFund}} will be debited from {{account}}. Payment will follow shortly.',
  FORFEITED_CLIENT: '{{bankName}}: {{customerName}}, account {{account}} was not funded by the cut-off, so the allocation on {{ref}} was forfeited. The application stays in the queue.',
  PROCESSED_CLIENT: '{{bankName}}: {{customerName}}, {{currency}} {{paidAmount}} on {{ref}} has been sent to {{beneficiaryName}}. {{processingStatus}}',
  RECON_REMINDER_CLIENT: '{{bankName}}: {{customerName}}, advance payment {{ref}} must be reconciled by {{reconDate}}. Please bring the import documents to {{branchName}}.',
  RECON_OVERDUE_CLIENT: '{{bankName}}: {{customerName}}, reconciliation of advance payment {{ref}} was due {{reconDate}} and is overdue. Please bring the import documents to {{branchName}}.',
  RECONCILED_CLIENT: '{{bankName}}: {{customerName}}, advance payment {{ref}} has been reconciled. No further documents are needed. Thank you.',
  RECON_RECEIVED_CLIENT: '{{bankName}}: {{customerName}}, we received the import documents for advance payment {{ref}}. We will confirm once it is reconciled.',
  RECON_DECLINED_CLIENT: '{{bankName}}: {{customerName}}, the documents for advance payment {{ref}} could not be accepted. Please contact {{branchName}} on {{branchPhone}}.',
  TRAVEL_NOT_ALLOCATED_CLIENT: '{{bankName}}: {{customerName}}, application {{ref}} for travel on {{travelDate}} has NOT been allocated forex yet. Do not rely on it unless we advise you.',
  TRAVEL_APOLOGY_CLIENT: '{{bankName}}: {{customerName}}, we are sorry we could not allocate forex for your travel on {{travelDate}} ({{ref}}). The application is closed.',
  CLIENT_CLOSED_CLIENT: '{{bankName}}: {{customerName}}, as requested, application {{ref}} ({{currency}} {{amount}}) has been closed.',
  PAYMENT_REVERSED_CLIENT: '{{bankName}}: {{customerName}}, the payment on {{ref}} to {{beneficiaryName}} was reversed. Please contact {{branchName}} on {{branchPhone}} with your instructions.',
  BENEFICIARY_CHANGED_CLIENT: '{{bankName}}: {{customerName}}, payment on {{ref}} will now go to {{newBeneficiary}} as you instructed.',
};
Object.entries(DEFAULT_SMS).forEach(([code, sms]) => { if (DEFAULT_TEMPLATES[code]) DEFAULT_TEMPLATES[code].sms = sms; });

const Messaging = {
  /* The SMS wording for a template: the saved SMS text, else the standard one, else a short form of the email. */
  smsTemplate(code, tpl = Store.state.templates[code]) {
    if (tpl && typeof tpl.sms === 'string' && tpl.sms.trim()) return tpl.sms;
    if (DEFAULT_SMS[code]) return DEFAULT_SMS[code];
    return '{{bankName}}: ' + String(tpl?.subject || '') + '. Ref {{ref}}.';
  },

  /* GSM-7 is the plain SMS alphabet; any other character (e.g. – ’ “) makes the message Unicode, which halves its length. */
  GSM: /^[A-Za-z0-9 \n\r@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/,
  segments(text) {
    const s = String(text || ''), gsm = this.GSM.test(s), n = [...s].length;
    const one = gsm ? 160 : 70, many = gsm ? 153 : 67;
    return { chars: n, gsm, parts: n <= one ? 1 : Math.ceil(n / many), perPart: n <= one ? one : many };
  },
  segmentLabel(text) {
    const g = this.segments(text);
    return `${g.chars} characters · ${g.parts} SMS${g.gsm ? '' : ' · contains special characters, sent as Unicode (70 per SMS)'}`;
  },

  /* Branded email preview in a sandboxed frame: no scripts run inside it; same-origin only so the logo can load. */
  emailFrame(m, height = 520) {
    return `<iframe class="email-frame" style="height:${height}px" sandbox="allow-same-origin allow-popups" title="Email preview" srcdoc="${U.esc(Brand.emailHtml(m).replace('<head>', '<head><base target="_blank">'))}"></iframe>`;
  },
  smsBubble(text, to = '') {
    return `<div class="sms-phone">${to ? `<div class="sms-meta" style="margin:0 0 6px">To ${U.esc(to)}</div>` : ''}<div class="sms-bubble">${U.esc(text)}</div><div class="sms-meta">${U.esc(this.segmentLabel(text))}</div></div>`;
  },

  /* The footer a client email carries (the no-reply notice from Admin → Bank & branches). */
  clientFooter(m) {
    const S = Store.state;
    const app = m.appId ? S.apps.find(a => a.id === m.appId) : null;
    return app ? Engine.render(S.bank.noReplyFooter, Engine.vars(app)).trim() : '';
  },
};

/* SMS get their own wording. Engine.notify writes the email and SMS together; the SMS bodies it has just added
   are re-written here from the template's SMS text. */
(() => {
  const baseNotify = Engine.notify.bind(Engine);
  Engine.notify = function (code, app, recipients, extra = {}, at = null) {
    const S = Store.state, before = S.outbox.length;
    baseNotify(code, app, recipients, extra, at);
    const added = S.outbox.slice(before).filter(m => m.channel === 'SMS');
    if (!added.length) return;
    const text = Engine.render(Messaging.smsTemplate(code), Engine.vars(app, extra)).replace(/[ \t]+/g, ' ').trim();
    added.forEach(m => { m.body = text; m.smsParts = Messaging.segments(text).parts; });
  };

  // Viewing a message: emails in the branded layout (with the plain text a tab away), SMS as the phone shows it.
  Views.showMessage = function (m) {
    if (!m) return;
    const u = Store.user();
    if (m.userIds?.includes(u.id) && !m.readBy.includes(u.id)) { m.readBy.push(u.id); Store.save(); App.renderChrome(); }
    const isEmail = /Email/.test(m.channel), isSms = m.channel === 'SMS';
    const head = `<dl class="kv" style="margin-bottom:12px">${m.from ? `<dt>From</dt><dd>${U.esc(m.from)} ${UI.tag('No-reply', 'grey')}</dd>` : ''}<dt>To</dt><dd>${U.esc(m.toLabel)} &lt;${U.esc(m.to)}&gt;</dd><dt>Channel</dt><dd>${U.esc(m.channel)} · ${U.esc(m.audience)}</dd><dt>Sent</dt><dd>${U.fmtDateTime(m.at)}</dd><dt>Template</dt><dd>${U.esc(m.template)}</dd>${m.ref ? `<dt>Application</dt><dd><a href="#/app/${m.appId}" data-close>${U.esc(m.ref)}</a></dd>` : ''}</dl>`;
    let body;
    if (isSms) body = Messaging.smsBubble(m.body, m.to);
    else if (isEmail) {
      // The no-reply footer is already in a client email's text; show it in the layout's footer instead.
      const footer = m.audience === 'Client' ? Messaging.clientFooter(m) : '';
      const text = footer && m.body.endsWith(footer) ? m.body.slice(0, -footer.length).trim() : m.body;
      body = `<div class="pill-group" style="margin-bottom:10px" id="mv-tabs"><button class="on" data-mv="html">Email as sent</button><button data-mv="text">Plain text</button></div>
        <div id="mv-html">${Messaging.emailFrame({ subject: m.subject, body: text, footer })}</div><div id="mv-text" class="hidden"><div class="msg-body">${U.esc(m.body)}</div></div>`;
    } else body = `<div class="msg-body">${U.esc(m.body)}</div>`;
    UI.modal({
      title: m.subject, wide: true, closeLabel: 'Close', body: head + body,
      onOpen: el => el.querySelectorAll('[data-mv]').forEach(b => b.addEventListener('click', () => {
        el.querySelectorAll('[data-mv]').forEach(x => x.classList.toggle('on', x === b));
        el.querySelector('#mv-html').classList.toggle('hidden', b.dataset.mv !== 'html');
        el.querySelector('#mv-text').classList.toggle('hidden', b.dataset.mv !== 'text');
      })),
    });
  };

  // The password-reset email shown on the sign-in page (demo, no mail server) uses the same layout.
  AuthViews.showMail = function (m) {
    const link = (m.body.match(/https?:\/\/\S+/) || [])[0];
    UI.modal({
      title: m.subject, wide: true, closeLabel: 'Close',
      body: `<dl class="kv" style="margin-bottom:12px"><dt>From</dt><dd>${U.esc(m.from)}</dd><dt>To</dt><dd>${U.esc(m.toLabel)} &lt;${U.esc(m.to)}&gt;</dd><dt>Sent</dt><dd>${U.fmtDateTime(m.at)}</dd></dl>
        ${Messaging.emailFrame({ subject: m.subject, body: m.body }, 440)}
        ${link ? `<p style="margin:10px 0 0"><a class="btn btn-primary" href="${U.esc(link)}" data-close>Open the reset link</a></p>` : ''}`,
    });
  };
})();
