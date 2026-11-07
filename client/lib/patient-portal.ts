import type { ApiErrorCode, CaseState, ClosureReason, Language, NotificationDto } from '@careloop/shared';
import type { TranslationKey } from './i18n/en';

export type PatientProgressStep = 'review' | 'plan' | 'referral' | 'appointment' | 'care';

export interface PatientProgress {
  currentStep: PatientProgressStep | null;
  completedSteps: number;
  closureLabel: string | null;
}

const progressSteps: readonly PatientProgressStep[] = [
  'review', 'plan', 'referral', 'appointment', 'care',
];

const closureLabels: Record<ClosureReason, string> = {
  COMPLETED_CARE: 'patient_closed_COMPLETED_CARE',
  NOT_CONFIRMED: 'patient_closed_NOT_CONFIRMED',
  PATIENT_DECLINED: 'patient_closed_PATIENT_DECLINED',
  UNREACHABLE_AFTER_ATTEMPTS: 'patient_closed_UNREACHABLE_AFTER_ATTEMPTS',
  TRANSFERRED_OUT: 'patient_closed_TRANSFERRED_OUT',
};

/** Maps workflow position to a patient-facing tracker step; CLOSED has no active step. */
export function getPatientProgress(
  state: CaseState,
  closureReason: ClosureReason | null,
): PatientProgress {
  if (state === 'CLOSED') {
    return {
      currentStep: null,
      completedSteps: 0,
      closureLabel: closureReason ? closureLabels[closureReason] : 'patient_closed_unknown',
    };
  }

  const stepByState: Record<Exclude<CaseState, 'CLOSED'>, PatientProgressStep> = {
    NEW: 'review',
    CLINICIAN_REVIEWED: 'plan',
    CONFIRMATION_PENDING: 'plan',
    REFERRAL_PENDING: 'referral',
    REFERRAL_ACCEPTED: 'referral',
    APPOINTMENT_SCHEDULED: 'appointment',
    CARE_STARTED: 'care',
  };
  const currentStep = stepByState[state];
  return { currentStep, completedSteps: progressSteps.indexOf(currentStep), closureLabel: null };
}

export function formatPatientDateTime(value: string, language: Language): string {
  const locale = language === 'AR' ? 'ar-AE-u-nu-latn' : 'en-GB-u-nu-latn';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Dubai',
    numberingSystem: 'latn',
  }).format(new Date(value));
}

export function countUnreadNotifications(notifications: readonly Pick<NotificationDto, 'status' | 'acknowledgedAt'>[]): number {
  return notifications.filter((notification) => notification.status === 'SENT' && notification.acknowledgedAt === null).length;
}

export function countUnreadNotificationsByCase(notifications: readonly Pick<NotificationDto, 'caseId' | 'status' | 'acknowledgedAt'>[]): Record<string, number> {
  return notifications.reduce<Record<string, number>>((counts, notification) => {
    if (notification.status === 'SENT' && notification.acknowledgedAt === null) counts[notification.caseId] = (counts[notification.caseId] ?? 0) + 1;
    return counts;
  }, {});
}

export function isNotificationAcknowledgementEnabled(notification: Pick<NotificationDto, 'status' | 'acknowledgedAt'>, pending: boolean): boolean {
  return notification.status === 'SENT' && notification.acknowledgedAt === null && !pending;
}

export function canConfirmUnderstanding(
  explanation: { status: string; current: boolean } | null | undefined,
  confirmedAt: string | null | undefined,
  pending: boolean,
): boolean {
  return explanation?.status === 'APPROVED' && explanation.current && !confirmedAt && !pending;
}

export function canDeclineCare(state: CaseState, alreadyDeclined: boolean, pending: boolean): boolean {
  return state !== 'CLOSED' && !alreadyDeclined && !pending;
}

export function isDeclineReasonValid(reason: string): boolean {
  const length = reason.trim().length;
  return length >= 10 && length <= 300;
}

export function canGrantConsent(hasActiveConsent: boolean, pending: boolean): boolean {
  return !hasActiveConsent && !pending;
}

export function canRevokeConsent(hasActiveConsent: boolean, pending: boolean): boolean {
  return hasActiveConsent && !pending;
}

export type ApiErrorCategory = 'conflict' | 'missing' | 'access' | 'validation' | 'session' | 'rate-limit' | 'network' | 'generic';

/** Stable API-code mapping shared by patient and staff copy; server messages are never shown directly. */
export function getApiErrorCategory(code: ApiErrorCode | 'NETWORK_ERROR' | null, status: number): ApiErrorCategory {
  if (code === 'CONFLICT' || code === 'INVALID_TRANSITION' || status === 409) return 'conflict';
  if (code === 'NOT_FOUND' || status === 404) return 'missing';
  if (code === 'FORBIDDEN' || code === 'CONSENT_REQUIRED' || status === 403) return 'access';
  if (code === 'VALIDATION_ERROR' || code === 'EVIDENCE_MISSING' || code === 'DELAY_REASON_REQUIRED' || status === 400 || status === 422) return 'validation';
  if (code === 'UNAUTHENTICATED' || status === 401) return 'session';
  if (code === 'RATE_LIMITED' || status === 429) return 'rate-limit';
  if (code === 'NETWORK_ERROR' || status === 0) return 'network';
  return 'generic';
}

/** Maps the shared stable category to patient-safe localized copy. */
export function getPatientErrorMessageKey(code: ApiErrorCode | 'NETWORK_ERROR' | null, status: number): TranslationKey {
  const keyByCategory: Record<ApiErrorCategory, TranslationKey> = {
    conflict: 'patient_errorConflict', missing: 'patient_errorNotFound', access: 'patient_errorForbidden',
    validation: 'patient_errorValidation', session: 'patient_errorUnauthenticated', 'rate-limit': 'patient_errorRateLimited',
    network: 'patient_errorNetwork', generic: 'patient_errorGeneric',
  };
  return keyByCategory[getApiErrorCategory(code, status)];
}
