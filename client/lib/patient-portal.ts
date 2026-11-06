import type { CaseState, ClosureReason, Language } from '@careloop/shared';

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
