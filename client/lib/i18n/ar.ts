import type { Translations } from './en';

export const ar: Translations = {
  // App
  appName: 'كيرلوب (CareLoop)',
  tagline: 'منصة تنسيق المسار من الفحص إلى الرعاية',
  loading: 'جارٍ التحميل...',
  logout: 'تسجيل الخروج',
  role: 'الدور',
  provider: 'مقدم الخدمة',
  language: 'اللغة',
  english: 'English',
  arabic: 'العربية',
  unassigned: 'غير مخصص',
  close: 'إغلاق',

  // Demo Time
  demoTimeActive: 'الوقت التجريبي المحاكى نشط',
  offset: 'الإزاحة',

  // Auth / Login
  signInTitle: 'تسجيل الدخول إلى كيرلوب',
  signInSubtitle: 'منصة تنسيق المسار من الفحص إلى الرعاية',
  emailLabel: 'البريد الإلكتروني',
  passwordLabel: 'كلمة المرور',
  emailPlaceholder: 'name@example.com',
  passwordPlaceholder: 'أدخل كلمة المرور',
  signInButton: 'تسجيل الدخول',
  signingIn: 'جارٍ تسجيل الدخول...',
  invalidCredentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
  rateLimited: 'محاولات دخول كثيرة خاطئة. يرجى المحاولة لاحقاً.',
  validationError: 'يرجى إدخال بريد إلكتروني وكلمة مرور صالحين.',
  unexpectedError: 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.',
  demoAccountsTitle: 'الحسابات التجريبية',
  demoAccountsNotice: 'انقر فوق حساب لتعبئة بيانات الدخول تلقائياً.',
  fillAccount: 'تعبئة',

  // Roles
  role_PATIENT: 'مريض',
  role_DOCTOR: 'طبيب',
  role_COORDINATOR: 'منسق',
  role_ADMIN: 'مسؤول النظام',

  // Workflow states
  state_NEW: 'جديد',
  state_CLINICIAN_REVIEWED: 'تمت مراجعة الطبيب',
  state_CONFIRMATION_PENDING: 'في انتظار التأكيد',
  state_REFERRAL_PENDING: 'في انتظار التحويل',
  state_REFERRAL_ACCEPTED: 'تم قبول التحويل',
  state_APPOINTMENT_SCHEDULED: 'تم تحديد الموعد',
  state_CARE_STARTED: 'بدأت الرعاية',
  state_CLOSED: 'مغلق',

  // Patient friendly status descriptions (docs/02 section 3.2)
  patient_status_NEW: 'قيد المراجعة السريرية',
  patient_status_CLINICIAN_REVIEWED: 'تم تخطيط الخطوة التالية',
  patient_status_CONFIRMATION_PENDING: 'في انتظار الفحوصات التأكيدية',
  patient_status_REFERRAL_PENDING: 'التحويل قيد الإجراء',
  patient_status_REFERRAL_ACCEPTED: 'تم قبول التحويل',
  patient_status_APPOINTMENT_SCHEDULED: 'تم حجز الموعد',
  patient_status_CARE_STARTED: 'بدأت خطة الرعاية',
  patient_status_CLOSED: 'اكتملت الرعاية',

  // Attention levels
  attention_LOW: 'انتباه منخفض',
  attention_MEDIUM: 'انتباه متوسط',
  attention_HIGH: 'انتباه مرتفع',
  attentionRuleNotice:
    'قاعدة سير عمل تشغيلية وليست تقييماً للمخاطر السريرية.',

  // Navigation
  nav_casesAndTracker: 'الحالات وحالة الرعاية',
  nav_notifications: 'الإشعارات',
  nav_consent: 'الموافقات على البيانات',
  nav_consults: 'الاستشارات السريرية',
  nav_worklist: 'قائمة العمل السريري',
  nav_attentionQueue: 'قائمة الانتباه',
  nav_referrals: 'التحويلات الواردة',
  nav_allCases: 'جميع الحالات',
  nav_appointments: 'المواعيد',
  nav_operationalKpis: 'مؤشرات الأداء التشغيلية',
  nav_casesDirectory: 'دليل الحالات',
  nav_cohortSimulation: 'محاكاة الفئات',
  nav_auditTrail: 'سجل التدقيق',
  nav_planned: 'مخطط له',

  // Landing / Overview
  landing_welcome: 'مرحباً بك مجدداً',
  landing_sessionTitle: 'معلومات الجلسة',
  landing_casesCount: 'إجمالي الحالات',
  landing_attentionCount: 'قائمة الانتباه العالي',
  landing_apiConnected: 'متصل بالواجهة البرمجية المباشرة',
  landing_noCasesFound: 'لا توجد حالات حالياً',
  landing_patientPortalNotice:
    'يتم عرض حالات الفحص النشطة وحالة تنسيق الرعاية الخاصة بك أدناه.',
  patient_casesTitle: 'حالاتك',
  patient_casesIntro: 'اطّلع على الحالة الحالية والخطوة التالية لكل حالة فحص.',
  patient_nextStep: 'الخطوة التالية',
  patient_lastUpdate: 'آخر تحديث',
  patient_unreadBadge: 'إشعارات جديدة',
  patient_noCases: 'لا توجد حالات بعد',
  patient_noCasesDescription: 'لا توجد حالات فحص مرتبطة بحسابك.',
  patient_casesError: 'تعذر تحميل حالاتك. يرجى المحاولة لاحقاً.',
  errorTitle: 'حدث خطأ',

  // Review notice
  reviewNotice_title: 'تنبيه',
  reviewNotice_unreviewedText:
    'المحتوى المترجم إلى العربية ناتج عن ترجمة آلية ولم يخضع للمراجعة السريرية.',
  reviewNotice_dismiss: 'إغلاق',
};

