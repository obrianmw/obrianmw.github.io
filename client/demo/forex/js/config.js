'use strict';

/* Reference data and defaults. Everything an administrator can change at runtime
   (templates, settings, branches, users) is copied into the store on first load. */

const ROLES = {
  INPUTTER: 'Inputter',
  AUTHORISER: 'Authoriser',
  TREASURY: 'Treasury Officer',
  EC: 'Exchange Control',
  ADMIN: 'Administrator',
};

const STATUS = {
  DRAFT:               { label: 'Draft',                         tone: 'grey' },
  PENDING_AUTH:        { label: 'Pending authorisation',         tone: 'blue' },
  RETURNED:            { label: 'Returned to inputter',          tone: 'amber' },
  REJECTED:            { label: 'Rejected – client advised',     tone: 'red' },
  AWAITING_ALLOCATION: { label: 'Awaiting allocation',           tone: 'blue' },
  ALLOCATED:           { label: 'Allocated – awaiting funding',  tone: 'violet' },
  FUNDED:              { label: 'Funded – ready to process',     tone: 'teal' },
  PARTLY_PAID:         { label: 'Partly paid',                   tone: 'amber' },
  CLOSED:              { label: 'Closed – paid',                 tone: 'green' },
  EXPIRED:             { label: 'Closed – not allocated',        tone: 'grey' },
};

// Statuses in which an authorised application is still being worked on.
const ACTIVE_POST_AUTH = ['AWAITING_ALLOCATION', 'ALLOCATED', 'FUNDED', 'PARTLY_PAID'];

const DOC_TYPES = {
  INVOICE:             'Invoice',
  BENEFICIARY_DETAILS: 'Beneficiary details / ID',
  ADMISSION:           'Admission letter',
  FEES:                'Fees structure',
  STUDENT_PASSPORT:    'Student passport',
  VISA:                'Student visa / permit',
  PROOF:               'Proof of the required payment',
  SUPPORTING:          'Supporting document (e.g. rental agreement)',
  PASSPORT:            'Passport / travel document',
  TICKET:              'Ticket (showing travel & return dates)',
  REFERRAL:            'Referral from a medical doctor in Malawi',
  MEDICAL_INVOICE:     'Invoice for medical expenses',
  RECON:               'Reconciliation documents',
  OTHER:               'Other supporting document',
};

const TXN_TYPES = {
  ADVANCE:       { label: 'Advance payment (imports)', category: 'Imports',   reconciliation: true },
  FREIGHT:       { label: 'Freight (imports)',         category: 'Imports' },
  FREIGHT_ONLY:  { label: 'Freight',                   category: 'Imports', reconciliation: false },
  OPEN_ACCOUNT:  { label: 'Open account (imports)',    category: 'Imports' },
  GIFTS:         { label: 'Gifts',                     category: 'Personal', reconciliation: false },
  STUDENT_FEES:  { label: 'Student fees',              category: 'Education', student: true },
  MAINTENANCE:   { label: 'Maintenance fee',           category: 'Education & living', maintenance: true, reconciliation: false },
  CASH:          { label: 'Cash (travel)',             category: 'Travel', travel: true, perDiem: 'strict' },
  CASH_PASSPORT: { label: 'Cash passport (travel)',    category: 'Travel', travel: true, perDiem: 'strict' },
  MEDICAL:       { label: 'Medical procedure (travel)', category: 'Travel', travel: true, perDiem: 'advisory', reconciliation: false },
};

const CURRENCIES = ['USD', 'EUR', 'GBP', 'ZAR', 'CNY', 'INR', 'AED', 'ZMW', 'TZS', 'KES'];
const ACCOUNT_CURRENCIES = ['MWK', ...CURRENCIES];
const ACCOUNT_TYPES = { LCY: 'Local currency account (MWK)', FCY: 'Foreign currency account' };

