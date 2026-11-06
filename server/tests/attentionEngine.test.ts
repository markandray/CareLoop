import { describe, expect, it } from 'vitest';
import { computeAttention, overdueInfo, type AttentionSnapshot } from '../src/modules/attention/attentionEngine';
import { workflowConfig } from '../src/config/workflowConfig';

const now = new Date('2026-11-05T12:00:00.000Z');
function snapshot(overrides: Partial<AttentionSnapshot> = {}): AttentionSnapshot {
  return {
    state: 'CLINICIAN_REVIEWED', urgency: 'ROUTINE', ownerUserId: 'owner', ownerRole: null,
    dueAt: new Date(now.getTime() + 86_400_000), notifiedAt: null, acknowledgedAt: null,
    currentReferral: null, currentAppointment: null, failedContactAttempts: 0, openConsultAgeMs: null,
    escalationLevel: 'LEVEL_0', followUp: null, ...overrides,
  };
}
const codes = (s: AttentionSnapshot, at = now) => computeAttention(s, at).reasons.map((reason) => reason.code);

describe('attention engine rules', () => {
  it('shares overdue and completed SLA period calculation', () => {
    const s = snapshot({ dueAt: new Date(now.getTime() - 2 * 86_400_000) });
    expect(overdueInfo(s, now)).toEqual({ overdueBy: 2 * 86_400_000, slaPeriods: 2 });
  });
  it('scores an unassigned open case', () => expect(computeAttention(snapshot({ ownerUserId: null }), now).score).toBe(30));
  it('scores unacknowledged result_reviewed after its window', () => expect(codes(snapshot({ notifiedAt: new Date(now.getTime() - 72 * 3600000) }), new Date(now.getTime() + 1))).toContain('NOTIFICATION_UNACKNOWLEDGED'));
  it('does not score an acknowledged initial notification', () => expect(codes(snapshot({ notifiedAt: new Date(now.getTime() - 100 * 3600000), acknowledgedAt: now }))).not.toContain('NOTIFICATION_UNACKNOWLEDGED'));
  it('scores a pending referral after its SLA', () => expect(codes(snapshot({ state: 'REFERRAL_PENDING', urgency: 'URGENT', dueAt: new Date(now.getTime() - 1), currentReferral: { status: 'PENDING', createdAt: now, respondedAt: null } }))).toContain('REFERRAL_PENDING'));
  it('scores a rejected referral only after its reassign window', () => {
    const s = snapshot({ state: 'REFERRAL_PENDING', urgency: 'URGENT', currentReferral: { status: 'REJECTED', createdAt: now, respondedAt: now } });
    expect(codes(s, new Date(now.getTime() + 4 * 3600000))).not.toContain('REJECTED_REFERRAL_NOT_REASSIGNED');
    expect(codes(s, new Date(now.getTime() + 4 * 3600000 + 1))).toContain('REJECTED_REFERRAL_NOT_REASSIGNED');
  });
  it('scores an overdue or missed appointment', () => expect(codes(snapshot({ state: 'APPOINTMENT_SCHEDULED', currentAppointment: { status: 'MISSED', scheduledAt: now } }))).toContain('APPOINTMENT_OVERDUE_OR_MISSED'));
  it('scores a missed follow-up deadline', () => expect(codes(snapshot({ state: 'CARE_STARTED', followUp: { dueAt: new Date(now.getTime() - 1), status: 'OPEN' } }))).toContain('FOLLOW_UP_DEADLINE_MISSED'));
  it('scores repeated failed outreach', () => expect(codes(snapshot({ failedContactAttempts: 3 }))).toContain('REPEATED_UNREACHABLE'));
  it('scores an unanswered consult after SLA', () => expect(codes(snapshot({ openConsultAgeMs: 24 * 3600000 + 1 }))).toContain('UNANSWERED_CONSULT'));
  it('scores generic dueAt breach in a fallback state', () => expect(codes(snapshot({ dueAt: new Date(now.getTime() - 1) }))).toContain('GENERIC_STATE_SLA_BREACH'));

  it('uses the documented specific versus generic mapping for every state', () => {
    const expected: Record<AttentionSnapshot['state'], boolean> = {
      NEW: true, CLINICIAN_REVIEWED: true, CONFIRMATION_PENDING: true, REFERRAL_PENDING: false,
      REFERRAL_ACCEPTED: true, APPOINTMENT_SCHEDULED: false, CARE_STARTED: false, CLOSED: false,
    };
    for (const [state, fallback] of Object.entries(expected) as Array<[AttentionSnapshot['state'], boolean]>) {
      const actual = codes(snapshot({ state, dueAt: new Date(now.getTime() - 1), currentReferral: null, currentAppointment: null, followUp: null }));
      expect(actual.includes('GENERIC_STATE_SLA_BREACH'), state).toBe(fallback);
    }
  });

  it('adds the urgent tier bonus', () => expect(computeAttention(snapshot({ urgency: 'URGENT' }), now).score - computeAttention(snapshot(), now).score).toBe(20));
  it('uses a neutral action when only the urgent timer rule applies', () => {
    const result = computeAttention(snapshot({ urgency: 'URGENT' }), now);
    expect(result.reasons).toEqual([{ code: 'URGENT_TIER', text: 'This case is on the urgent timer.', points: 20 }]);
    expect(result.suggestedAction).toBe('No action needed yet.');
  });
  it('uses the action belonging to the highest-scoring reason', () => {
    const result = computeAttention(snapshot({ urgency: 'URGENT', ownerUserId: null }), now);
    expect(result.reasons[0]?.code).toBe('UNASSIGNED');
    expect(result.suggestedAction).toBe('Assign a doctor or coordinator and set a due date.');
  });
  it('keeps the specified plain-language reason and separate action for each rule', () => {
    const future = new Date(now.getTime() + 86_400_000);
    const cases: Array<{ code: string; input: Partial<AttentionSnapshot>; at?: Date; text: string; action: string }> = [
      { code: 'UNASSIGNED', input: { ownerUserId: null }, text: 'This case has no owner assigned and has not been accepted into the workflow queue.', action: 'Assign a doctor or coordinator and set a due date.' },
      { code: 'NOTIFICATION_UNACKNOWLEDGED', input: { notifiedAt: new Date(now.getTime() - 100 * 3600000) }, text: 'The patient has not acknowledged the update within the configured time window.', action: 'Send a reminder and check that the patient can be reached.' },
      { code: 'REFERRAL_PENDING', input: { state: 'REFERRAL_PENDING', urgency: 'URGENT', dueAt: future, currentReferral: { status: 'PENDING', createdAt: now, respondedAt: null } }, at: new Date(future.getTime() + 1), text: 'This referral has been pending longer than the configured service time.', action: 'Follow up with the receiving provider or reassign the referral.' },
      { code: 'REJECTED_REFERRAL_NOT_REASSIGNED', input: { state: 'REFERRAL_PENDING', urgency: 'URGENT', dueAt: future, currentReferral: { status: 'REJECTED', createdAt: now, respondedAt: now } }, at: new Date(now.getTime() + 4 * 3600000 + 1), text: 'A provider rejected this referral and it has not been reassigned.', action: 'Reassign the referral to another provider.' },
      { code: 'APPOINTMENT_OVERDUE_OR_MISSED', input: { state: 'APPOINTMENT_SCHEDULED', urgency: 'URGENT', dueAt: future, currentAppointment: { status: 'MISSED', scheduledAt: now } }, text: 'The appointment is overdue or was missed and no recovery step is recorded.', action: 'Record the outcome, reschedule, or escalate.' },
      { code: 'FOLLOW_UP_DEADLINE_MISSED', input: { state: 'CARE_STARTED', urgency: 'URGENT', dueAt: future, followUp: { dueAt: new Date(now.getTime() - 1), status: 'OPEN' } }, text: 'A required follow-up is past due and still open.', action: 'Reassign the follow-up or escalate.' },
      { code: 'REPEATED_UNREACHABLE', input: { urgency: 'URGENT', dueAt: future, failedContactAttempts: 3 }, text: 'Repeated attempts to reach the patient have failed.', action: 'Escalate and document the contact attempts.' },
      { code: 'UNANSWERED_CONSULT', input: { urgency: 'ROUTINE', dueAt: future, openConsultAgeMs: 30 * 3600000 }, text: 'A consultation request has not been answered in time.', action: 'Ask a clinician to respond.' },
      { code: 'GENERIC_STATE_SLA_BREACH', input: { urgency: 'URGENT', dueAt: new Date(now.getTime() - 1) }, text: 'This case is past its due date for its current step.', action: 'Complete or escalate the current step.' },
    ];
    for (const item of cases) {
      const result = computeAttention(snapshot(item.input), item.at ?? now);
      const reason = result.reasons.find((candidate) => candidate.code === item.code);
      expect(reason?.text, item.code).toBe(item.text);
      expect(result.suggestedAction, item.code).toBe(item.action);
    }
  });
  it('caps overdue bonus at four periods', () => {
    const s = snapshot({ state: 'REFERRAL_PENDING', urgency: 'URGENT', dueAt: new Date(now.getTime() - 96 * 3600000), currentReferral: { status: 'PENDING', createdAt: now, respondedAt: null } });
    expect(computeAttention(s, now).reasons.find((r) => r.code === 'OVERDUE_PERIOD_BONUS')?.points).toBe(40);
  });
  it('reproduces the exact urgent referral worked example', () => {
    const dueAt = new Date(now.getTime() - 3600000);
    const base = snapshot({ state: 'REFERRAL_PENDING', urgency: 'URGENT', dueAt, currentReferral: { status: 'PENDING', createdAt: now, respondedAt: null } });
    const scores = [1, 24, 48, 96].map((hours) => computeAttention(base, new Date(dueAt.getTime() + hours * 3600000)).score);
    expect(scores).toEqual([45, 55, 65, 85]);
  });
  it('uses LOW, MEDIUM, and HIGH score boundaries', () => {
    for (const [score, level] of [[29, 'LOW'], [30, 'MEDIUM'], [59, 'MEDIUM'], [60, 'HIGH']] as const) {
      const config = { ...workflowConfig, attentionWeights: { ...workflowConfig.attentionWeights, unassigned: score } };
      expect(computeAttention(snapshot({ ownerUserId: null }), now, config).attentionLevel).toBe(level);
    }
  });
  it('returns zero and no reasons for a closed case', () => expect(computeAttention(snapshot({ state: 'CLOSED', ownerUserId: null, urgency: 'URGENT', dueAt: new Date(now.getTime() - 1) }), now)).toMatchObject({ score: 0, attentionLevel: 'LOW', reasons: [], overdueBy: 0, slaPeriods: 0 }));
  it('stacks independent operational rules', () => {
    const result = computeAttention(snapshot({ state: 'REFERRAL_PENDING', urgency: 'URGENT', ownerUserId: null, dueAt: new Date(now.getTime() - 48 * 3600000), notifiedAt: new Date(now.getTime() - 25 * 3600000), currentReferral: { status: 'PENDING', createdAt: now, respondedAt: null }, failedContactAttempts: 3, openConsultAgeMs: 5 * 3600000 }), now);
    expect(result.score).toBeGreaterThan(100);
    expect(result.reasons.map((r) => r.points)).toEqual([...result.reasons.map((r) => r.points)].sort((a, b) => b - a));
  });
  it('keeps every attention reason and action digit-free and free of denylisted clinical terms', () => {
    const result = computeAttention(snapshot({ state: 'REFERRAL_PENDING', urgency: 'URGENT', ownerUserId: null, dueAt: new Date(now.getTime() - 96 * 3600000), notifiedAt: new Date(now.getTime() - 100 * 3600000), currentReferral: { status: 'REJECTED', createdAt: now, respondedAt: new Date(now.getTime() - 5 * 3600000) }, failedContactAttempts: 3, openConsultAgeMs: 30 * 3600000 }), now);
    const clinical = /diagnos|disease|cancer|tumou?r|symptom|treatment|medicine|drug|dose|result|screening|clinical/i;
    for (const reason of result.reasons) {
      expect(reason.text).not.toMatch(/[\p{N}]/u);
      expect(reason.text).not.toMatch(clinical);
      expect(copyFor(reason.code)).not.toMatch(/[\p{N}]/u);
      expect(copyFor(reason.code)).not.toMatch(clinical);
    }
    expect(result.suggestedAction).not.toMatch(/[\p{N}]/u);
    expect(result.suggestedAction).not.toMatch(clinical);
  });
});

function copyFor(code: string): string {
  const result = computeAttention(snapshot({ urgency: 'URGENT', ownerUserId: null }), now);
  return result.reasons.find((reason) => reason.code === code)?.text ?? '';
}
