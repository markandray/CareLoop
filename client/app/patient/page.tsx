'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  type CaseCursorPage,
  type CaseDetailPatient,
  type NotificationCursorPage,
  CaseCursorPageSchema,
  CaseDetailPatientSchema,
  NotificationCursorPageSchema,
} from '@careloop/shared';
import { apiFetch } from '../../lib/api';
import { RoleGuard } from '../../lib/session';
import { useT } from '../../lib/i18n/context';
import { ShellLayout } from '../../components/ShellLayout';
import { ReviewNoticeBanner } from '../../components/ReviewNoticeBanner';
import { Card, EmptyState, ErrorBanner, Spinner } from '../../components/ui';
import { formatPatientDateTime, getPatientProgress } from '../../lib/patient-portal';

function PatientDashboard() {
  const { t, language } = useT();
  const [cases, setCases] = useState<CaseDetailPatient[] | null>(null);
  const [unreadByCase, setUnreadByCase] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      try {
        setLoading(true);
        const [casePage, notifications] = await Promise.all([
          apiFetch<CaseCursorPage>('/api/v1/cases?limit=100', {
            method: 'GET', schema: CaseCursorPageSchema,
          }),
          apiFetch<NotificationCursorPage>('/api/v1/notifications?limit=100', {
            method: 'GET', schema: NotificationCursorPageSchema,
          }),
        ]);
        const details = await Promise.all(casePage.items.map((item) =>
          apiFetch<CaseDetailPatient>(`/api/v1/cases/${encodeURIComponent(item.id)}`, {
            method: 'GET', schema: CaseDetailPatientSchema,
          }),
        ));
        if (isMounted) {
          setCases(details);
          // The API has no per-notification read flag. SENT is the available proxy
          // until acknowledgement state is exposed by the contract.
          setUnreadByCase(notifications.items.reduce<Record<string, number>>((counts, item) => {
            if (item.status === 'SENT') counts[item.caseId] = (counts[item.caseId] ?? 0) + 1;
            return counts;
          }, {}));
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
  }, []);

  return (
    <ShellLayout>
      <div className="space-y-6">
        <ReviewNoticeBanner />
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t('patient_casesTitle')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('patient_casesIntro')}</p>
        </header>
        {error && <ErrorBanner title={t('errorTitle')} message={t('patient_casesError')} />}
        {loading ? (
          <div aria-live="polite" className="flex justify-center rounded-xl border border-slate-200 bg-white py-12">
            <Spinner label={t('loading')} />
          </div>
        ) : cases?.length ? (
          <section aria-label={t('patient_casesTitle')} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {cases.map((item) => (
              <Link key={item.id} href={`/patient/cases/${encodeURIComponent(item.id)}`} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">
                <Card className="h-full transition-shadow hover:shadow-md">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h2 className="text-lg font-semibold text-slate-900">{item.id}</h2>
                    {(unreadByCase[item.id] ?? 0) > 0 && <span className="rounded-full border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-900"><span>{unreadByCase[item.id]}</span> {t('patient_unreadBadge')}</span>}
                  </div>
                  <p className="mt-2 inline-flex rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-800">{item.state === 'CLOSED' ? t(getPatientProgress(item.state, item.closureReason).closureLabel as never) : t(`patient_status_${item.state}`)}</p>
                  <div className="mt-4">
                    <h3 className="text-sm font-semibold text-slate-800">{t('patient_nextStep')}</h3>
                    <p className="mt-1 text-sm text-slate-700">{item.recommendedNextStep ?? item.statusDescription}</p>
                  </div>
                  <p className="mt-4 text-xs text-slate-600">{t('patient_lastUpdate')}: <time dateTime={item.updatedAt}>{formatPatientDateTime(item.updatedAt, language)}</time></p>
                </Card>
              </Link>
            ))}
          </section>
        ) : (
          <EmptyState title={t('patient_noCases')} description={t('patient_noCasesDescription')} />
        )}
      </div>
    </ShellLayout>
  );
}

export default function PatientPage() {
  return <RoleGuard allowedRole="PATIENT"><PatientDashboard /></RoleGuard>;
}
