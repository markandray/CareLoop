'use client';

import React, { useEffect, useState } from 'react';
import {
  type AttentionQueuePage,
  type CaseCursorPage,
  AttentionQueuePageSchema,
  CaseCursorPageSchema,
} from '@careloop/shared';
import { apiFetch } from '../../lib/api';
import { RoleGuard, useSession } from '../../lib/session';
import { ShellLayout } from '../../components/ShellLayout';
import {
  Card,
  AttentionBadge,
  StateBadge,
  Spinner,
  EmptyState,
  ErrorBanner,
  Table,
} from '../../components/ui';

function DoctorDashboard() {
  const { user } = useSession();
  const [attentionData, setAttentionData] = useState<AttentionQueuePage | null>(null);
  const [casesData, setCasesData] = useState<CaseCursorPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      try {
        setLoading(true);
        const [attentionRes, casesRes] = await Promise.all([
          apiFetch<AttentionQueuePage>('/api/v1/attention/cases', {
            method: 'GET',
            schema: AttentionQueuePageSchema,
          }),
          apiFetch<CaseCursorPage>('/api/v1/cases', {
            method: 'GET',
            schema: CaseCursorPageSchema,
          }),
        ]);

        if (isMounted) {
          setAttentionData(attentionRes);
          setCasesData(casesRes);
          setError(null);
        }
      } catch (err: unknown) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load doctor dashboard data');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void loadData();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <ShellLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Clinical Worklist & Attention
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Doctor portal: clinical case reviews, referrals, and attention queue.
          </p>
        </div>

        {error && <ErrorBanner message={error} />}

        {/* Identity & Live Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card title="Physician Identity">
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between">
                <dt className="text-slate-500">Doctor:</dt>
                <dd className="font-semibold text-slate-800">{user?.name}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Email:</dt>
                <dd className="font-semibold text-slate-800">{user?.email}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Role:</dt>
                <dd className="font-semibold text-slate-800">{user?.role}</dd>
              </div>
            </dl>
          </Card>

          <Card title="Attention Queue Cases">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tracking-tight text-amber-700">
                {loading ? '...' : (attentionData?.items.length ?? 0)}
              </span>
              <span className="text-xs text-slate-500">flagged items</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Live from <code className="bg-slate-100 rounded ps-1 pe-1 py-0.5">/api/v1/attention/cases</code>
            </p>
          </Card>

          <Card title="Provider Total Cases">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tracking-tight text-teal-800">
                {loading ? '...' : (casesData?.items.length ?? 0)}
              </span>
              <span className="text-xs text-slate-500">total cases</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Live from <code className="bg-slate-100 rounded ps-1 pe-1 py-0.5">/api/v1/cases</code>
            </p>
          </Card>
        </div>

        {/* Attention Queue Items */}
        <div>
          <h2 className="text-base font-semibold text-slate-900 mb-3">
            Priority Attention Items
          </h2>

          {loading ? (
            <div className="flex justify-center py-12 bg-white rounded-xl border border-slate-200">
              <Spinner label="Loading clinical worklist..." />
            </div>
          ) : attentionData && attentionData.items.length > 0 ? (
            <Table
              headers={[
                'Case ID',
                'Attention Level',
                'Workflow State',
                'Escalation',
                'Action Summary',
              ]}
            >
              {attentionData.items.map((item) => (
                <tr key={item.caseId} className="hover:bg-slate-50 transition-colors">
                  <td className="ps-4 pe-4 py-3 font-semibold text-slate-900">
                    {item.caseId}
                  </td>
                  <td className="ps-4 pe-4 py-3">
                    <AttentionBadge level={item.attentionLevel} score={item.score} />
                  </td>
                  <td className="ps-4 pe-4 py-3">
                    <StateBadge state={item.state} />
                  </td>
                  <td className="ps-4 pe-4 py-3 text-xs text-slate-600">
                    {item.escalationLevel}
                  </td>
                  <td className="ps-4 pe-4 py-3 text-xs text-slate-700 max-w-xs truncate">
                    {item.suggestedAction}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState
              title="Attention queue clear"
              description="No cases currently exceed operational SLA or drop-off risk thresholds."
            />
          )}
        </div>
      </div>
    </ShellLayout>
  );
}

export default function DoctorPage() {
  return (
    <RoleGuard allowedRole="DOCTOR">
      <DoctorDashboard />
    </RoleGuard>
  );
}

