import { describe, expect, it } from 'vitest';
import type { AttentionSnapshot } from '../src/modules/attention/attentionEngine';
import { requiredEscalationLevel } from '../src/modules/escalation/escalationService';

const now = new Date('2026-11-05T12:00:00.000Z');
const base: AttentionSnapshot = {
  state: 'CLINICIAN_REVIEWED', urgency: 'ROUTINE', ownerUserId: 'owner', ownerRole: null,
  dueAt: new Date(now.getTime() + 86_400_000), notifiedAt: null, acknowledgedAt: null,
  currentReferral: null, currentAppointment: null, failedContactAttempts: 0, openConsultAgeMs: null,
  escalationLevel: 'LEVEL_0', escalatedAt: null, followUp: null,
};

describe('required escalation level boundaries', () => {
  it('remains level zero at the due instant and raises level one one millisecond overdue', () => {
    const dueAt = new Date(now.getTime());
    expect(requiredEscalationLevel({ ...base, dueAt }, now)).toBe('LEVEL_0');
    expect(requiredEscalationLevel({ ...base, dueAt }, new Date(now.getTime() + 1))).toBe('LEVEL_1');
  });
  it('raises level two at exactly two configured SLA periods', () => {
    expect(requiredEscalationLevel({ ...base, dueAt: new Date(now.getTime() - 2 * 86_400_000) }, now)).toBe('LEVEL_2');
  });
  it('raises level three at exactly three configured SLA periods', () => {
    expect(requiredEscalationLevel({ ...base, dueAt: new Date(now.getTime() - 3 * 86_400_000) }, now)).toBe('LEVEL_3');
  });
  it('raises level two to three at exactly 48 hours uncleared', () => {
    expect(requiredEscalationLevel({ ...base, dueAt: new Date(now.getTime() - 86_400_001), escalationLevel: 'LEVEL_2', escalatedAt: new Date(now.getTime() - 48 * 3_600_000) }, now)).toBe('LEVEL_3');
  });
  it('does not raise level two at 47 hours 59 minutes uncleared', () => {
    expect(requiredEscalationLevel({ ...base, dueAt: new Date(now.getTime() - 86_400_001), escalationLevel: 'LEVEL_2', escalatedAt: new Date(now.getTime() - (47 * 60 + 59) * 60_000) }, now)).toBe('LEVEL_2');
  });
  it('requires level zero for closed cases', () => {
    expect(requiredEscalationLevel({ ...base, state: 'CLOSED', dueAt: new Date(now.getTime() - 10 * 86_400_000), escalationLevel: 'LEVEL_3' }, now)).toBe('LEVEL_0');
  });
});
