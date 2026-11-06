'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  type NotificationCursorPage,
  NotificationCursorPageSchema,
} from '@careloop/shared';
import { apiFetch } from '../../../lib/api';
import { RoleGuard } from '../../../lib/session';
import { useT } from '../../../lib/i18n/context';
import { ShellLayout } from '../../../components/ShellLayout';
import { ReviewNoticeBanner } from '../../../components/ReviewNoticeBanner';
import { Card, EmptyState, ErrorBanner, Spinner } from '../../../components/ui';
import { formatPatientDateTime } from '../../../lib/patient-portal';

function PatientNotifications() {
  const { t, language } = useT();
  const [data, setData] = useState<NotificationCursorPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      try {
        const result = await apiFetch<NotificationCursorPage>('/api/v1/notifications?limit=100', {
          method: 'GET', schema: NotificationCursorPageSchema,
        });
        if (isMounted) { setData(result); setError(false); }
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
          <h1 tabIndex={-1} className="text-2xl font-bold tracking-tight text-slate-900">{t('patient_notificationsTitle')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('patient_notificationsIntro')}</p>
        </header>
        {error && <ErrorBanner title={t('errorTitle')} message={t('patient_notificationsError')} />}
        {loading ? (
          <div aria-live="polite" className="flex justify-center rounded-xl border border-slate-200 bg-white py-12"><Spinner label={t('loading')} /></div>
        ) : data?.items.length ? (
          <section aria-label={t('patient_notificationsTitle')} className="space-y-3">
            {data.items.map((notification) => (
              <Card key={notification.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="text-sm leading-6 text-slate-800">{notification.text}</p>
                  <span className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-800">{t(`patient_notificationStatus_${notification.status}`)}</span>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <time className="text-xs text-slate-600" dateTime={notification.sentAt ?? notification.createdAt}>{formatPatientDateTime(notification.sentAt ?? notification.createdAt, language)}</time>
                  <Link href={`/patient/cases/${encodeURIComponent(notification.caseId)}`} className="text-sm font-medium text-teal-800 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">{t('patient_openCase')} {notification.caseId}</Link>
                </div>
              </Card>
            ))}
          </section>
        ) : <EmptyState title={t('patient_noNotifications')} description={t('patient_noNotificationsDescription')} />}
      </div>
    </ShellLayout>
  );
}

export default function PatientNotificationsPage() {
  return <RoleGuard allowedRole="PATIENT"><PatientNotifications /></RoleGuard>;
}
