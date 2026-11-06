'use client';

import React, { useEffect, useState } from 'react';
import {
  type CaseCursorPage,
  CaseCursorPageSchema,
} from '@careloop/shared';
import { apiFetch } from '../../lib/api';
import { RoleGuard, useSession } from '../../lib/session';
import { useT } from '../../lib/i18n/context';
import { ShellLayout } from '../../components/ShellLayout';
import { ReviewNoticeBanner } from '../../components/ReviewNoticeBanner';
import {
  Card,
  StateBadge,
  Spinner,
  EmptyState,
  ErrorBanner,
  Table,
} from '../../components/ui';

function PatientDashboard() {
  const { user } = useSession();
  const { t } = useT();
  const [data, setData] = useState<CaseCursorPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const loadCases = async () => {
      try {
        setLoading(true);
        const res = await apiFetch<CaseCursorPage>('/api/v1/cases', {
          method: 'GET',
          schema: CaseCursorPageSchema,
        });
        if (isMounted) {
          setData(res);
          setError(null);
        }
      } catch (err: unknown) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load cases');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void loadCases();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <ShellLayout>
      <div className="space-y-6">
        <ReviewNoticeBanner />

        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {t('landing_welcome')}, {user?.name}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {t('landing_patientPortalNotice')}
          </p>
        </div>

        {error && <ErrorBanner message={error} />}

        {/* Identity & Live Count Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card title={t('landing_sessionTitle')}>
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between">
                <dt className="text-slate-500">{t('emailLabel')}:</dt>
                <dd className="font-semibold text-slate-800">{user?.email}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">{t('role')}:</dt>
                <dd className="font-semibold text-slate-800">{user?.role}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">{t('language')}:</dt>
                <dd className="font-semibold text-slate-800">{user?.language}</dd>
              </div>
            </dl>
          </Card>

          <Card title={t('landing_casesCount')}>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tracking-tight text-teal-800">
                {loading ? '...' : (data?.items.length ?? 0)}
              </span>
              <span className="text-xs text-slate-500">active case(s)</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Personal patient records scoped strictly to your identity.
            </p>
          </Card>

          <Card title="API Status">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              <span className="text-xs font-semibold text-emerald-800">
                {t('landing_apiConnected')}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Endpoint: <code className="bg-slate-100 rounded ps-1 pe-1 py-0.5">/api/v1/cases</code>
            </p>
          </Card>
        </div>

        {/* Live Cases Table */}
        <div>
          <h2 className="text-base font-semibold text-slate-900 mb-3">
            {t('nav_casesAndTracker')}
          </h2>

          {loading ? (
            <div className="flex justify-center py-12 bg-white rounded-xl border border-slate-200">
              <Spinner label={t('loading')} />
            </div>
          ) : data && data.items.length > 0 ? (
            <Table headers={['Case ID', 'Care Status', 'Created', 'Last Updated']}>
              {data.items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                  <td className="ps-4 pe-4 py-3 font-semibold text-slate-900">
                    {item.id}
                  </td>
                  <td className="ps-4 pe-4 py-3">
                    <StateBadge state={item.state} patientFriendly={true} />
                  </td>
                  <td className="ps-4 pe-4 py-3 text-slate-500">
                    {new Date(item.createdAt).toLocaleDateString()}
                  </td>
                  <td className="ps-4 pe-4 py-3 text-slate-500">
                    {new Date(item.updatedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState
              title={t('landing_noCasesFound')}
              description="No screening cases have been registered for your account yet."
            />
          )}
        </div>
      </div>
    </ShellLayout>
  );
}

export default function PatientPage() {
  return (
    <RoleGuard allowedRole="PATIENT">
      <PatientDashboard />
    </RoleGuard>
  );
}
