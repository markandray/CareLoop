'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { z } from 'zod';
import {
  type CaseDetailPatient,
  type CaseEventPatientListItem,
  type CaseEventPatientCursorPage,
  type PatientEventLabelKey,
  CaseEventDtoPatientSchema,
  CaseDetailPatientSchema,
  ConfirmUnderstandingRequestSchema,
  CaseEventPatientCursorPageSchema,
  ExplanationDtoSchema,
} from '@careloop/shared';
import { ApiError, apiFetch } from '../../../../lib/api';
import { RoleGuard } from '../../../../lib/session';
import { useT } from '../../../../lib/i18n/context';
import { ShellLayout } from '../../../../components/ShellLayout';
import { ReviewNoticeBanner } from '../../../../components/ReviewNoticeBanner';
import { Card, EmptyState, ErrorBanner, Spinner } from '../../../../components/ui';
import { canConfirmUnderstanding, canDeclineCare, formatPatientDateTime, getPatientErrorMessageKey, getPatientProgress, isDeclineReasonValid, type PatientProgressStep } from '../../../../lib/patient-portal';

const ExplanationPageSchema = z.object({ items: z.array(ExplanationDtoSchema) }).strict();
type ExplanationPage = z.infer<typeof ExplanationPageSchema>;
const UnderstandingResponseSchema = z.object({ case: CaseDetailPatientSchema, event: CaseEventDtoPatientSchema }).strict();
type UnderstandingResponse = z.infer<typeof UnderstandingResponseSchema>;

const steps: PatientProgressStep[] = ['review', 'plan', 'referral', 'appointment', 'care'];

const patientEventTranslationKey: Record<PatientEventLabelKey, string> = {
  CASE_RECEIVED: 'patient_event_CASE_RECEIVED',
  UNDER_REVIEW_COMPLETED: 'patient_event_UNDER_REVIEW_COMPLETED',
  UPDATE_SENT: 'patient_event_UPDATE_SENT',
  UPDATE_VIEWED: 'patient_event_UPDATE_VIEWED',
  UNDERSTANDING_CONFIRMED: 'patient_event_UNDERSTANDING_CONFIRMED',
  CONSENT_GRANTED: 'patient_event_CONSENT_GRANTED',
  CONSENT_REVOKED: 'patient_event_CONSENT_REVOKED',
  REFERRAL_STARTED: 'patient_event_REFERRAL_STARTED',
  REFERRAL_ACCEPTED: 'patient_event_REFERRAL_ACCEPTED',
  APPOINTMENT_BOOKED: 'patient_event_APPOINTMENT_BOOKED',
  APPOINTMENT_CHANGED: 'patient_event_APPOINTMENT_CHANGED',
  CARE_STARTED: 'patient_event_CARE_STARTED',
  CASE_CLOSED: 'patient_event_CASE_CLOSED',
  CARE_DECLINED_RECORDED: 'patient_event_CARE_DECLINED_RECORDED',
};

