import type { Language } from '@careloop/shared';

export type CatalogCode = 'resultCategoryCode' | 'nextStepCode';

export const resultCategories = {
  ROUTINE_FINDING: {
    EN: 'The screening result is recorded for your clinician to review.',
    AR: 'تم تسجيل نتيجة الفحص لمراجعتها من قبل الطبيب.',
  },
  FOLLOW_UP_NEEDED: {
    EN: 'The screening result needs another step with your care team.',
    AR: 'تحتاج نتيجة الفحص إلى خطوة أخرى مع فريق الرعاية.',
  },
  UNCLEAR_RESULT: {
    EN: 'The screening result is not clear yet and needs review by your care team.',
    AR: 'نتيجة الفحص غير واضحة بعد وتحتاج إلى مراجعة فريق الرعاية.',
  },
  CONFIRMATION_NEEDED: {
    EN: 'Your care team needs more information to understand this screening result.',
    AR: 'يحتاج فريق الرعاية إلى معلومات إضافية لفهم نتيجة الفحص.',
  },
  REVIEW_NEEDED: {
    EN: 'Your care team will review this screening result with you.',
    AR: 'سيراجع فريق الرعاية نتيجة الفحص معك.',
  },
} as const;

export const nextSteps = {
  CONFIRMATORY_TEST: {
    EN: 'Your next step is a confirmatory test arranged by your care team.',
    AR: 'خطوتك التالية هي فحص تأكيدي يرتبه فريق الرعاية.',
  },
  SPECIALIST_REFERRAL: {
    EN: 'Your next step is a specialist referral arranged by your care team.',
    AR: 'خطوتك التالية هي إحالة إلى اختصاصي يرتبها فريق الرعاية.',
  },
  FOLLOW_UP_CLINICIAN: {
    EN: 'Your next step is to follow up with your clinician.',
    AR: 'خطوتك التالية هي المتابعة مع طبيبك.',
  },
  REPEAT_SCREENING: {
    EN: 'Your next step is another screening arranged by your care team.',
    AR: 'خطوتك التالية هي فحص آخر يرتبه فريق الرعاية.',
  },
  CARE_TEAM_CONTACT: {
    EN: 'Your care team will contact you about the next step.',
    AR: 'سيتواصل معك فريق الرعاية بشأن الخطوة التالية.',
  },
  NO_ACTION_NOW: {
    EN: 'Your clinician will let you know if another step is needed.',
    AR: 'سيخبرك طبيبك إذا كانت هناك حاجة إلى خطوة أخرى.',
  },
} as const;

export const fixedSentences = {
  EN: {
    meaningAndDiagnosis: 'This result alone does not explain your overall health. This is not a diagnosis.',
    contactClinic: 'Contact your clinic if you have questions or need help with the next step.',
    limitations: 'This explanation is general information and does not replace your clinician.',
    disclaimer: 'Your clinician reviews and approves the information shared with you.',
    notTranslatedNote: 'The Arabic text is a machine-generated translation and has not been clinically reviewed.',
  },
  AR: {
    meaningAndDiagnosis: 'لا توضح هذه النتيجة وحدها حالتك الصحية بشكل كامل. هذه ليست تشخيصاً.',
    contactClinic: 'تواصل مع العيادة إذا كانت لديك أسئلة أو كنت بحاجة إلى مساعدة بشأن الخطوة التالية.',
    limitations: 'هذا الشرح معلومات عامة ولا يغني عن مراجعة الطبيب.',
    disclaimer: 'يراجع طبيبك المعلومات المقدمة لك ويوافق عليها.',
    notTranslatedNote: 'النص العربي مُنشأ آلياً ولم تتم مراجعته سريرياً.',
  },
} as const;

export function catalogSentences(language: Language): readonly string[] {
  const lang = language === 'AR' ? 'AR' : 'EN';
  return [
    ...Object.values(resultCategories).map((entry) => entry[lang]),
    ...Object.values(nextSteps).map((entry) => entry[lang]),
    ...Object.values(fixedSentences[lang]).filter((value) => value !== fixedSentences[lang].notTranslatedNote),
    fixedSentences.AR.notTranslatedNote,
  ];
}

export function isCatalogCode(kind: CatalogCode, code: string): boolean {
  return kind === 'resultCategoryCode'
    ? Object.hasOwn(resultCategories, code)
    : Object.hasOwn(nextSteps, code);
}
