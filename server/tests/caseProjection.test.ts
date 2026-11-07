import { describe, expect, it } from 'vitest';
import { CaseEventTypeSchema } from '@careloop/shared';
import { hiddenPatientEventTypes, patientEventLabelByType } from '../src/modules/cases/caseProjection';

describe('patient event label allowlist', () => {
  it('makes an explicit visibility decision for every case event type', () => {
    const all = CaseEventTypeSchema.options;
    const visible = Object.keys(patientEventLabelByType);
    const decisions = [...visible, ...hiddenPatientEventTypes];
    expect(new Set(decisions).size).toBe(all.length);
    expect(new Set(decisions)).toEqual(new Set(all));
  });

  it('keeps internal process events explicitly hidden', () => {
    expect(hiddenPatientEventTypes).toEqual(expect.arrayContaining([
      'ESCALATION_RAISED', 'ESCALATION_CLEARED', 'OWNER_ASSIGNED',
      'DELAY_REASON_RECORDED', 'CONTACT_ATTEMPT_LOGGED', 'NOTIFICATION_QUEUED',
      'EXPLANATION_GENERATED', 'EXPLANATION_APPROVED', 'REFERRAL_REJECTED',
      'REFERRAL_REASSIGNED', 'APPOINTMENT_MISSED', 'CLOSURE_PROPOSED',
    ]));
  });
});
