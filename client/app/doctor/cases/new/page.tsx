'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { CreateCaseRequestSchema, PatientSearchPageSchema, type PatientSearchResult, type PatientSearchPage, type CreateCaseRequest, CaseIdSchema } from '@careloop/shared';
import { ApiError, apiFetch } from '../../../../lib/api';
import { useSession, RoleGuard } from '../../../../lib/session';
import { ShellLayout } from '../../../../components/ShellLayout';
import { Button, Card, ErrorBanner, FormField } from '../../../../components/ui';
import { getDoctorErrorMessage } from '../../../../lib/doctor-worklist';

const CreatedCaseSchema = z.object({ case: z.object({ id: CaseIdSchema }) });
type FieldErrors = Record<string, string>;

function validationErrors(details: unknown): FieldErrors {
  if (!details || typeof details !== 'object') return {};
  const result: FieldErrors = {};
  const value = details as { fieldErrors?: Record<string, unknown>; formErrors?: unknown[]; issues?: Array<{ path?: Array<string | number>; message?: string }> };
  if (value.fieldErrors) {
    for (const [key, messages] of Object.entries(value.fieldErrors)) if (Array.isArray(messages) && typeof messages[0] === 'string') result[key.replace(/^evidence\./, '')] = messages[0];
  }
  for (const issue of value.issues ?? []) {
    const key = issue.path?.at(-1);
    if (key && issue.message) result[String(key)] ??= issue.message;
  }
  return result;
}