async function loadAllEvents(caseId: string): Promise<CaseEventPatientListItem[]> {
  const items: CaseEventPatientListItem[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const page: CaseEventPatientCursorPage = await apiFetch(
      `/api/v1/cases/${encodeURIComponent(caseId)}/events?${query.toString()}`,
      { method: 'GET', schema: CaseEventPatientCursorPageSchema },
    );
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

function PatientCaseDetail() {
  const params = useParams<{ id: string }>();
  const caseId = params.id;
  const { t, language } = useT();
  const [detail, setDetail] = useState<CaseDetailPatient | null>(null);
  const [explanations, setExplanations] = useState<ExplanationPage | null>(null);
  const [events, setEvents] = useState<CaseEventPatientListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [understandingPending, setUnderstandingPending] = useState(false);
  const [actionErrorKey, setActionErrorKey] = useState<import('../../../../lib/i18n/en').TranslationKey | null>(null);
  const [declineRecorded, setDeclineRecorded] = useState(false);
  const [declinePending, setDeclinePending] = useState(false);
  const [declineErrorKey, setDeclineErrorKey] = useState<import('../../../../lib/i18n/en').TranslationKey | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const declineDialogRef = useRef<HTMLDialogElement>(null);
  const declineTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      try {
        setLoading(true);
        const [caseData, explanationData, eventItems] = await Promise.all([
          apiFetch<CaseDetailPatient>(`/api/v1/cases/${encodeURIComponent(caseId)}`, {
            method: 'GET', schema: CaseDetailPatientSchema,
          }),
          apiFetch<ExplanationPage>(`/api/v1/cases/${encodeURIComponent(caseId)}/explanations`, {
            method: 'GET', schema: ExplanationPageSchema,
          }),
          loadAllEvents(caseId),
        ]);
        if (isMounted) {
          setDetail(caseData);
          setExplanations(explanationData);
          setEvents(eventItems);
          setError(false);
        }
      } catch {
        if (isMounted) setError(true);
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    void load();
    return () => { isMounted = false; };
  }, [caseId]);

  const explanationLanguage = language === 'AR' ? 'AR' : 'EN';
  const explanation = explanations?.items.find((item) => item.language === explanationLanguage && item.status === 'APPROVED' && item.current);
  const progress = detail ? getPatientProgress(detail.state, detail.closureReason) : null;
  const activeReferral = detail?.referrals.find((item) => item.status === 'PENDING' || item.status === 'ACCEPTED')
    ?? detail?.referrals[0];
  const appointment = [...(detail?.appointments ?? [])].sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))[0];

  const confirmUnderstanding = async () => {
    if (!explanation || !canConfirmUnderstanding(explanation, detail?.understandingConfirmedAt, understandingPending)) return;
    setUnderstandingPending(true);
    setActionErrorKey(null);
    try {
      const result = await apiFetch<UnderstandingResponse>(`/api/v1/cases/${encodeURIComponent(caseId)}/understanding`, {
        method: 'POST', body: ConfirmUnderstandingRequestSchema.parse({ explanationId: explanation.id }), schema: UnderstandingResponseSchema,
      });
      setDetail(result.case);
    } catch (error) {
      setActionErrorKey(getPatientErrorMessageKey(error instanceof ApiError ? error.code : 'NETWORK_ERROR', error instanceof ApiError ? error.status : 0));
    } finally {
      setUnderstandingPending(false);
    }
  };

  const openDeclineDialog = () => {
    setDeclineReason('');
    setDeclineErrorKey(null);
    declineDialogRef.current?.showModal();
  };

  const submitDecline = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail || !canDeclineCare(detail.state, declineRecorded, declinePending) || !isDeclineReasonValid(declineReason)) return;
    setDeclinePending(true);
    setDeclineErrorKey(null);
    try {
      await apiFetch(`/api/v1/cases/${encodeURIComponent(caseId)}/decline-care`, {
        method: 'POST', body: { reason: declineReason.trim() },
      });
      setDeclineRecorded(true);
      declineDialogRef.current?.close();
    } catch (error) {
      setDeclineErrorKey(error instanceof ApiError && error.status === 409 ? 'patient_declineConflict' : getPatientErrorMessageKey(error instanceof ApiError ? error.code : 'NETWORK_ERROR', error instanceof ApiError ? error.status : 0));
    } finally {
      setDeclinePending(false);
    }
  };

  return (
    <ShellLayout>
      <div className="space-y-6">
        <p><Link href="/patient" className="text-sm font-medium text-teal-800 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">{t('patient_backToCases')}</Link></p>
        <h1 tabIndex={-1} className="text-2xl font-bold tracking-tight text-slate-900">{t('patient_caseTitle')} {caseId}</h1>
        {error && <ErrorBanner title={t('errorTitle')} message={t('patient_caseError')} />}
        {actionErrorKey && <div aria-live="polite"><ErrorBanner title={t('errorTitle')} message={t(actionErrorKey)} /></div>}
        {declineErrorKey && !declineDialogRef.current?.open && <div aria-live="polite"><ErrorBanner title={t('errorTitle')} message={t(declineErrorKey)} /></div>}
        {loading ? (
          <div aria-live="polite" className="flex justify-center rounded-xl border border-slate-200 bg-white py-12"><Spinner label={t('loading')} /></div>
        ) : detail ? (
          <>
            <header>
              <p className="mt-2 inline-flex rounded-full border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-800">{progress?.closureLabel ? t(progress.closureLabel as never) : t(`patient_status_${detail.state}`)}</p>
              <p className="mt-2 text-sm text-slate-700">{progress?.closureLabel ? t(`patient_closureDescription_${detail.closureReason}` as never) : t(`patient_description_${detail.state}` as never)}</p>
            </header>

            <Card title={t('patient_progressTitle')} headingLevel={2}>
              <ol className="grid grid-cols-1 gap-3 sm:grid-cols-5" aria-label={t('patient_progressTitle')}>
                {steps.map((step, index) => {
                  const current = progress?.currentStep === step;
                  const complete = progress?.currentStep !== null && index < (progress?.completedSteps ?? 0);
                  return (
                    <li key={step} aria-current={current ? 'step' : undefined} className={`rounded-lg border px-3 py-3 text-sm ${current ? 'border-teal-700 bg-teal-50 text-teal-950' : complete ? 'border-slate-400 bg-slate-100 text-slate-800' : 'border-slate-200 bg-white text-slate-700'}`}>
                      <span className="font-semibold">{index + 1}. {t(`patient_step_${step}` as never)}</span>
                      <span className="mt-1 block text-xs">{progress?.closureLabel ? t('patient_stepNotActive') : current ? t('patient_currentStep') : complete ? t('patient_stepComplete') : t('patient_stepUpcoming')}</span>
                    </li>
                  );
                })}
              </ol>
              {progress?.closureLabel && <p className="mt-3 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800">{t('patient_closedTrackerNotice')}</p>}
            </Card>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <button ref={declineTriggerRef} type="button" disabled={!canDeclineCare(detail.state, declineRecorded, declinePending)} onClick={openDeclineDialog} className="rounded-lg border border-slate-400 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-700 disabled:cursor-not-allowed disabled:opacity-50">{t('patient_declineAction')}</button>
              {declineRecorded && <p role="status" className="mt-2 text-sm text-slate-700">{t('patient_declineRecorded')}</p>}
            </section>

            <dialog ref={declineDialogRef} onClose={() => declineTriggerRef.current?.focus()} aria-labelledby="patient-decline-title" aria-describedby="patient-decline-description" className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border border-slate-300 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/60">
              <form onSubmit={(event) => void submitDecline(event)} className="space-y-5 p-6">
                <div>
                  <h2 id="patient-decline-title" className="text-lg font-semibold">{t('patient_declineDialogTitle')}</h2>
                  <p id="patient-decline-description" className="mt-2 text-sm leading-6 text-slate-700">{t('patient_declineDialogDescription')}</p>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="patient-decline-reason" className="block text-sm font-medium text-slate-800">{t('patient_declineReasonLabel')}</label>
                  <textarea id="patient-decline-reason" required minLength={10} maxLength={300} rows={4} value={declineReason} onChange={(event) => setDeclineReason(event.target.value)} className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700" aria-describedby="patient-decline-reason-help" />
                  <p id="patient-decline-reason-help" className="text-xs text-slate-600">{t('patient_declineReasonHelp')}</p>
                </div>
                {declineErrorKey && <div role="alert" aria-live="polite" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{t(declineErrorKey)}</div>}
                <div className="flex flex-wrap justify-end gap-3">
                  <button type="button" onClick={() => declineDialogRef.current?.close()} disabled={declinePending} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 disabled:opacity-50">{t('cancel')}</button>
                  <button type="submit" disabled={!isDeclineReasonValid(declineReason) || !canDeclineCare(detail.state, declineRecorded, declinePending)} className="rounded-lg border border-rose-800 bg-rose-800 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-700 disabled:cursor-not-allowed disabled:opacity-50">{declinePending ? t('patient_declinePending') : t('patient_declineConfirm')}</button>
                </div>
              </form>
            </dialog>

            <Card title={t('patient_explanationTitle')} headingLevel={2}>
              {explanation ? (
                <div className="space-y-4">
                  {explanation.reviewNotice === 'UNREVIEWED_TRANSLATION' && <ReviewNoticeBanner forceShow />}
                  <div className="whitespace-pre-line text-sm leading-6 text-slate-800">{explanation.text}</div>
                  {explanation.doctorNoteSection && (
                    <aside className="rounded-lg border border-slate-300 bg-slate-50 p-4" aria-label={t('patient_noteNotTranslated')}>
                      <h3 className="text-sm font-semibold text-slate-900">{t('patient_noteNotTranslated')}</h3>
                      <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{explanation.doctorNoteSection.text}</p>
                    </aside>
                  )}
                  <div className="space-y-3 border-t border-slate-100 pt-4">
                    <p className="text-sm text-slate-700">{t('patient_understandingHelp')}</p>
                    {detail.understandingConfirmedAt ? (
                      <p className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800">{t('patient_confirmedOn')} <time dateTime={detail.understandingConfirmedAt}>{formatPatientDateTime(detail.understandingConfirmedAt, language)}</time></p>
                    ) : (
                      <button type="button" onClick={() => void confirmUnderstanding()} disabled={!canConfirmUnderstanding(explanation, detail.understandingConfirmedAt, understandingPending)} className="rounded-lg border border-teal-800 bg-teal-800 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 disabled:cursor-not-allowed disabled:opacity-50">{understandingPending ? t('patient_understandingPending') : t('patient_understandingButton')}</button>
                    )}
                  </div>
                </div>
              ) : <EmptyState title={t('patient_noExplanation')} description={t('patient_noExplanationDescription')} />}
            </Card>

            {(activeReferral || appointment) && (
              <Card title={t('patient_visitDetails')} headingLevel={2}>
                {activeReferral && <div className="mb-4"><h3 className="text-sm font-semibold text-slate-900">{t('patient_referralProvider')}</h3><p className="mt-1 text-sm text-slate-700">{activeReferral.toProvider.name}</p><p className="text-sm text-slate-600">{t(`patient_referralStatus_${activeReferral.status}` as never)}</p></div>}
                {appointment && <div><h3 className="text-sm font-semibold text-slate-900">{t('patient_appointment')}</h3><p className="mt-1 text-sm text-slate-700">{formatPatientDateTime(appointment.scheduledAt, language)}</p>{activeReferral && <p className="text-sm text-slate-700">{activeReferral.toProvider.name}</p>}{appointment.location && <p className="text-sm text-slate-700">{appointment.location}</p>}<p className="text-sm text-slate-600">{t(`patient_appointmentStatus_${appointment.status}` as never)}</p></div>}
              </Card>
            )}

            <section aria-labelledby="patient-timeline-heading">
              <h2 id="patient-timeline-heading" className="mb-3 text-lg font-semibold text-slate-900">{t('patient_timelineTitle')}</h2>
              {events.length ? <ol className="space-y-3 border-s-2 border-slate-300 ps-4">{events.map((event) => {
                const translationKey = patientEventTranslationKey[event.labelKey];
                return translationKey ? <li key={event.id} className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-sm font-medium text-slate-900">{t(translationKey as never)}</p><time className="mt-1 block text-xs text-slate-600" dateTime={event.timestamp}>{formatPatientDateTime(event.timestamp, language)}</time></li> : null;
              })}</ol> : <EmptyState title={t('patient_noEvents')} />}
            </section>
          </>
        ) : null}
      </div>
    </ShellLayout>
  );
}

export default function PatientCasePage() {
  return <RoleGuard allowedRole="PATIENT"><PatientCaseDetail /></RoleGuard>;
}
