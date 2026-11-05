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
  const add = (code: string, text: string, points: number) => reasons.push({ code, text, points });
  const reasons: AttentionResult['reasons'] = [];
  const w = config.attentionWeights;
  if (!snapshot.ownerUserId && !snapshot.ownerRole) add('UNASSIGNED', 'Assign an owner to this case.', w.unassigned);

  const ackMs = config.slaMs.patientAcknowledgement[urgency];
  if (snapshot.notifiedAt && !snapshot.acknowledgedAt && now.getTime() - snapshot.notifiedAt.getTime() > ackMs)
    add('NOTIFICATION_UNACKNOWLEDGED', `The initial update has not been acknowledged after ${hoursOrDays(ackMs)}.`, w.notificationUnacknowledged);

  if (snapshot.state === 'REFERRAL_PENDING' && snapshot.currentReferral?.status === 'PENDING' && snapshot.dueAt && now > snapshot.dueAt)
    add('REFERRAL_PENDING', 'The receiving provider has not responded within the referral window.', w.referralPending);
  if (snapshot.state === 'REFERRAL_PENDING' && snapshot.currentReferral?.status === 'REJECTED' && snapshot.currentReferral.respondedAt) {
    const window = config.slaMs.rejectedReferralReassign[urgency];
    if (now.getTime() - snapshot.currentReferral.respondedAt.getTime() > window)
      add('REJECTED_REFERRAL_NOT_REASSIGNED', `The rejected referral has not been reassigned after ${hoursOrDays(window)}.`, w.rejectedReferralNotReassigned);
  }
  if (snapshot.state === 'APPOINTMENT_SCHEDULED' && snapshot.currentAppointment &&
      (snapshot.currentAppointment.status === 'MISSED' || (snapshot.currentAppointment.status === 'SCHEDULED' && now > snapshot.currentAppointment.scheduledAt)))
    add('APPOINTMENT_OVERDUE_OR_MISSED', 'Record the appointment outcome or arrange a new time.', w.appointmentOverdueOrMissed);
  if (snapshot.state === 'CARE_STARTED' && snapshot.followUp?.status === 'OPEN' && now > snapshot.followUp.dueAt)
    add('FOLLOW_UP_DEADLINE_MISSED', 'Review and update the overdue follow-up item.', w.followUpDeadlineMissed);
  if (snapshot.failedContactAttempts >= config.thresholds.failedContactAttempts)
    add('REPEATED_UNREACHABLE', 'Use the approved outreach process and review the contact plan.', w.repeatedUnreachable);
  if (snapshot.openConsultAgeMs !== null && snapshot.openConsultAgeMs > config.slaMs.consultationResponse[urgency])
    add('UNANSWERED_CONSULT', `An open consult is unanswered after ${hoursOrDays(config.slaMs.consultationResponse[urgency])}.`, w.unansweredConsult);

  if (!specificStateRules[snapshot.state] && snapshot.dueAt && now > snapshot.dueAt)
    add('GENERIC_STATE_SLA_BREACH', 'Review the overdue workflow task and record the next action.', w.genericStateSlaBreach);

  const { overdueBy, slaPeriods } = overdueInfo(snapshot, now, config);
  if (overdueBy > 0 && stateSlaKey[snapshot.state]) add('OVERDUE_PERIOD_BONUS', 'Additional points reflect completed overdue SLA periods.', Math.min(w.overdueBonusCap, w.overduePerSlaPeriod * slaPeriods));
  if (urgency === 'URGENT') add('URGENT_TIER', 'Higher-priority workflow timer tier applies.', w.urgent);

  reasons.sort((a, b) => b.points - a.points || a.code.localeCompare(b.code));
  const score = reasons.reduce((total, reason) => total + reason.points, 0);
  const attentionLevel = score >= config.attentionLevelThresholds.high ? 'HIGH' : score >= config.attentionLevelThresholds.medium ? 'MEDIUM' : 'LOW';
  const suggestedAction = reasons[0]?.text ?? 'Continue routine workflow monitoring.';
  return { score, attentionLevel, reasons, suggestedAction, label: ATTENTION_LABEL, overdueBy, slaPeriods };
}

function hoursOrDays(milliseconds: number): string {
  const hours = milliseconds / 3_600_000;
  return hours >= 24 && hours % 24 === 0 ? `${hours / 24} days` : `${hours} hours`;
}
