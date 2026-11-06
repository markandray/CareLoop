import { describe, expect, it } from 'vitest';
import type { CaseState, ClosureReason } from '@careloop/shared';
import { ar } from '../lib/i18n/ar';
import { en } from '../lib/i18n/en';
import { formatPatientDateTime, getPatientProgress } from '../lib/patient-portal';

describe('patient progress mapping', () => {
  const cases: Array<[CaseState, ReturnType<typeof getPatientProgress>['currentStep'], number]> = [
    ['NEW', 'review', 0],
    ['CLINICIAN_REVIEWED', 'plan', 1],
    ['CONFIRMATION_PENDING', 'plan', 1],
    ['REFERRAL_PENDING', 'referral', 2],
    ['REFERRAL_ACCEPTED', 'referral', 2],
    ['APPOINTMENT_SCHEDULED', 'appointment', 3],
    ['CARE_STARTED', 'care', 4],
  ];

  it.each(cases)('%s maps to %s after %i completed steps', (state, step, completed) => {
    expect(getPatientProgress(state, null)).toEqual({
      currentStep: step,
      completedSteps: completed,
      closureLabel: null,
    });
  });

  const closureReasons: ClosureReason[] = [
    'COMPLETED_CARE',
    'NOT_CONFIRMED',
    'PATIENT_DECLINED',
    'UNREACHABLE_AFTER_ATTEMPTS',
    'TRANSFERRED_OUT',
  ];

  it.each(closureReasons)('CLOSED with %s has its own patient label', (reason) => {
    const progress = getPatientProgress('CLOSED', reason);
    expect(progress.currentStep).toBeNull();
    expect(progress.closureLabel).toBe(`patient_closed_${reason}`);
    expect(en[progress.closureLabel as keyof typeof en]).not.toMatch(/no action needed/i);
    expect(ar[progress.closureLabel as keyof typeof ar]).not.toMatch(/no action needed/i);
  });

  it('CLOSED without a reason uses an explicit generic closure label', () => {
    expect(getPatientProgress('CLOSED', null).closureLabel).toBe('patient_closed_unknown');
  });
});

describe('patient date and time formatting', () => {
  const fixedInstant = '2026-03-29T00:30:00.000Z';

  it('uses Asia/Dubai time and Western digits in English', () => {
    expect(formatPatientDateTime(fixedInstant, 'EN')).toBe('29 Mar 2026, 04:30');
  });

  it('respects Arabic language while retaining Western digits', () => {
    const formatted = formatPatientDateTime(fixedInstant, 'AR');
    expect(formatted).toBe('29‏/03‏/2026، 4:30 ص');
    expect(formatted).not.toMatch(/[٠-٩]/u);
  });
});
