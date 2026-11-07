import { describe, expect, it } from 'vitest';
import { CASE_STATE_LABELS, filterWorklist, formatDueTime, getDoctorErrorMessage, getWorklistTab, sortWorklist } from '../lib/doctor-worklist';

describe('doctor worklist helpers', () => {
  it('maps every workflow state to a staff label and worklist tab', () => {
    expect(Object.keys(CASE_STATE_LABELS)).toHaveLength(8);
    expect(getWorklistTab('NEW')).toBe('needs-review');
    expect(getWorklistTab('CLOSED')).toBe('closed');
    for (const state of ['CLINICIAN_REVIEWED', 'CONFIRMATION_PENDING', 'REFERRAL_PENDING', 'REFERRAL_ACCEPTED', 'APPOINTMENT_SCHEDULED', 'CARE_STARTED'] as const) {
      expect(getWorklistTab(state)).toBe('in-progress');
      expect(CASE_STATE_LABELS[state]).toBeTruthy();
    }
  });

  it('formats due/overdue relative to fixed server time and in Dubai time', () => {
    const now = '2026-03-29T00:30:00.000Z';
    expect(formatDueTime('2026-03-29T00:00:00.000Z', now)).toEqual({ relative: 'Overdue by 30 min', overdue: true, dubai: '29 Mar 2026, 04:00' });
    expect(formatDueTime('2026-03-29T01:30:00.000Z', now).relative).toBe('Due in 1 hr');
    expect(formatDueTime(null, now).overdue).toBe(false);
  });

  it('sorts by attention descending, then due time, with null dates last', () => {
    const rows = [
      { id: 'CL-0003', dueAt: null, attention: { level: 'LOW' as const, score: 10 } },
      { id: 'CL-0002', dueAt: '2026-03-30T00:00:00.000Z', attention: { level: 'MEDIUM' as const, score: 20 } },
      { id: 'CL-0001', dueAt: '2026-03-29T00:00:00.000Z', attention: { level: 'LOW' as const, score: 10 } },
    ];
    expect(sortWorklist(rows).map((row) => row.id)).toEqual(['CL-0002', 'CL-0001', 'CL-0003']);
  });

  it('filters urgency and provider-loaded patient/case search', () => {
    const rows = [
      { id: 'CL-0001', urgencyLabel: 'URGENT' as const, patient: { displayName: 'Amina Noor', syntheticMrn: 'MRN-01' } },
      { id: 'CL-0002', urgencyLabel: 'ROUTINE' as const, patient: { displayName: 'Omar Ali', syntheticMrn: 'MRN-02' } },
    ];
    expect(filterWorklist(rows, 'URGENT', 'amina')).toHaveLength(1);
    expect(filterWorklist(rows, 'ALL', 'MRN-02')[0]?.id).toBe('CL-0002');
  });

  it('maps API error codes to safe user messages', () => {
    expect(getDoctorErrorMessage('FORBIDDEN', 403)).toBe('access');
    expect(getDoctorErrorMessage('VALIDATION_ERROR', 400)).toBe('validation');
    expect(getDoctorErrorMessage('NETWORK_ERROR', 0)).toBe('network');
    expect(getDoctorErrorMessage('INTERNAL_ERROR', 500)).toBe('generic');
  });
});
