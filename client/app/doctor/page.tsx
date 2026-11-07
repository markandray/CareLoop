'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AttentionQueuePageSchema, CaseCursorPageSchema, CaseDetailDoctorSchema, type AttentionQueuePage, type CaseCursorPage, type CaseDetailDoctor, type CaseListItem, type Urgency } from '@careloop/shared';
import { apiFetch } from '../../lib/api';
import { RoleGuard } from '../../lib/session';
import { ShellLayout } from '../../components/ShellLayout';
import { AttentionBadge, Button, EmptyState, ErrorBanner, Spinner, StateBadge } from '../../components/ui';
import { filterWorklist, formatDueTime, getWorklistTab, sortWorklist, type DoctorWorklistTab } from '../../lib/doctor-worklist';

type WorklistCase = CaseListItem & { detail: CaseDetailDoctor };
const tabs: Array<{ id: DoctorWorklistTab; label: string }> = [
  { id: 'needs-review', label: 'Needs review' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'closed', label: 'Closed' },
];

function DoctorWorklist() {
  const [rows, setRows] = useState<WorklistCase[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [tab, setTab] = useState<DoctorWorklistTab>('needs-review');
  const [urgency, setUrgency] = useState<Urgency | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [serverNow, setServerNow] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(async (nextCursor: string | null, append: boolean) => {
    if (append) setMoreLoading(true);
    else setLoading(true);
    try {
      const query = new URLSearchParams({ limit: '25' });
      if (nextCursor) query.set('cursor', nextCursor);
      const [casePage, attentionPage] = await Promise.all([
        apiFetch<CaseCursorPage>(`/api/v1/cases?${query}`, { method: 'GET', schema: CaseCursorPageSchema }),
        apiFetch<AttentionQueuePage>('/api/v1/attention/cases?limit=100', { method: 'GET', schema: AttentionQueuePageSchema }),
      ]);
      const attentionById = new Map(attentionPage.items.map((item) => [item.caseId, { level: item.attentionLevel, score: item.score }]));
      const enriched = casePage.items.map((item) => ({ ...item, attention: attentionById.get(item.id) ?? item.attention })) as CaseListItem[];
      const details = await Promise.all(enriched.map(async (item) => {
        const detail = await apiFetch<CaseDetailDoctor>(`/api/v1/cases/${encodeURIComponent(item.id)}`, { method: 'GET', schema: CaseDetailDoctorSchema });
        return { ...item, detail };
      }));
      setRows((existing) => append ? [...existing, ...details] : details);
      setCursor(casePage.nextCursor);
      setHasMore(Boolean(casePage.nextCursor));
      setServerNow(attentionPage.updatedAt);
      setError(null);
    } catch {
      setError('We could not load the worklist. Check your connection and try again.');
    } finally {
      setLoading(false);
      setMoreLoading(false);
    }
  }, []);

  useEffect(() => { void loadPage(null, false); }, [loadPage]);

  const visibleRows = useMemo(() => {
    const byTab = rows.filter((row) => getWorklistTab(row.state) === tab);
    const filtered = filterWorklist(byTab.map((row) => ({ ...row, urgencyLabel: row.urgencyLabel ?? row.detail.intakeUrgency, patient: row.detail.patient })), urgency, search);
    return sortWorklist(filtered);
  }, [rows, tab, urgency, search]);

  return <ShellLayout headerAction={<Link href="/doctor/cases/new" className="rounded-lg bg-teal-800 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">Create case</Link>}>
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 tabIndex={-1} className="text-2xl font-bold tracking-tight text-slate-900">Doctor worklist</h1><p className="mt-1 text-sm text-slate-600">Provider cases ordered by operational attention and due time.</p></div>
      </header>
      {error && <ErrorBanner message={error} />}
      <div role="tablist" aria-label="Case worklist" className="flex flex-wrap gap-2">
        {tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={`rounded-lg border px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 ${tab === item.id ? 'border-teal-800 bg-teal-50 text-teal-900' : 'border-slate-300 bg-white text-slate-700'}`}>{item.label}<span className="ms-2 rounded-full bg-white px-2 py-0.5 text-xs">{rows.filter((row) => getWorklistTab(row.state) === item.id).length}</span></button>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-semibold text-slate-700">Search this provider page<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Case ID, patient, or MRN" className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700" /></label>
        <label className="space-y-1 text-xs font-semibold text-slate-700">Urgency<select value={urgency} onChange={(event) => setUrgency(event.target.value as Urgency | 'ALL')} className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700"><option value="ALL">All urgency</option><option value="ROUTINE">Routine</option><option value="URGENT">Urgent</option></select></label>
      </div>
      <p aria-live="polite" className="text-sm text-slate-600">{loading ? 'Loading cases…' : `${visibleRows.length} ${visibleRows.length === 1 ? 'case' : 'cases'} shown in ${tabs.find((item) => item.id === tab)?.label}.`}</p>
      {loading ? <div className="flex justify-center rounded-xl border border-slate-200 bg-white py-12"><Spinner label="Loading doctor worklist…" /></div> : visibleRows.length === 0 ? <EmptyState title="No cases in this view" description="Try another tab or adjust the urgency and search filters." /> : (
        <ul className="space-y-3">
          {visibleRows.map((row) => {
            const due = formatDueTime(row.dueAt, serverNow ?? row.updatedAt);
            const owner = row.owner.kind === 'USER' ? row.owner.name : row.owner.kind === 'QUEUE' ? `${row.owner.role} queue` : 'Unassigned';
            return <li key={row.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><Link href={`/doctor/cases/${encodeURIComponent(row.id)}`} className="font-semibold text-teal-900 underline decoration-teal-300 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">{row.id}</Link><p className="mt-1 text-sm font-medium text-slate-900">{row.detail.patient.name}</p><p className="text-xs text-slate-600">MRN {row.detail.patient.syntheticMrn}</p></div>
                <div className="flex flex-wrap items-center gap-2"><StateBadge state={row.state} /><AttentionBadge level={row.attention?.level ?? 'LOW'} score={row.attention?.score ?? 0} /></div>
              </div>
              <dl className="mt-3 grid gap-2 text-xs text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="font-semibold">Urgency</dt><dd>{row.urgencyLabel ?? `Intake ${row.detail.intakeUrgency} · awaiting clinician confirmation`}</dd></div>
                <div><dt className="font-semibold">Owner</dt><dd>{owner}</dd></div>
                <div><dt className="font-semibold">Due</dt><dd className={due.overdue ? 'font-semibold text-rose-800' : ''}>{due.relative}<span className="block font-normal text-slate-500">{due.dubai} (Asia/Dubai)</span></dd></div>
                <div><dt className="font-semibold">Escalation</dt><dd>{row.escalationLevel === 'LEVEL_0' ? 'None' : row.escalationLevel.replace('_', ' ')}</dd></div>
              </dl>
            </li>;
          })}
        </ul>
      )}
      {hasMore && <div className="flex justify-center"><Button type="button" variant="secondary" disabled={moreLoading} onClick={() => void loadPage(cursor, true)}>{moreLoading ? 'Loading…' : 'Load more'}</Button></div>}
    </div>
  </ShellLayout>;
}

export default function DoctorPage() { return <RoleGuard allowedRole="DOCTOR"><DoctorWorklist /></RoleGuard>; }