function NewDoctorCase() {
  const router = useRouter();
  const { user } = useSession();
  const [query, setQuery] = useState('');
  const [patients, setPatients] = useState<PatientSearchResult[]>([]);
  const [selected, setSelected] = useState<PatientSearchResult | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [values, setValues] = useState({ pathway: '', screeningType: '', resultCategory: '', preliminarySummary: '', recommendedAction: '', intakeUrgency: 'ROUTINE' as const | 'URGENT' });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = 'patient-picker-options';

  useEffect(() => {
    if (selected || query.trim().length < 2) { setPatients([]); setSearching(false); setActiveIndex(-1); return; }
    let active = true;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ query: query.trim(), limit: '20' });
        const page: PatientSearchPage = await apiFetch(`/api/v1/patients?${params}`, { method: 'GET', schema: PatientSearchPageSchema });
        if (active) setPatients(page.items);
      } catch { if (active) setPatients([]); }
      finally { if (active) setSearching(false); }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, selected]);

  const activeOptionId = activeIndex >= 0 && patients[activeIndex] ? `${listId}-${activeIndex}` : undefined;
  const setField = (key: keyof typeof values, value: string) => setValues((previous) => ({ ...previous, [key]: value }));

  const choose = (patient: PatientSearchResult) => { setSelected(patient); setQuery(`${patient.displayName} · ${patient.syntheticMrn}`); setPatients([]); setActiveIndex(-1); setFieldErrors((previous) => ({ ...previous, patientId: '' })); };
  const onPickerKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && patients.length) { event.preventDefault(); setActiveIndex((index) => (index + 1) % patients.length); }
    if (event.key === 'ArrowUp' && patients.length) { event.preventDefault(); setActiveIndex((index) => (index <= 0 ? patients.length - 1 : index - 1)); }
    if (event.key === 'Enter' && activeIndex >= 0 && patients[activeIndex]) { event.preventDefault(); choose(patients[activeIndex]); }
    if (event.key === 'Escape') { setPatients([]); setActiveIndex(-1); }
  };

  const messages = useMemo(() => ({ access: 'This doctor account cannot create a case for the selected provider. Choose a patient and retry, or ask your provider administrator to check your access.', missing: 'The selected patient or provider could not be found. Search again and retry.', conflict: 'The case could not be created because related information changed. Refresh and try again.', validation: 'Please check the highlighted fields and try again.', session: 'Your session ended. Sign in again to continue.', 'rate-limit': 'Too many requests. Wait a moment and try again.', network: 'We could not connect. Check your connection and try again.', generic: 'We could not create this case. Please try again.' }), []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setFieldErrors({}); setError(null);
    if (!selected) { setFieldErrors({ patientId: 'Choose a patient from the search results.' }); inputRef.current?.focus(); return; }
    const candidate = { transitionKey: 'CREATE_CASE' as const, evidence: { patientId: selected.id, originProviderId: user?.providerId ?? '', ...(user?.id ? { assignedDoctorId: user.id } : {}), ...values } };
    const parsed = CreateCaseRequestSchema.safeParse(candidate);
    if (!parsed.success) {
      const next: FieldErrors = {};
      parsed.error.issues.forEach((issue) => { const key = issue.path.at(-1); if (key) next[String(key)] ??= issue.message; });
      setFieldErrors(next); setError('Please correct the highlighted fields.'); return;
    }
    setSaving(true);
    try {
      const request: CreateCaseRequest = parsed.data;
      const created = await apiFetch(`/api/v1/cases`, { method: 'POST', body: request, schema: CreatedCaseSchema });
      router.push(`/doctor/cases/${encodeURIComponent(created.case.id)}`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'VALIDATION_ERROR') {
        const next = validationErrors(cause.details);
        setFieldErrors(next);
        setError(Object.keys(next).length ? 'Please correct the highlighted fields.' : 'The request did not match the case requirements. Check the information and retry.');
      } else setError(messages[getDoctorErrorMessage(cause instanceof ApiError ? cause.code : 'NETWORK_ERROR', cause instanceof ApiError ? cause.status : 0)]);
    } finally { setSaving(false); }
  };

  return <ShellLayout><div className="space-y-5"><header><h1 tabIndex={-1} className="text-2xl font-bold tracking-tight text-slate-900">Create screening case</h1><p className="mt-1 text-sm text-slate-600">Enter synthetic screening intake details. The case will be assigned to your provider and doctor account.</p></header>{error && <ErrorBanner message={error} />}<Card title="Case intake" headingLevel={2}><form onSubmit={(event) => void submit(event)} className="space-y-4">
    <div className="relative"><label htmlFor="patient-search" className="block text-xs font-semibold text-slate-700">Patient <span className="text-rose-600">*</span></label><input ref={inputRef} id="patient-search" role="combobox" aria-autocomplete="list" aria-expanded={patients.length > 0} aria-controls={listId} aria-activedescendant={activeOptionId} value={query} onChange={(event) => { setQuery(event.target.value); setSelected(null); }} onKeyDown={onPickerKeyDown} placeholder="Search by name or MRN (2+ characters)" className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700" />{searching && <p className="mt-1 text-xs text-slate-500" role="status">Searching patients…</p>}{query.trim().length >= 2 && !selected && !searching && patients.length === 0 && <p className="mt-1 text-xs text-slate-600">No matching patients. Search the synthetic patient directory.</p>}{fieldErrors.patientId && <p role="alert" className="mt-1 text-xs text-rose-700">{fieldErrors.patientId}</p>}{patients.length > 0 && <ul id={listId} role="listbox" className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-300 bg-white py-1 shadow-lg">{patients.map((patient, index) => <li id={`${listId}-${index}`} key={patient.id} role="option" aria-selected={activeIndex === index} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(patient)} className={`cursor-pointer px-3 py-2 text-sm ${activeIndex === index ? 'bg-teal-50 text-teal-950' : 'text-slate-800 hover:bg-slate-50'}`}>{patient.displayName}<span className="ms-2 text-xs text-slate-500">{patient.syntheticMrn} · {patient.preferredLanguage}</span></li>)}</ul>}</div>
    <div className="grid gap-4 sm:grid-cols-2"><FormField id="pathway" label="Pathway" required error={fieldErrors.pathway}><input value={values.pathway} onChange={(event) => setField('pathway', event.target.value)} required maxLength={160} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></FormField><FormField id="screeningType" label="Screening type" required error={fieldErrors.screeningType}><input value={values.screeningType} onChange={(event) => setField('screeningType', event.target.value)} required maxLength={160} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></FormField><FormField id="resultCategory" label="Result category" required error={fieldErrors.resultCategory}><input value={values.resultCategory} onChange={(event) => setField('resultCategory', event.target.value)} required maxLength={160} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></FormField><FormField id="intakeUrgency" label="Intake urgency" required><select value={values.intakeUrgency} onChange={(event) => setField('intakeUrgency', event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="ROUTINE">Routine</option><option value="URGENT">Urgent</option></select></FormField></div>
    <FormField id="preliminarySummary" label="Preliminary summary" required error={fieldErrors.preliminarySummary}><textarea value={values.preliminarySummary} onChange={(event) => setField('preliminarySummary', event.target.value)} required maxLength={4000} rows={4} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></FormField><FormField id="recommendedAction" label="Recommended action" required error={fieldErrors.recommendedAction}><textarea value={values.recommendedAction} onChange={(event) => setField('recommendedAction', event.target.value)} required maxLength={2000} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></FormField>
    {error && fieldErrors.patientId && <p role="alert" className="text-sm text-rose-800">{fieldErrors.patientId}</p>}<div className="flex flex-wrap gap-3"><Button type="submit" loading={saving}>Create case</Button><Button type="button" variant="outline" onClick={() => router.push('/doctor')}>Cancel</Button></div>
  </form></Card></div></ShellLayout>;
}

export default function NewDoctorCasePage() { return <RoleGuard allowedRole="DOCTOR"><NewDoctorCase /></RoleGuard>; }
