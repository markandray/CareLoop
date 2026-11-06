import type { AppointmentStatus, CaseState, EscalationLevel, FollowUpStatus, ReferralStatus, Urgency } from '@prisma/client';
import { workflowConfig } from '../../config/workflowConfig';

export const ATTENTION_LABEL = 'Operational workflow rule, not a clinical risk assessment.' as const;

export interface AttentionSnapshot {
  state: CaseState;
  urgency: Urgency;
  ownerUserId: string | null;
  ownerRole: string | null;
  dueAt: Date | null;
  notifiedAt: Date | null;
  acknowledgedAt: Date | null;
  currentReferral: { status: ReferralStatus; createdAt: Date; respondedAt: Date | null } | null;
  currentAppointment: { status: AppointmentStatus; scheduledAt: Date } | null;
  failedContactAttempts: number;
  openConsultAgeMs: number | null;
  escalationLevel: EscalationLevel;
  escalatedAt?: Date | null;
  followUp: { dueAt: Date; status: FollowUpStatus } | null;
}

export interface AttentionResult {
  score: number;
  attentionLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: Array<{ code: string; text: string; points: number }>;
  suggestedAction: string;
  label: typeof ATTENTION_LABEL;
  overdueBy: number;
  slaPeriods: number;
}

const copy: Record<string, { text: string; action?: string }> = {
  UNASSIGNED: { text: 'This case has no owner assigned and has not been accepted into the workflow queue.', action: 'Assign a doctor or coordinator and set a due date.' },
  NOTIFICATION_UNACKNOWLEDGED: { text: 'The patient has not acknowledged the update within the configured time window.', action: 'Send a reminder and check that the patient can be reached.' },
  REFERRAL_PENDING: { text: 'This referral has been pending longer than the configured service time.', action: 'Follow up with the receiving provider or reassign the referral.' },
  REJECTED_REFERRAL_NOT_REASSIGNED: { text: 'A provider rejected this referral and it has not been reassigned.', action: 'Reassign the referral to another provider.' },
  APPOINTMENT_OVERDUE_OR_MISSED: { text: 'The appointment is overdue or was missed and no recovery step is recorded.', action: 'Record the outcome, reschedule, or escalate.' },
  FOLLOW_UP_DEADLINE_MISSED: { text: 'A required follow-up is past due and still open.', action: 'Reassign the follow-up or escalate.' },
  REPEATED_UNREACHABLE: { text: 'Repeated attempts to reach the patient have failed.', action: 'Escalate and document the contact attempts.' },
  UNANSWERED_CONSULT: { text: 'A consultation request has not been answered in time.', action: 'Ask a clinician to respond.' },
  GENERIC_STATE_SLA_BREACH: { text: 'This case is past its due date for its current step.', action: 'Complete or escalate the current step.' },
  OVERDUE_PERIOD_BONUS: { text: 'This step has stayed open past its due date.', action: 'Complete or escalate the current step.' },
  URGENT_TIER: { text: 'This case is on the urgent timer.' },
};

type Config = typeof workflowConfig;
const stateSlaKey: Partial<Record<CaseState, keyof Config['slaMs']>> = {
  NEW: 'reviewAfterNew', CLINICIAN_REVIEWED: 'notificationDispatch',
  CONFIRMATION_PENDING: 'confirmatoryResult', REFERRAL_PENDING: 'referralAcceptance',
  REFERRAL_ACCEPTED: 'appointmentScheduling', APPOINTMENT_SCHEDULED: 'appointmentAttendanceGrace',
  CARE_STARTED: 'defaultFollowUpInterval',
};
const specificStateRules: Partial<Record<CaseState, boolean>> = {
  REFERRAL_PENDING: true, APPOINTMENT_SCHEDULED: true, CARE_STARTED: true,
};

/** Shared definition of state-SLA lateness for both attention and escalation. */
export function overdueInfo(snapshot: Pick<AttentionSnapshot, 'state' | 'urgency' | 'dueAt'>, now: Date, config: Config = workflowConfig): { overdueBy: number; slaPeriods: number } {
  if (snapshot.state === 'CLOSED') return { overdueBy: 0, slaPeriods: 0 };
  const overdueBy = snapshot.dueAt ? Math.max(0, now.getTime() - snapshot.dueAt.getTime()) : 0;
  const slaKey = stateSlaKey[snapshot.state];
  const slaDuration = slaKey ? config.slaMs[slaKey][snapshot.urgency] : 0;
  return { overdueBy, slaPeriods: slaDuration > 0 ? Math.floor(overdueBy / slaDuration) : 0 };
}

