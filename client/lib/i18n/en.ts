export const en = {
  // App
  appName: 'CareLoop',
  tagline: 'Screening-to-care coordination platform',
  loading: 'Loading...',
  logout: 'Logout',
  role: 'Role',
  provider: 'Provider',
  language: 'Language',
  english: 'English',
  arabic: 'العربية',
  unassigned: 'Unassigned',
  close: 'Close',

  // Demo Time
  demoTimeActive: 'Demo simulated time active',
  offset: 'Offset',

  // Auth / Login
  signInTitle: 'Sign in to CareLoop',
  signInSubtitle: 'Screening-to-care coordination platform',
  emailLabel: 'Email address',
  passwordLabel: 'Password',
  emailPlaceholder: 'name@example.com',
  passwordPlaceholder: 'Enter your password',
  signInButton: 'Sign in',
  signingIn: 'Signing in...',
  invalidCredentials: 'Invalid email or password',
  rateLimited: 'Too many failed login attempts. Please try again later.',
  validationError: 'Please enter a valid email and password.',
  unexpectedError: 'An unexpected error occurred. Please try again.',
  demoAccountsTitle: 'Demo accounts',
  demoAccountsNotice: 'Click an account to auto-fill credentials.',
  fillAccount: 'Fill',

  // Roles
  role_PATIENT: 'Patient',
  role_DOCTOR: 'Doctor',
  role_COORDINATOR: 'Coordinator',
  role_ADMIN: 'Administrator',

  // Workflow states
  state_NEW: 'New',
  state_CLINICIAN_REVIEWED: 'Clinician Reviewed',
  state_CONFIRMATION_PENDING: 'Confirmation Pending',
  state_REFERRAL_PENDING: 'Referral Pending',
  state_REFERRAL_ACCEPTED: 'Referral Accepted',
  state_APPOINTMENT_SCHEDULED: 'Appointment Scheduled',
  state_CARE_STARTED: 'Care Started',
  state_CLOSED: 'Closed',

  // Patient friendly status descriptions (docs/02 section 3.2)
  patient_status_NEW: 'Under clinical review',
  patient_status_CLINICIAN_REVIEWED: 'Next step planned',
  patient_status_CONFIRMATION_PENDING: 'Waiting for confirmation',
  patient_status_REFERRAL_PENDING: 'Referral in progress',
  patient_status_REFERRAL_ACCEPTED: 'Referral accepted',
  patient_status_APPOINTMENT_SCHEDULED: 'Appointment scheduled',
  patient_status_CARE_STARTED: 'Care started',
  patient_status_CLOSED: 'Care completed',

  // Attention levels
  attention_LOW: 'Low Attention',
  attention_MEDIUM: 'Medium Attention',
  attention_HIGH: 'High Attention',
  attentionRuleNotice:
    'Operational workflow rule, not a clinical risk assessment.',

  // Navigation
  nav_casesAndTracker: 'Cases & Care Status',
  nav_notifications: 'Notifications',
  nav_consent: 'Data Consent',
  nav_consults: 'Clinical Consults',
  nav_worklist: 'Clinical Worklist',
  nav_attentionQueue: 'Attention Queue',
  nav_referrals: 'Incoming Referrals',
  nav_allCases: 'All Cases',
  nav_appointments: 'Appointments',
  nav_operationalKpis: 'Operational KPIs',
  nav_casesDirectory: 'Cases Directory',
  nav_cohortSimulation: 'Cohort Simulation',
  nav_auditTrail: 'Audit Trail',
  nav_planned: 'Planned',

  // Landing / Overview
  landing_welcome: 'Welcome back',
  landing_sessionTitle: 'Session identity',
  landing_casesCount: 'Total cases',
  landing_attentionCount: 'High attention queue',
  landing_apiConnected: 'Connected to live API',
  landing_noCasesFound: 'No cases found',
  landing_patientPortalNotice:
    'Your active screening cases and care coordination status are shown below.',
  patient_casesTitle: 'Your cases',
  patient_casesIntro: 'See the current status and next step for each screening case.',
  patient_nextStep: 'Next step',
  patient_lastUpdate: 'Last updated',
  patient_unreadBadge: 'new notifications',
  patient_noCases: 'No cases yet',
  patient_noCasesDescription: 'There are no screening cases linked to your account.',
  patient_casesError: 'We could not load your cases. Please try again later.',
  errorTitle: 'Something went wrong',

  // Review notice
  reviewNotice_title: 'Notice',
  reviewNotice_unreviewedText:
    'Machine-translated Arabic content has not been clinically reviewed.',
  reviewNotice_dismiss: 'Dismiss',
} as const;

export type TranslationKey = keyof typeof en;
export type Translations = Record<TranslationKey, string>;

