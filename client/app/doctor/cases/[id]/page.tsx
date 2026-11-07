'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { z } from 'zod';
import { AttentionResponseSchema, CaseDetailDoctorSchema, CaseEventStaffCursorPageSchema, type AttentionResponse, type CaseDetailDoctor, type CaseEventStaffCursorPage, type CaseEventDtoStaff, ExplanationDtoSchema } from '@careloop/shared';
import { apiFetch } from '../../../../lib/api';
import { RoleGuard } from '../../../../lib/session';
import { ShellLayout } from '../../../../components/ShellLayout';
import { AttentionBadge, Card, EmptyState, ErrorBanner, Spinner, StateBadge } from '../../../../components/ui';
import { formatDueTime } from '../../../../lib/doctor-worklist';

const ExplanationListSchema = z.object({ items: z.array(ExplanationDtoSchema) }).strict();
type ExplanationList = z.infer<typeof ExplanationListSchema>;

function EventPayload({ payload }: { payload: Record<string, unknown> | null }) {
  if (!payload || !Object.keys(payload).length) return null;
  const entries = Object.entries(payload);
  const short = entries.length <= 3 && entries.every(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value));
  return <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer font-medium">{short ? 'Event details' : `Event details (${entries.length} fields)`}</summary><dl className="mt-2 grid gap-1 ps-3">{entries.map(([key, value]) => <div key={key} className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-2"><dt className="font-medium">{key.replace(/([A-Z])/g, ' $1')}</dt><dd className="break-words">{value === null || ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : 'Structured detail'}</dd></div>)}</dl></details>;
}

