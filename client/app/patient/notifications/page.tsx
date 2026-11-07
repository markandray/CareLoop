'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  type AcknowledgeNotificationResponse,
  type NotificationCursorPage,
  AcknowledgeNotificationResponseSchema,
} from '@careloop/shared';
import { ApiError, apiFetch } from '../../../lib/api';
import { RoleGuard } from '../../../lib/session';
import { useT } from '../../../lib/i18n/context';
import { ShellLayout } from '../../../components/ShellLayout';
import { ReviewNoticeBanner } from '../../../components/ReviewNoticeBanner';
import { Card, EmptyState, ErrorBanner, Spinner } from '../../../components/ui';
import { formatPatientDateTime, getPatientErrorMessageKey, isNotificationAcknowledgementEnabled } from '../../../lib/patient-portal';
import { loadPatientNotifications, PATIENT_NOTIFICATIONS_CHANGED_EVENT } from '../../../lib/patient-notifications';

function PatientNotifications() {
  const { t, language } = useT();
  const [items, setItems] = useState<NotificationCursorPage['items'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<import('../../../lib/i18n/en').TranslationKey | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      try {
        const result = await loadPatientNotifications();
        if (isMounted) { setItems(result); setErrorKey(null); }
      } catch (error) {
        if (isMounted) setErrorKey(getPatientErrorMessageKey(error instanceof ApiError ? error.code : 'NETWORK_ERROR', error instanceof ApiError ? error.status : 0));
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    void load();
    return () => { isMounted = false; };
  }, []);

  const markSeen = async (notificationId: string) => {
    setPendingId(notificationId);
    setErrorKey(null);
    try {
      const result = await apiFetch<AcknowledgeNotificationResponse>(`/api/v1/notifications/${encodeURIComponent(notificationId)}/acknowledge`, {
        method: 'POST', body: {}, schema: AcknowledgeNotificationResponseSchema,
      });
      setItems((current) => current?.map((item) => item.id === notificationId ? { ...item, acknowledgedAt: result.acknowledgedAt } : item) ?? null);
      window.dispatchEvent(new Event(PATIENT_NOTIFICATIONS_CHANGED_EVENT));
    } catch (error) {
      setErrorKey(getPatientErrorMessageKey(error instanceof ApiError ? error.code : 'NETWORK_ERROR', error instanceof ApiError ? error.status : 0));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <ShellLayout>
      <div className="space-y-6">
        <ReviewNoticeBanner />
        <header>
          <h1 tabIndex={-1} className="text-2xl font-bold tracking-tight text-slate-900">{t('patient_notificationsTitle')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('patient_notificationsIntro')}</p>
        </header>
        {errorKey && <ErrorBanner title={t('errorTitle')} message={t(errorKey)} />}
        {loading ? (
          <div aria-live="polite" className="flex justify-center rounded-xl border border-slate-200 bg-white py-12"><Spinner label={t('loading')} /></div>
        ) : items?.length ? (
          <section aria-label={t('patient_notificationsTitle')} className="space-y-3">
            {items.map((notification) => (
              <Card key={notification.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="text-sm leading-6 text-slate-800">{notification.text}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-800">{t(`patient_notificationStatus_${notification.status}`)}</span>
                    {notification.status === 'SENT' && <span className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-800">{t(notification.acknowledgedAt ? 'patient_notificationSeen' : 'patient_notificationUnread')}</span>}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <time className="text-xs text-slate-600" dateTime={notification.sentAt ?? notification.createdAt}>{formatPatientDateTime(notification.sentAt ?? notification.createdAt, language)}</time>
                  <Link href={`/patient/cases/${encodeURIComponent(notification.caseId)}`} className="text-sm font-medium text-teal-800 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">{t('patient_openCase')} {notification.caseId}</Link>
                </div>
                {notification.acknowledgedAt && <p className="mt-2 text-xs text-slate-600">{t('patient_notificationSeenAt')} <time dateTime={notification.acknowledgedAt}>{formatPatientDateTime(notification.acknowledgedAt, language)}</time></p>}
                {notification.status === 'SENT' && !notification.acknowledgedAt && <div className="mt-3"><button type="button" onClick={() => void markSeen(notification.id)} disabled={!isNotificationAcknowledgementEnabled(notification, pendingId !== null)} className="rounded-lg border border-teal-800 bg-white px-4 py-2 text-sm font-semibold text-teal-900 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 disabled:cursor-not-allowed disabled:opacity-50">{pendingId === notification.id ? t('patient_markingSeen') : t(notification.templateKey === 'result_reviewed' ? 'patient_markSeen_result_reviewed' : 'patient_markSeen')}</button></div>}
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
