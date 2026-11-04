import type { Language, NotificationTemplateKey } from '@careloop/shared';

export interface NotificationTemplate {
  text: string;
  reviewNotice: 'NONE' | 'UNREVIEWED_TRANSLATION';
}

type LocalizedTemplate = Record<Language, NotificationTemplate>;

export const templateCatalog: Record<NotificationTemplateKey, LocalizedTemplate> = {
  result_reviewed: {
    EN: { text: 'There is an update for you. Please sign in to view it.', reviewNotice: 'NONE' },
    AR: { text: 'لديك تحديث. يرجى تسجيل الدخول لعرضه.', reviewNotice: 'UNREVIEWED_TRANSLATION' },
    OTHER: { text: 'There is an update for you. Please sign in to view it.', reviewNotice: 'NONE' },
  },
  consent_needed: {
    EN: { text: 'Please review a request and choose whether to share information.', reviewNotice: 'NONE' },
    AR: { text: 'يرجى مراجعة طلب واختيار ما إذا كنت ترغب في مشاركة المعلومات.', reviewNotice: 'UNREVIEWED_TRANSLATION' },
    OTHER: { text: 'Please review a request and choose whether to share information.', reviewNotice: 'NONE' },
  },
  awaiting_confirmation: {
    EN: { text: 'There is an update for you. Please sign in to view it.', reviewNotice: 'NONE' },
    AR: { text: 'لديك تحديث. يرجى تسجيل الدخول لعرضه.', reviewNotice: 'UNREVIEWED_TRANSLATION' },
    OTHER: { text: 'There is an update for you. Please sign in to view it.', reviewNotice: 'NONE' },
  },
  referral_started: {
    EN: { text: 'There is an update for you. Please sign in to view it.', reviewNotice: 'NONE' },
    AR: { text: 'لديك تحديث. يرجى تسجيل الدخول لعرضه.', reviewNotice: 'UNREVIEWED_TRANSLATION' },
    OTHER: { text: 'There is an update for you. Please sign in to view it.', reviewNotice: 'NONE' },
  },
  referral_accepted: {
    EN: { text: 'There is an update for you. Please sign in to view it.', reviewNotice: 'NONE' },
    AR: { text: 'لديك تحديث. يرجى تسجيل الدخول لعرضه.', reviewNotice: 'UNREVIEWED_TRANSLATION' },
    OTHER: { text: 'There is an update for you. Please sign in to view it.', reviewNotice: 'NONE' },
  },
  referral_reassigned: {
    EN: { text: 'There is an update for you. Please sign in to view it.', reviewNotice: 'NONE' },
    AR: { text: 'لديك تحديث. يرجى تسجيل الدخول لعرضه.', reviewNotice: 'UNREVIEWED_TRANSLATION' },
    OTHER: { text: 'There is an update for you. Please sign in to view it.', reviewNotice: 'NONE' },
  },
  appointment_scheduled: {
    EN: { text: 'There is an update for you. Please sign in to view it.', reviewNotice: 'NONE' },
    AR: { text: 'لديك تحديث. يرجى تسجيل الدخول لعرضه.', reviewNotice: 'UNREVIEWED_TRANSLATION' },
    OTHER: { text: 'There is an update for you. Please sign in to view it.', reviewNotice: 'NONE' },
  },
  appointment_rescheduled: {
    EN: { text: 'There is an update for you. Please sign in to view it.', reviewNotice: 'NONE' },
    AR: { text: 'لديك تحديث. يرجى تسجيل الدخول لعرضه.', reviewNotice: 'UNREVIEWED_TRANSLATION' },
    OTHER: { text: 'There is an update for you. Please sign in to view it.', reviewNotice: 'NONE' },
  },
  care_started: {
    EN: { text: 'There is an update for you. Please sign in to view it.', reviewNotice: 'NONE' },
    AR: { text: 'لديك تحديث. يرجى تسجيل الدخول لعرضه.', reviewNotice: 'UNREVIEWED_TRANSLATION' },
    OTHER: { text: 'There is an update for you. Please sign in to view it.', reviewNotice: 'NONE' },
  },
  care_closed: {
    EN: { text: 'There is an update for you. Please sign in to view it.', reviewNotice: 'NONE' },
    AR: { text: 'لديك تحديث. يرجى تسجيل الدخول لعرضه.', reviewNotice: 'UNREVIEWED_TRANSLATION' },
    OTHER: { text: 'There is an update for you. Please sign in to view it.', reviewNotice: 'NONE' },
  },
  followup_due: {
    EN: { text: 'There is an update for you. Please sign in to view it.', reviewNotice: 'NONE' },
    AR: { text: 'لديك تحديث. يرجى تسجيل الدخول لعرضه.', reviewNotice: 'UNREVIEWED_TRANSLATION' },
    OTHER: { text: 'There is an update for you. Please sign in to view it.', reviewNotice: 'NONE' },
  },
  unreachable_retry: {
    EN: { text: 'We could not reach you. Please sign in when you are ready.', reviewNotice: 'NONE' },
    AR: { text: 'تعذر التواصل معك. يرجى تسجيل الدخول عندما تكون مستعداً.', reviewNotice: 'UNREVIEWED_TRANSLATION' },
    OTHER: { text: 'We could not reach you. Please sign in when you are ready.', reviewNotice: 'NONE' },
  },
  consult_pending: {
    EN: { text: 'There is an update for you. Please sign in to view it.', reviewNotice: 'NONE' },
    AR: { text: 'لديك تحديث. يرجى تسجيل الدخول لعرضه.', reviewNotice: 'UNREVIEWED_TRANSLATION' },
    OTHER: { text: 'There is an update for you. Please sign in to view it.', reviewNotice: 'NONE' },
  },
};

export function getNotificationTemplate(key: NotificationTemplateKey, language: Language): NotificationTemplate {
  return templateCatalog[key][language];
}
