import type { Language, NotificationTemplateKey } from '@careloop/shared';

export interface NotificationTemplate {
  text: string;
  /** Arabic wording is machine generated and has not had clinical review. */
  clinicallyReviewed: boolean;
}

type LocalizedTemplate = Record<Language, NotificationTemplate>;

export const templateCatalog: Record<NotificationTemplateKey, LocalizedTemplate> = {
  result_reviewed: {
    EN: { text: 'There is an update for you. Please sign in to view it.', clinicallyReviewed: true },
    AR: { text: 'لديك تحديث. يرجى تسجيل الدخول لعرضه.', clinicallyReviewed: false },
    OTHER: { text: 'There is an update for you. Please sign in to view it.', clinicallyReviewed: true },
  },
  consent_needed: {
    EN: { text: 'Please review a request and choose whether to share information.', clinicallyReviewed: true },
    AR: { text: 'يرجى مراجعة طلب واختيار ما إذا كنت ترغب في مشاركة المعلومات.', clinicallyReviewed: false },
    OTHER: { text: 'Please review a request and choose whether to share information.', clinicallyReviewed: true },
  },
  awaiting_confirmation: {
    EN: { text: 'There is an update for you. Please sign in to view it.', clinicallyReviewed: true },
    AR: { text: 'لديك تحديث. يرجى تسجيل الدخول لعرضه.', clinicallyReviewed: false },
    OTHER: { text: 'There is an update for you. Please sign in to view it.', clinicallyReviewed: true },
  },
  referral_started: {
    EN: { text: 'There is an update for you. Please sign in to view it.', clinicallyReviewed: true },
    AR: { text: 'لديك تحديث. يرجى تسجيل الدخول لعرضه.', clinicallyReviewed: false },
    OTHER: { text: 'There is an update for you. Please sign in to view it.', clinicallyReviewed: true },
  },
  referral_accepted: {
    EN: { text: 'There is an update for you. Please sign in to view it.', clinicallyReviewed: true },
    AR: { text: 'لديك تحديث. يرجى تسجيل الدخول لعرضه.', clinicallyReviewed: false },
    OTHER: { text: 'There is an update for you. Please sign in to view it.', clinicallyReviewed: true },
  },
  referral_reassigned: {
    EN: { text: 'There is an update for you. Please sign in to view it.', clinicallyReviewed: true },
    AR: { text: 'لديك تحديث. يرجى تسجيل الدخول لعرضه.', clinicallyReviewed: false },
    OTHER: { text: 'There is an update for you. Please sign in to view it.', clinicallyReviewed: true },
  },
  appointment_scheduled: {
    EN: { text: 'There is an update for you. Please sign in to view it.', clinicallyReviewed: true },
    AR: { text: 'لديك تحديث. يرجى تسجيل الدخول لعرضه.', clinicallyReviewed: false },
    OTHER: { text: 'There is an update for you. Please sign in to view it.', clinicallyReviewed: true },
  },
  appointment_rescheduled: {
    EN: { text: 'There is an update for you. Please sign in to view it.', clinicallyReviewed: true },
    AR: { text: 'لديك تحديث. يرجى تسجيل الدخول لعرضه.', clinicallyReviewed: false },
    OTHER: { text: 'There is an update for you. Please sign in to view it.', clinicallyReviewed: true },
  },
  care_started: {
    EN: { text: 'There is an update for you. Please sign in to view it.', clinicallyReviewed: true },
    AR: { text: 'لديك تحديث. يرجى تسجيل الدخول لعرضه.', clinicallyReviewed: false },
    OTHER: { text: 'There is an update for you. Please sign in to view it.', clinicallyReviewed: true },
  },
  care_closed: {
    EN: { text: 'There is an update for you. Please sign in to view it.', clinicallyReviewed: true },
    AR: { text: 'لديك تحديث. يرجى تسجيل الدخول لعرضه.', clinicallyReviewed: false },
    OTHER: { text: 'There is an update for you. Please sign in to view it.', clinicallyReviewed: true },
  },
  followup_due: {
    EN: { text: 'There is an update for you. Please sign in to view it.', clinicallyReviewed: true },
    AR: { text: 'لديك تحديث. يرجى تسجيل الدخول لعرضه.', clinicallyReviewed: false },
    OTHER: { text: 'There is an update for you. Please sign in to view it.', clinicallyReviewed: true },
  },
  unreachable_retry: {
    EN: { text: 'We could not reach you. Please sign in when you are ready.', clinicallyReviewed: true },
    AR: { text: 'تعذر التواصل معك. يرجى تسجيل الدخول عندما تكون مستعداً.', clinicallyReviewed: false },
    OTHER: { text: 'We could not reach you. Please sign in when you are ready.', clinicallyReviewed: true },
  },
  consult_pending: {
    EN: { text: 'There is an update for you. Please sign in to view it.', clinicallyReviewed: true },
    AR: { text: 'لديك تحديث. يرجى تسجيل الدخول لعرضه.', clinicallyReviewed: false },
    OTHER: { text: 'There is an update for you. Please sign in to view it.', clinicallyReviewed: true },
  },
};

export function getNotificationTemplate(key: NotificationTemplateKey, language: Language): NotificationTemplate {
  return templateCatalog[key][language];
}
