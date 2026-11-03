import type { Urgency } from '@careloop/shared';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Operational defaults transcribed from Product Requirements §§1.1, 5, and 8.2. */
export const workflowConfig = {
  slaMs: {
    reviewAfterNew: { ROUTINE: 48 * HOUR_MS, URGENT: 4 * HOUR_MS },
    notificationDispatch: { ROUTINE: 24 * HOUR_MS, URGENT: 4 * HOUR_MS },
    patientAcknowledgement: { ROUTINE: 72 * HOUR_MS, URGENT: 24 * HOUR_MS },
    confirmatoryResult: { ROUTINE: 7 * DAY_MS, URGENT: 48 * HOUR_MS },
    referralAcceptance: { ROUTINE: 3 * DAY_MS, URGENT: 24 * HOUR_MS },
    rejectedReferralReassign: { ROUTINE: 24 * HOUR_MS, URGENT: 4 * HOUR_MS },
    appointmentScheduling: { ROUTINE: 7 * DAY_MS, URGENT: 48 * HOUR_MS },
    consultationResponse: { ROUTINE: 24 * HOUR_MS, URGENT: 4 * HOUR_MS },
    defaultFollowUpInterval: { ROUTINE: 30 * DAY_MS, URGENT: 30 * DAY_MS },
    // Product Requirements §1.1 specifies appointment time + 2 days, without an urgency split.
    appointmentAttendanceGrace: { ROUTINE: 2 * DAY_MS, URGENT: 2 * DAY_MS },
  },
  thresholds: {
    failedContactAttempts: 3,
    referralReassignments: 3,
    level1OverdueMs: 0,
    level2OverduePeriods: 2,
    level3OverduePeriods: 3,
    level2UnclearedMs: 48 * HOUR_MS,
  },
  attentionWeights: {
    unassigned: 30,
    notificationUnacknowledged: 20,
    referralPending: 25,
    rejectedReferralNotReassigned: 25,
    appointmentOverdueOrMissed: 25,
    followUpDeadlineMissed: 20,
    repeatedUnreachable: 30,
    unansweredConsult: 15,
    genericStateSlaBreach: 20,
    overduePerSlaPeriod: 10,
    overdueBonusCap: 40,
    urgent: 20,
  },
  attentionLevelThresholds: {
    medium: 30,
    high: 60,
  },
} as const;

export type SlaKey = keyof typeof workflowConfig.slaMs;

/** Calculates a due timestamp from the centralized routine/urgent SLA table. */
export function dueAtFor(
  slaKey: SlaKey,
  urgency: Urgency,
  now: Date,
): Date {
  return new Date(now.getTime() + workflowConfig.slaMs[slaKey][urgency]);
}
