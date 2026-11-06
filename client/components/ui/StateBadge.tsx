import React from 'react';
import type { CaseState } from '@careloop/shared';
import { Badge, type BadgeProps } from './Badge';

export interface StateBadgeProps {
  state: CaseState;
  patientFriendly?: boolean;
}

const stateLabels: Record<CaseState, string> = {
  NEW: 'New',
  CLINICIAN_REVIEWED: 'Clinician Reviewed',
  CONFIRMATION_PENDING: 'Confirmation Pending',
  REFERRAL_PENDING: 'Referral Pending',
  REFERRAL_ACCEPTED: 'Referral Accepted',
  APPOINTMENT_SCHEDULED: 'Appointment Scheduled',
  CARE_STARTED: 'Care Started',
  CLOSED: 'Closed',
};

const patientStateLabels: Record<CaseState, string> = {
  NEW: 'Under clinical review',
  CLINICIAN_REVIEWED: 'Next step planned',
  CONFIRMATION_PENDING: 'Waiting for confirmation',
  REFERRAL_PENDING: 'Referral in progress',
  REFERRAL_ACCEPTED: 'Referral accepted',
  APPOINTMENT_SCHEDULED: 'Appointment scheduled',
  CARE_STARTED: 'Care started',
  CLOSED: 'Care completed',
};

const stateVariants: Record<CaseState, BadgeProps['variant']> = {
  NEW: 'neutral',
  CLINICIAN_REVIEWED: 'info',
  CONFIRMATION_PENDING: 'warning',
  REFERRAL_PENDING: 'warning',
  REFERRAL_ACCEPTED: 'info',
  APPOINTMENT_SCHEDULED: 'info',
  CARE_STARTED: 'success',
  CLOSED: 'neutral',
};

export function StateBadge({
  state,
  patientFriendly = false,
}: StateBadgeProps) {
  const label = patientFriendly ? patientStateLabels[state] : stateLabels[state];
  const variant = stateVariants[state] || 'neutral';

  return <Badge variant={variant}>{label || state}</Badge>;
}