function DoctorCaseDetail() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<CaseDetailDoctor | null>(null);
  const [attention, setAttention] = useState<AttentionResponse | null>(null);
  const [events, setEvents] = useState<CaseEventDtoStaff[]>([]);
  const [explanations, setExplanations] = useState<ExplanationList | null>(null);
  const [now, setNow] = useState(new Date().toISOString());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const query = new URLSearchParams({ limit: '100' });
        const [caseData, attentionData, eventPage, explanationData] = await Promise.all([
          apiFetch<CaseDetailDoctor>(`/api/v1/cases/${encodeURIComponent(id)}`, { method: 'GET', schema: CaseDetailDoctorSchema }),
          apiFetch<AttentionResponse>(`/api/v1/cases/${encodeURIComponent(id)}/attention`, { method: 'GET', schema: AttentionResponseSchema }),
          apiFetch<CaseEventStaffCursorPage>(`/api/v1/cases/${encodeURIComponent(id)}/events?${query}`, { method: 'GET', schema: CaseEventStaffCursorPageSchema }),
          apiFetch<ExplanationList>(`/api/v1/cases/${encodeURIComponent(id)}/explanations`, { method: 'GET', schema: ExplanationListSchema }),
        ]);
        if (active) { setDetail(caseData); setAttention(attentionData); setEvents(eventPage.items); setExplanations(explanationData); setNow(attentionData.updatedAt); }
      } catch { if (active) setError(true); }
      finally { if (active) setLoading(false); }
    };
    void load();
    return () => { active = false; };
  }, [id]);

  if (loading) return <ShellLayout><div className="flex justify-center rounded-xl border border-slate-200 bg-white py-12"><Spinner label="Loading case…" /></div></ShellLayout>;
  if (error || !detail) return <ShellLayout><ErrorBanner title="Case unavailable" message="We could not load this case. Check that it belongs to your provider, then try again." /><Link href="/doctor" className="mt-4 inline-block text-sm font-semibold text-teal-900 underline">Back to worklist</Link></ShellLayout>;

  const owner = detail.owner.kind === 'USER' ? detail.owner.name : detail.owner.kind === 'QUEUE' ? `${detail.owner.role} queue` : 'Unassigned';
  const due = formatDueTime(detail.dueAt, now);
  return <ShellLayout>
    <div className="space-y-5">
      <Link href="/doctor" className="text-sm font-medium text-teal-900 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">Back to worklist</Link>
      <header className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 tabIndex={-1} className="text-2xl font-bold tracking-tight text-slate-900">{detail.id}</h1><p className="mt-1 text-sm text-slate-700">{detail.patient.name} · MRN {detail.patient.syntheticMrn}</p><p className="text-xs text-slate-500">{detail.originProvider.name}</p></div><div className="flex flex-wrap gap-2"><StateBadge state={detail.state} /><AttentionBadge level={detail.attention.level} score={detail.attention.score} /></div></div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3"><div><dt className="text-xs font-semibold text-slate-500">Urgency</dt><dd>Intake {detail.intakeUrgency}; confirmed {detail.urgencyLabel ?? 'not set'}</dd></div><div><dt className="text-xs font-semibold text-slate-500">Owner</dt><dd>{owner}</dd></div><div><dt className="text-xs font-semibold text-slate-500">Due</dt><dd className={due.overdue ? 'font-semibold text-rose-800' : ''}>{due.relative} · {due.dubai} (Asia/Dubai)</dd></div><div><dt className="text-xs font-semibold text-slate-500">Escalation</dt><dd>{detail.escalationLevel === 'LEVEL_0' ? 'None' : detail.escalationLevel.replace('_', ' ')}</dd></div><div><dt className="text-xs font-semibold text-slate-500">Pathway</dt><dd>{detail.pathway}</dd></div><div><dt className="text-xs font-semibold text-slate-500">Screening type</dt><dd>{detail.screeningType}</dd></div></dl>
      </header>

      <Card title="Clinical information" headingLevel={2}><dl className="grid gap-4 sm:grid-cols-2"><div><dt className="text-xs font-semibold text-slate-500">Result category</dt><dd className="mt-1 text-sm text-slate-900">{detail.resultCategory}</dd></div><div><dt className="text-xs font-semibold text-slate-500">Preliminary / approved summary</dt><dd className="mt-1 whitespace-pre-line text-sm text-slate-900">{detail.resultSummaryApproved ?? 'Preliminary summary is recorded in the case intake evidence.'}</dd></div><div><dt className="text-xs font-semibold text-slate-500">Recommended action</dt><dd className="mt-1 whitespace-pre-line text-sm text-slate-900">{detail.recommendedNextStep ?? 'Not recorded'}</dd></div><div><dt className="text-xs font-semibold text-slate-500">Review draft</dt><dd className="mt-1 text-sm text-slate-900">{detail.explanations.some((item) => item.status === 'APPROVED' && item.current) ? 'Approved review fields are reflected above.' : 'No approved review fields yet.'}</dd></div></dl></Card>

      <Card title="Operational attention" subtitle={attention?.label ?? 'Operational workflow rule, not a clinical risk assessment.'} headingLevel={2}><div className="space-y-3"><p><AttentionBadge level={detail.attention.level} score={detail.attention.score} /></p>{attention?.reasons.length ? <ul className="list-disc space-y-1 ps-5 text-sm text-slate-700">{attention.reasons.map((reason, index) => <li key={`${reason.code}-${index}`}>{reason.text}</li>)}</ul> : <p className="text-sm text-slate-600">No operational reasons are currently listed.</p>}<div><h3 className="text-xs font-semibold text-slate-500">Suggested operational action</h3><p className="mt-1 text-sm text-slate-900">{attention?.suggestedAction ?? 'No action currently suggested.'}</p></div><p className="text-xs font-semibold text-slate-800">Operational workflow rule, not a clinical risk assessment.</p></div></Card>

      <div className="grid gap-4 lg:grid-cols-2"><Card title="Referrals" headingLevel={2}>{detail.referrals.length ? <ul className="space-y-3">{detail.referrals.map((referral) => <li key={referral.id} className="rounded-lg border border-slate-200 p-3"><p className="font-semibold text-slate-900">{referral.toProvider.name}</p><p className="text-sm text-slate-700">{referral.status}{referral.respondedAt ? ` · responded ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dubai' }).format(new Date(referral.respondedAt))}` : ''}</p>{referral.reason && <p className="mt-1 text-sm text-slate-600">{referral.reason}</p>}{referral.rejectionReason && <p className="mt-1 text-sm text-rose-800">Reason: {referral.rejectionReason}</p>}</li>)}</ul> : <EmptyState title="No referrals recorded" />}</Card>
        <Card title="Appointments" headingLevel={2}>{detail.appointments.length ? <ul className="space-y-3">{detail.appointments.map((appointment) => <li key={appointment.id} className="rounded-lg border border-slate-200 p-3"><p className="font-semibold text-slate-900">{new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dubai' }).format(new Date(appointment.scheduledAt))} (Asia/Dubai)</p><p className="text-sm text-slate-700">{appointment.status}</p>{appointment.location && <p className="text-sm text-slate-600">{appointment.location}</p>}</li>)}</ul> : <EmptyState title="No appointments recorded" />}</Card></div>

      <Card title="Explanations" headingLevel={2}>{explanations?.items.length ? <ul className="space-y-3">{explanations.items.map((item) => { const status = item.stale || item.current === false ? 'STALE' : item.status; return <li key={item.id} className="rounded-lg border border-slate-200 p-3"><div className="flex flex-wrap justify-between gap-2"><p className="font-semibold text-slate-900">{item.language}</p><span className="rounded-full border border-slate-300 px-2 py-0.5 text-xs font-semibold">{status}</span></div><p className="mt-2 whitespace-pre-line text-sm text-slate-700">{item.text}</p></li>; })}</ul> : <EmptyState title="No explanations recorded" />}</Card>

      <Card title="Staff timeline" headingLevel={2}>{events.length ? <ol className="space-y-3">{events.map((event) => <li key={event.id} className="border-s-2 border-slate-300 ps-4"><p className="font-semibold text-slate-900">{event.type.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())}</p><p className="text-xs text-slate-600">{event.actorName ?? (event.actorType === 'SYSTEM' ? 'System' : 'Unknown actor')} · <time dateTime={event.createdAt}>{new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dubai' }).format(new Date(event.createdAt))} (Asia/Dubai)</time></p><EventPayload payload={event.payload} /></li>)}</ol> : <EmptyState title="No events recorded" />}</Card>
    </div>
  </ShellLayout>;
}

export default function DoctorCasePage() { return <RoleGuard allowedRole="DOCTOR"><DoctorCaseDetail /></RoleGuard>; }