/* Customer identification documents accepted in Malawi (individuals and businesses). */
const ID_TYPES = {
  'Individuals': [
    ['NATIONAL_ID', 'National ID card (NRB)'],
    ['PASSPORT_MW', 'Malawian passport'],
    ['PASSPORT_FOREIGN', 'Foreign passport'],
    ['DRIVING_LICENCE', 'Driving licence (Malawi)'],
    ['VOTER_ID', 'Voter registration certificate (MEC)'],
    ['RESIDENCE_PERMIT', 'Residence permit'],
    ['TEP', 'Temporary employment permit (TEP)'],
    ['REFUGEE_ID', 'Refugee identity card'],
    ['BIRTH_CERT', 'Birth certificate (minors)'],
  ],
  'Businesses & organisations': [
    ['CERT_INCORPORATION', 'Certificate of incorporation (Registrar General)'],
    ['BUSINESS_REG', 'Business registration certificate (Registrar General)'],
    ['BUSINESS_LICENCE', 'Business licence (city / district council)'],
    ['TPIN', 'Taxpayer identification number – TPIN (MRA)'],
    ['MITC_CERT', 'Investment certificate (MITC)'],
    ['NGO_CERT', 'NGO registration certificate (NGORA)'],
    ['TRUST_CERT', 'Certificate of incorporation of trustees'],
    ['COOP_CERT', 'Cooperative society registration certificate'],
  ],
  'Other': [['OTHER_ID', 'Other (specify in ID number)']],
};
const ID_TYPE_LABELS = Object.fromEntries(Object.values(ID_TYPES).flat());

const COUNTRIES = ['South Africa', 'China', 'India', 'United Kingdom', 'United States', 'United Arab Emirates',
  'Zambia', 'Tanzania', 'Kenya', 'Mozambique', 'Zimbabwe', 'Germany', 'Canada', 'Australia', 'Malaysia',
  'Turkey', 'Egypt', 'Netherlands', 'Ireland'];

