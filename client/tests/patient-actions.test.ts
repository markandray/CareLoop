import { describe, expect, it } from 'vitest';
import { ApiErrorCodeSchema, type NotificationDto } from '@careloop/shared';
import {
  canConfirmUnderstanding,
  canDeclineCare,
  canGrantConsent,
  canRevokeConsent,
  countUnreadNotifications,
  countUnreadNotificationsByCase,
  getPatientErrorMessageKey,
  isDeclineReasonValid,
  isNotificationAcknowledgementEnabled,
} from '../lib/patient-portal';

describe('patient-safe API error mapping', () => {
  const cases = [
    ['CONFLICT', 409, 'patient_errorConflict'],
    ['NOT_FOUND', 404, 'patient_errorNotFound'],
    ['FORBIDDEN', 403, 'patient_errorForbidden'],
    ['CONSENT_REQUIRED', 403, 'patient_errorForbidden'],
    ['VALIDATION_ERROR', 400, 'patient_errorValidation'],
    ['INVALID_TRANSITION', 409, 'patient_errorConflict'],
    ['EVIDENCE_MISSING', 422, 'patient_errorValidation'],
    ['DELAY_REASON_REQUIRED', 422, 'patient_errorValidation'],
    ['UNAUTHENTICATED', 401, 'patient_errorUnauthenticated'],
    ['RATE_LIMITED', 429, 'patient_errorRateLimited'],
    ['INTERNAL_ERROR', 500, 'patient_errorGeneric'],
    ['NETWORK_ERROR', 0, 'patient_errorNetwork'],
  ] as const;

  it.each(cases)('maps %s with status %i to localized copy key %s', (code, status, key) => {
    expect(getPatientErrorMessageKey(code, status)).toBe(key);
  });

  it('maps each shared API error code without exposing server message text', () => {
    for (const code of ApiErrorCodeSchema.options) {
      const key = getPatientErrorMessageKey(code, 500);
      expect(key).toMatch(/^patient_error/);
      expect(key).not.toContain(code);
    }
  });

  it('maps status-only errors for common HTTP failure classes', () => {
    expect(getPatientErrorMessageKey(null, 409)).toBe('patient_errorConflict');
    expect(getPatientErrorMessageKey(null, 404)).toBe('patient_errorNotFound');
    expect(getPatientErrorMessageKey(null, 403)).toBe('patient_errorForbidden');
    expect(getPatientErrorMessageKey(null, 400)).toBe('patient_errorValidation');
    expect(getPatientErrorMessageKey(null, 401)).toBe('patient_errorUnauthenticated');
    expect(getPatientErrorMessageKey(null, 429)).toBe('patient_errorRateLimited');
    expect(getPatientErrorMessageKey('NETWORK_ERROR', 0)).toBe('patient_errorNetwork');
  });
});

describe('patient action enablement rules', () => {
  it('enables acknowledgement only for sent and not-yet-seen notifications when idle', () => {
    expect(isNotificationAcknowledgementEnabled({ status: 'SENT', acknowledgedAt: null }, false)).toBe(true);
    expect(isNotificationAcknowledgementEnabled({ status: 'QUEUED', acknowledgedAt: null }, false)).toBe(false);
    expect(isNotificationAcknowledgementEnabled({ status: 'SENT', acknowledgedAt: '2026-11-07T00:00:00.000Z' }, false)).toBe(false);
    expect(isNotificationAcknowledgementEnabled({ status: 'SENT', acknowledgedAt: null }, true)).toBe(false);
  });

  it('enables understanding only for the current approved explanation before confirmation', () => {
    expect(canConfirmUnderstanding({ status: 'APPROVED', current: true }, null, false)).toBe(true);
    expect(canConfirmUnderstanding({ status: 'DRAFT', current: true }, null, false)).toBe(false);
    expect(canConfirmUnderstanding({ status: 'APPROVED', current: false }, null, false)).toBe(false);
    expect(canConfirmUnderstanding({ status: 'APPROVED', current: true }, '2026-11-07T00:00:00.000Z', false)).toBe(false);
    expect(canConfirmUnderstanding({ status: 'APPROVED', current: true }, null, true)).toBe(false);
    expect(canConfirmUnderstanding(null, null, false)).toBe(false);
  });

  it('enables decline only for an open case without an existing decision or pending request', () => {
    expect(canDeclineCare('REFERRAL_PENDING', false, false)).toBe(true);
    expect(canDeclineCare('CLOSED', false, false)).toBe(false);
    expect(canDeclineCare('CARE_STARTED', true, false)).toBe(false);
    expect(canDeclineCare('CARE_STARTED', false, true)).toBe(false);
  });

  it('enables grant only when consent is inactive and no mutation is pending', () => {
    expect(canGrantConsent(false, false)).toBe(true);
    expect(canGrantConsent(true, false)).toBe(false);
    expect(canGrantConsent(false, true)).toBe(false);
  });

  it('enables revoke only when consent is active and no mutation is pending', () => {
    expect(canRevokeConsent(true, false)).toBe(true);
    expect(canRevokeConsent(false, false)).toBe(false);
    expect(canRevokeConsent(true, true)).toBe(false);
  });

  it('accepts a trimmed decline reason only between 10 and 300 characters', () => {
    expect(isDeclineReasonValid('  I need more time  ')).toBe(true);
    expect(isDeclineReasonValid('short')).toBe(false);
    expect(isDeclineReasonValid(` ${'x'.repeat(301)} `)).toBe(false);
  });
});

describe('unread notification counting', () => {
  const notifications: Pick<NotificationDto, 'caseId' | 'status' | 'acknowledgedAt'>[] = [
    { caseId: 'CL-1001', status: 'SENT', acknowledgedAt: null },
    { caseId: 'CL-1001', status: 'SENT', acknowledgedAt: '2026-11-07T00:00:00.000Z' },
    { caseId: 'CL-1002', status: 'QUEUED', acknowledgedAt: null },
    { caseId: 'CL-1002', status: 'SENT', acknowledgedAt: null },
  ];

  it('counts only sent notifications without acknowledgedAt', () => {
    expect(countUnreadNotifications(notifications)).toBe(2);
  });

  it('groups unread notifications by case', () => {
    expect(countUnreadNotificationsByCase(notifications)).toEqual({ 'CL-1001': 1, 'CL-1002': 1 });
  });

  it('returns zero for an empty notification list', () => {
    expect(countUnreadNotifications([])).toBe(0);
  });
});
