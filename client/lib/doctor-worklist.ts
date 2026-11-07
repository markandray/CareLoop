import type { ApiErrorCode, CaseListItem, CaseState, Urgency } from '@careloop/shared';

export type DoctorWorklistTab = 'needs-review' | 'in-progress' | 'closed';

export const CASE_STATE_LABELS: Record<CaseState, string> = {
  NEW: 'New',
  CLINICIAN_REVIEWED: 'Clinician Reviewed',
  CONFIRMATION_PENDING: 'Confirmation Pending',
  REFERRAL_PENDING: 'Referral Pending',
  REFERRAL_ACCEPTED: 'Referral Accepted',
  APPOINTMENT_SCHEDULED: 'Appointment Scheduled',
  CARE_STARTED: 'Care Started',
  CLOSED: 'Closed',
};

export function getWorklistTab(state: CaseState): DoctorWorklistTab {
  if (state === 'NEW') return 'needs-review';
  if (state === 'CLOSED') return 'closed';
  return 'in-progress';
}

export function sortWorklist<T extends Pick<CaseListItem, 'id' | 'dueAt' | 'attention'>>(
  cases: readonly T[],
): T[] {
  return [...cases].sort((a, b) =>
    (b.attention?.score ?? 0) - (a.attention?.score ?? 0)
    || (a.dueAt === null ? 1 : b.dueAt === null ? -1 : Date.parse(a.dueAt) - Date.parse(b.dueAt))
    || a.id.localeCompare(b.id),
  );
}

function relativeDuration(milliseconds: number): string {
  const minutes = Math.max(1, Math.round(Math.abs(milliseconds) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

export function formatDueTime(dueAt: string | null, now: string): { relative: string; overdue: boolean; dubai: string } {
  if (!dueAt) return { relative: 'No due date', overdue: false, dubai: 'No due date' };
  const overdue = Date.parse(dueAt) < Date.parse(now);
  const relative = `${overdue ? 'Overdue by' : 'Due in'} ${relativeDuration(Date.parse(dueAt) - Date.parse(now))}`;
  const dubai = new Intl.DateTimeFormat('en-GB-u-nu-latn', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dubai', numberingSystem: 'latn',
  }).format(new Date(dueAt));
  return { relative, overdue, dubai };
}

export type DoctorErrorMessage = 'access' | 'missing' | 'conflict' | 'validation' | 'session' | 'rate-limit' | 'network' | 'generic';
export function getDoctorErrorMessage(code: ApiErrorCode | 'NETWORK_ERROR' | null, status: number): DoctorErrorMessage {
  if (code === 'CONFLICT' || code === 'INVALID_TRANSITION' || status === 409) return 'conflict';
  if (code === 'NOT_FOUND' || status === 404) return 'missing';
  if (code === 'FORBIDDEN' || code === 'CONSENT_REQUIRED' || status === 403) return 'access';
  if (code === 'VALIDATION_ERROR' || code === 'EVIDENCE_MISSING' || code === 'DELAY_REASON_REQUIRED' || status === 400 || status === 422) return 'validation';
  if (code === 'UNAUTHENTICATED' || status === 401) return 'session';
  if (code === 'RATE_LIMITED' || status === 429) return 'rate-limit';
  if (code === 'NETWORK_ERROR' || status === 0) return 'network';
  return 'generic';
}

export function filterWorklist<T extends { id: string; patient: { displayName?: string; name?: string; syntheticMrn: string }; urgencyLabel: Urgency | null }>(
  items: readonly T[], urgency: Urgency | 'ALL', search: string,
): T[] {
  const needle = search.trim().toLocaleLowerCase();
  return items.filter((item) => (urgency === 'ALL' || item.urgencyLabel === urgency)
    && (!needle || item.id.toLocaleLowerCase().includes(needle)
      || (item.patient.displayName ?? item.patient.name ?? '').toLocaleLowerCase().includes(needle)
      || item.patient.syntheticMrn.toLocaleLowerCase().includes(needle)));
}