/* Branch network. Phone/email are placeholders for the administrator to replace (Admin → Bank & branches). */
const DEFAULT_BRANCHES = [
  ['br_ho',  'Head Office',          'Lilongwe'],
  ['br_kar', 'Karonga',              'Karonga'],
  ['br_mz',  'Mzuzu',                'Mzuzu'],
  ['br_kas', 'Kasungu',              'Kasungu'],
  ['br_mad', 'Madisi Agency',        'Madisi, Dowa'],
  ['br_mpo', 'Mponera',              'Mponela, Dowa'],
  ['br_dza', 'Dzaleka Agency',       'Dzaleka, Dowa'],
  ['br_llw', 'City Centre Lilongwe', 'City Centre, Lilongwe'],
  ['br_gwm', 'Gateway Mall',         'Gateway Mall, Lilongwe'],
  ['br_otl', 'Old Town Lilongwe',    'Old Town, Lilongwe'],
  ['br_mal', 'Malangalanga',         'Malangalanga, Lilongwe'],
  ['br_mch', 'Mchinji',              'Mchinji'],
  ['br_zba', 'Zomba',                'Zomba'],
  ['br_mgc', 'Mangochi',             'Mangochi'],
  ['br_ckw', 'Chikwawa',             'Chikwawa'],
  ['br_lim', 'Limbe',                'Limbe, Blantyre'],
  ['br_chi', 'Chichiri',             'Chichiri, Blantyre'],
  ['br_bt',  'Blantyre Branch',      'Blantyre'],
  ['br_cll', 'CorporateLL',          'Lilongwe'],
  ['br_cbt', 'CorporateBT',          'Blantyre'],
].map(([id, name, address], i) => ({
  id, code: String(i + 1).padStart(3, '0'), name, address,
  phone: `+265 1 000 ${String(i + 1).padStart(3, '0')}`,
  email: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}@demobank.example`,
  manager: id === 'br_ho' ? 'Head of Operations' : 'Branch Manager',
}));
// Names used by earlier versions of the sample data, renamed on load if never edited.
const LEGACY_BRANCH_NAMES = { br_llw: 'Lilongwe Branch', br_mz: 'Mzuzu Branch' };
const LEGACY_BRANCH_CODES = { br_llw: '002', br_bt: '003', br_mz: '004' };

/* Official logo files in assets/brand/ (listed at the bottom of Admin → Branding). */
const BRAND_ASSETS = [
  { file: 'logo.svg', name: 'Logo (SVG)', use: 'App sidebar; scales to any size', size: '1 KB', preview: true },
  { file: 'icon.svg', name: 'Icon (SVG)', use: 'Browser tab icon, avatars', size: '1 KB', preview: true },
];

/* Client emails are sent from an unmonitored no-reply mailbox, never from a branch or staff address.
   The footer is appended to every client email and may use the template placeholders. */
const DEFAULT_EMAIL_SENDER = {
  senderName: 'Demo Bank',
  noReplyEmail: 'no-reply@demobank.example',
  noReplyFooter: '---\nThis is an automated message sent from an unmonitored address. Please do not reply to this email.\nFor assistance, contact {{branchName}} on {{branchPhone}} or {{branchEmail}}.',
};

const RECOMMENDATIONS = ['Recommended', 'Recommended with conditions', 'Not recommended'];

/* Template placeholders available in every message. */
const TEMPLATE_VARS = [
  ['customerName', 'Customer name'], ['account', 'Customer account number'], ['ref', 'Application reference'],
  ['type', 'Transaction type'], ['currency', 'Currency applied'], ['amount', 'Amount applied'],
  ['beneficiaryName', 'Beneficiary name'], ['country', 'Country of remittance'],
  ['branchName', 'Branch name'], ['branchPhone', 'Branch phone'], ['branchEmail', 'Branch email'],
  ['bankName', 'Bank name'], ['bankPhone', 'Bank phone'], ['bankEmail', 'Bank email'],
  ['inputterName', 'Inputter name'], ['comment', 'Comment / reason'],
  ['allocatedAmount', 'Allocated amount'], ['rate', 'Rate'], ['crossRate', 'Cross rate'],
  ['mwkEquivalent', 'MWK equivalent'], ['deadline', 'Funding deadline'],
  ['paidAmount', 'Amount paid'], ['balance', 'Outstanding balance'], ['processingStatus', 'Processing outcome'],
  ['reconDate', 'Reconciliation due date'], ['daysToRecon', 'Days to reconciliation'],
  ['travelDate', 'Travel date'], ['returnDate', 'Return date'], ['daysToTravel', 'Days to travel'],
  ['assigneeName', 'Assigned to'], ['confirmedBy', 'Funding confirmed by'],
  ['statusLabel', 'Current status'], ['appliedDate', 'Date applied'], ['ageDays', 'Days open'],
  ['expiryItem', 'What is expiring'], ['expiryDate', 'Expiry date'], ['timeLeft', 'Time left'], ['actionNeeded', 'Action needed'],
  ['userName', 'Staff member name (password emails)'], ['username', 'Username (password emails)'],
  ['resetLink', 'Password reset link'], ['expiryMinutes', 'Reset link validity (minutes)'], ['changedAt', 'Date & time of change'],
];

const DEFAULT_TEMPLATES = {
  SUBMITTED_INTERNAL: {
    name: 'Submitted for authorisation', audience: 'Staff', trigger: 'Inputter submits an application (to authorisers)',
    subject: '[Forex] {{ref}} submitted for authorisation',
    body: 'Dear Authoriser,\n\n{{inputterName}} ({{branchName}}) has submitted forex application {{ref}} for {{customerName}}: {{type}}, {{currency}} {{amount}}.\n\nPlease review and authorise.\n\nForex Application System',
  },
  RETURNED_INTERNAL: {
    name: 'Returned to inputter', audience: 'Staff', trigger: 'Authoriser sends an application back',
    subject: '[Forex] {{ref}} returned for correction',
    body: 'Dear {{inputterName}},\n\nApplication {{ref}} for {{customerName}} has been returned to you for correction.\n\nAuthoriser comment:\n{{comment}}\n\nPlease update the record and resubmit.\n\nForex Application System',
  },
  REJECTED_CLIENT: {
    name: 'Rejected – advice to client', audience: 'Client', trigger: 'Authoriser rejects and advises the client',
    subject: 'Your foreign currency application {{ref}}',
    body: 'Dear {{customerName}},\n\nThank you for your application for {{currency}} {{amount}} ({{type}}). We are unable to proceed with it at this stage.\n\n{{comment}}\n\nFor assistance please contact {{branchName}} on {{branchPhone}} or {{branchEmail}}.\n\nYours faithfully,\n{{bankName}}',
  },
  REJECTED_INTERNAL: {
    name: 'Rejected – notice to inputter', audience: 'Staff', trigger: 'Authoriser rejects and advises the client',
    subject: '[Forex] {{ref}} rejected – client advised',
    body: 'Dear {{inputterName}},\n\nApplication {{ref}} for {{customerName}} has been rejected and the client has been advised as follows:\n\n{{comment}}\n\nForex Application System',
  },
  AUTHORISED_CLIENT: {
    name: 'Authorised – acknowledgement to client', audience: 'Client', trigger: 'Authoriser authorises an application',
    subject: 'Acknowledgement of your foreign currency application {{ref}}',
    body: 'Dear {{customerName}},\n\nWe acknowledge receipt of your application {{ref}} for {{currency}} {{amount}} ({{type}}).\n\nYour application is now waiting for foreign currency allocation. Please note that allocation depends on availability and is NOT guaranteed. We will contact you as soon as foreign currency has been allocated.\n\nYours faithfully,\n{{bankName}}',
  },
  AUTHORISED_INTERNAL: {
    name: 'Authorised – Treasury & Exchange Control', audience: 'Staff', trigger: 'Authoriser authorises an application',
    subject: '[Forex] {{ref}} authorised – awaiting allocation',
    body: 'Application {{ref}} ({{customerName}}, {{type}}, {{currency}} {{amount}}) from {{branchName}} has been authorised.\n\nTreasury: please consider for allocation.\nExchange Control: please review and give your recommendation.\n\nForex Application System',
  },
  ALLOCATED_CLIENT: {
    name: 'Forex allocated – fund by cut-off', audience: 'Client', trigger: 'Treasury allocates forex',
    subject: 'Foreign currency allocated – please fund your account by {{deadline}}',
    body: 'Dear {{customerName}},\n\nWe are pleased to advise that {{currency}} {{allocatedAmount}} has been allocated to your application {{ref}} at a rate of {{rate}}.\n\nLocal currency required: MWK {{mwkEquivalent}}.\n\nPlease ensure your account {{account}} is funded by {{deadline}}. If the account is not funded by then, the allocation will be forfeited.\n\nYours faithfully,\n{{bankName}}',
  },
  FORFEITED_CLIENT: {
    name: 'Allocation forfeited', audience: 'Client', trigger: 'Account not funded by the cut-off',
    subject: 'Foreign currency allocation forfeited – {{ref}}',
    body: 'Dear {{customerName}},\n\nYour account was not funded by the cut-off time, so the allocation of {{currency}} {{allocatedAmount}} on application {{ref}} has been forfeited.\n\nYour application remains in the queue for allocation, which is not guaranteed. We will contact you if foreign currency becomes available.\n\nYours faithfully,\n{{bankName}}',
  },
  BRANCH_EXPIRY_ALERT: {
    name: 'Branch alert – reaching expiry', audience: 'Staff', trigger: 'Funding deadline within 2 hours; travel date, visa expiry or reconciliation date 7, 3 and 1 days away (to branch)',
    subject: '[Forex] {{ref}} – {{expiryItem}} ({{timeLeft}})',
    body: 'Dear {{branchName}} team,\n\nApplication {{ref}} for {{customerName}} ({{type}}, {{currency}} {{amount}}) is reaching expiry.\n\n{{expiryItem}}: {{expiryDate}} ({{timeLeft}})\nCurrent status: {{statusLabel}}\n\nAction needed: {{actionNeeded}}\n\nForex Application System',
  },
  BRANCH_AGING_ALERT: {
    name: 'Branch alert – open over 30 days', audience: 'Staff', trigger: 'Transaction open for more than 30 days, then weekly until closed (to branch)',
    subject: '[Forex] {{ref}} has been open for {{ageDays}} days',
    body: 'Dear {{branchName}} team,\n\nApplication {{ref}} for {{customerName}} ({{type}}, {{currency}} {{amount}}) was applied for on {{appliedDate}} and has now been open for {{ageDays}} days.\n\nCurrent status: {{statusLabel}}\nOutstanding: {{currency}} {{balance}}\n\nPlease follow up with the client and the relevant department, or close the application if it is no longer required.\n\nForex Application System',
  },
  PASSWORD_RESET: {
    name: 'Password reset link', audience: 'Staff', trigger: 'A user whose account is not locked clicks “Forgot password?”, or the admin sends a reset link',
    subject: 'Reset your Forex Applications password',
    body: 'Dear {{userName}},\n\nWe received a request to reset the password for your Forex Applications account ({{username}}).\n\nTo choose a new password, open this link within {{expiryMinutes}} minutes:\n{{resetLink}}\n\nThe link can only be used once. If you did not ask for this, ignore this email (your password will not change) and inform IT.\n\n{{bankName}}',
  },
  PASSWORD_CHANGED: {
    name: 'Password changed confirmation', audience: 'Staff', trigger: 'A user changes or resets their password',
    subject: 'Your Forex Applications password was changed',
    body: 'Dear {{userName}},\n\nThe password for your Forex Applications account ({{username}}) was changed on {{changedAt}}.\n\nIf you did not make this change, contact IT immediately.\n\n{{bankName}}',
  },
  FUNDED_INTERNAL: {
    name: 'Account funded – ready to process', audience: 'Staff', trigger: 'Anyone marks the client account as funded (to Exchange Control and the assignee)',
    subject: '[Forex] {{ref}} funded – ready to process',
    body: 'Dear Exchange Control,\n\nThe client account {{account}} for application {{ref}} ({{customerName}}, {{type}}, {{currency}} {{amount}}) has been marked as funded by {{confirmedBy}}.\n\n{{comment}}\n\nThe transaction is ready to be processed.\n\nForex Application System',
  },
  ASSIGNED_INTERNAL: {
    name: 'Assigned for processing', audience: 'Staff', trigger: 'Exchange Control assigns a transaction',
    subject: '[Forex] {{ref}} assigned to {{assigneeName}} for processing',
    body: 'Application {{ref}} ({{customerName}}, {{currency}} {{amount}}) has been assigned to {{assigneeName}} for processing.\n\n{{comment}}\n\nForex Application System',
  },
  PROCESSED_CLIENT: {
    name: 'Processed – advice to client', audience: 'Client', trigger: 'Payment recorded (fully or partly paid)',
    subject: 'Your foreign currency transaction {{ref}} has been processed',
    body: 'Dear {{customerName}},\n\nYour transaction {{ref}} has been processed. We have remitted {{currency}} {{paidAmount}} to {{beneficiaryName}} ({{country}}).\n\nStatus: {{processingStatus}}\n\nYours faithfully,\n{{bankName}}',
  },
  PROCESSED_INTERNAL: {
    name: 'Processed – inputter & branch', audience: 'Staff', trigger: 'Payment recorded (fully or partly paid)',
    subject: '[Forex] {{ref}} processed – {{processingStatus}}',
    body: 'Application {{ref}} for {{customerName}} has been processed.\n\nAmount paid: {{currency}} {{paidAmount}}\nStatus: {{processingStatus}}\n\nForex Application System',
  },
  RECON_REMINDER_CLIENT: {
    name: 'Advance payment – reconciliation reminder', audience: 'Client', trigger: 'In the 2 weeks before the reconciliation date',
    subject: 'Reminder: reconciliation of advance payment {{ref}} due {{reconDate}}',
    body: 'Dear {{customerName}},\n\nThis is a reminder that the advance payment {{ref}} ({{currency}} {{amount}}) must be reconciled by {{reconDate}} ({{daysToRecon}} days from today).\n\nPlease submit the import documents (customs entry/bill of entry, final invoice and transport documents) to {{branchName}}.\n\nYours faithfully,\n{{bankName}}',
  },
  RECON_OVERDUE_CLIENT: {
    name: 'Advance payment – reconciliation overdue', audience: 'Client', trigger: 'Monthly after the reconciliation date until reconciled',
    subject: 'Overdue: reconciliation of advance payment {{ref}}',
    body: 'Dear {{customerName}},\n\nThe advance payment {{ref}} ({{currency}} {{amount}}) was due for reconciliation on {{reconDate}} and remains outstanding.\n\nPlease submit the import documents to {{branchName}} as soon as possible.\n\nYours faithfully,\n{{bankName}}',
  },
  RECONCILED_CLIENT: {
    name: 'Advance payment – reconciled', audience: 'Client', trigger: 'Exchange Control marks the transaction reconciled',
    subject: 'Advance payment {{ref}} reconciled',
    body: 'Dear {{customerName}},\n\nThank you. Advance payment {{ref}} ({{currency}} {{amount}}) has been reconciled and no further documents are required.\n\nYours faithfully,\n{{bankName}}',
  },
  TRAVEL_NOT_ALLOCATED_CLIENT: {
    name: 'Travel – not yet allocated', audience: 'Client', trigger: 'Weekly, then daily for the last 3 days before travel',
    subject: 'Your travel allowance {{ref}} has not been allocated yet',
    body: 'Dear {{customerName}},\n\nYour application {{ref}} for {{currency}} {{amount}} for travel on {{travelDate}} ({{daysToTravel}} days from today) has NOT yet been allocated foreign currency.\n\nPlease do not rely on this allocation to proceed with your travel unless the bank advises you to do so.\n\nYours faithfully,\n{{bankName}}',
  },
  TRAVEL_APOLOGY_CLIENT: {
    name: 'Travel – apology, not allocated', audience: 'Client', trigger: 'Day after the travel date if still not allocated',
    subject: 'Your travel allowance application {{ref}}',
    body: 'Dear {{customerName}},\n\nWe sincerely apologise that we were unable to allocate foreign currency for your travel on {{travelDate}} (application {{ref}}, {{currency}} {{amount}}).\n\nThe application has now been closed. Please contact {{branchName}} if you need further assistance.\n\nYours faithfully,\n{{bankName}}',
  },
};

const DEFAULT_SETTINGS = {
  perDiemUSD: 500,              // travel allowance per day (USD or equivalent)
  ticketThresholdUSD: 3000,     // cash/cash passport above this needs a ticket
  fundingCutoff: '16:00',       // client must fund by this time on the allocation day
  unreconciledBlock: 'ANY',     // new applications while the client has unreconciled advance payments: ANY / OVERDUE block, WARN only warns
  reconDays: 90,                // advance payments: reconcile within N calendar days of full payment
  reconPreDueOffsets: [14, 11, 7, 4], // days before due date: 2 reminders a week for 2 weeks
  reconOverdueEveryDays: 30,    // then monthly until reconciled
  travelWeeklyEveryDays: 7,
  travelDailyLastDays: 3,
  expiryAlertDays: [7, 3, 1],   // branch alerts this many days before a travel date, visa expiry or reconciliation date
  fundingReminderHours: 2,      // branch alert this many hours before the funding cut-off
  agingDays: 30,                // branch alert when a transaction has been open longer than this
  agingRepeatDays: 7,           // ...then repeat every N days until it is closed
  passwordMinLength: 12,        // plus upper, lower, number and symbol
  maxFailedLogins: 3,           // account locks after this many wrong passwords (3 at most)
  passwordResetMinutes: 30,     // emailed reset links expire after this
  sessionTimeoutMinutes: 15,    // sign out after this much inactivity
  // Indicative MWK per 1 unit of currency, used for equivalents and validations.
  rates: { USD: 1751, EUR: 1895, GBP: 2235, ZAR: 96.5, CNY: 245, INR: 20.9, AED: 476.8, ZMW: 66.2, TZS: 0.68, KES: 13.55 },
};