/** Pure operational scoring over a database-independent snapshot. */
export function computeAttention(snapshot: AttentionSnapshot, now: Date, config: Config = workflowConfig): AttentionResult {
  if (snapshot.state === 'CLOSED') return { score: 0, attentionLevel: 'LOW', reasons: [], suggestedAction: 'No operational action is required.', label: ATTENTION_LABEL, overdueBy: 0, slaPeriods: 0 };

  const urgency = snapshot.urgency;
  const add = (code: string, points: number) => reasons.push({ code, text: copy[code]!.text, points });
  const reasons: AttentionResult['reasons'] = [];
  const w = config.attentionWeights;
  if (!snapshot.ownerUserId && !snapshot.ownerRole) add('UNASSIGNED', w.unassigned);

  const ackMs = config.slaMs.patientAcknowledgement[urgency];
  if (snapshot.notifiedAt && !snapshot.acknowledgedAt && now.getTime() - snapshot.notifiedAt.getTime() > ackMs)
    add('NOTIFICATION_UNACKNOWLEDGED', w.notificationUnacknowledged);

  if (snapshot.state === 'REFERRAL_PENDING' && snapshot.currentReferral?.status === 'PENDING' && snapshot.dueAt && now > snapshot.dueAt)
    add('REFERRAL_PENDING', w.referralPending);
  if (snapshot.state === 'REFERRAL_PENDING' && snapshot.currentReferral?.status === 'REJECTED' && snapshot.currentReferral.respondedAt) {
    const window = config.slaMs.rejectedReferralReassign[urgency];
    if (now.getTime() - snapshot.currentReferral.respondedAt.getTime() > window)
      add('REJECTED_REFERRAL_NOT_REASSIGNED', w.rejectedReferralNotReassigned);
  }
  if (snapshot.state === 'APPOINTMENT_SCHEDULED' && snapshot.currentAppointment &&
      (snapshot.currentAppointment.status === 'MISSED' || (snapshot.currentAppointment.status === 'SCHEDULED' && now > snapshot.currentAppointment.scheduledAt)))
    add('APPOINTMENT_OVERDUE_OR_MISSED', w.appointmentOverdueOrMissed);
  if (snapshot.state === 'CARE_STARTED' && snapshot.followUp?.status === 'OPEN' && now > snapshot.followUp.dueAt)
    add('FOLLOW_UP_DEADLINE_MISSED', w.followUpDeadlineMissed);
  if (snapshot.failedContactAttempts >= config.thresholds.failedContactAttempts)
    add('REPEATED_UNREACHABLE', w.repeatedUnreachable);
  if (snapshot.openConsultAgeMs !== null && snapshot.openConsultAgeMs > config.slaMs.consultationResponse[urgency])
    add('UNANSWERED_CONSULT', w.unansweredConsult);

  if (!specificStateRules[snapshot.state] && snapshot.dueAt && now > snapshot.dueAt)
    add('GENERIC_STATE_SLA_BREACH', w.genericStateSlaBreach);

  const { overdueBy, slaPeriods } = overdueInfo(snapshot, now, config);
  if (overdueBy > 0 && stateSlaKey[snapshot.state]) add('OVERDUE_PERIOD_BONUS', Math.min(w.overdueBonusCap, w.overduePerSlaPeriod * slaPeriods));
  if (urgency === 'URGENT') add('URGENT_TIER', w.urgent);

  reasons.sort((a, b) => b.points - a.points || a.code.localeCompare(b.code));
  const score = reasons.reduce((total, reason) => total + reason.points, 0);
  const attentionLevel = score >= config.attentionLevelThresholds.high ? 'HIGH' : score >= config.attentionLevelThresholds.medium ? 'MEDIUM' : 'LOW';
  const suggestedAction = reasons.length === 0 ? 'Continue routine workflow monitoring.' :
    reasons[0]?.code === 'URGENT_TIER' ? 'No action needed yet.' : copy[reasons[0]!.code]?.action ?? 'No action needed yet.';
  return { score, attentionLevel, reasons, suggestedAction, label: ATTENTION_LABEL, overdueBy, slaPeriods };
}

