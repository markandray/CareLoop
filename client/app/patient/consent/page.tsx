'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  type ConsentCursorPage,
  type ConsentDto,
  type ProviderCursorPage,
  ConsentCursorPageSchema,
  ConsentDtoSchema,
  GrantConsentRequestSchema,
  ProviderCursorPageSchema,
} from '@careloop/shared';
import { z } from 'zod';
import { ApiError, apiFetch } from '../../../lib/api';
import { RoleGuard } from '../../../lib/session';
import { useT } from '../../../lib/i18n/context';
import { ShellLayout } from '../../../components/ShellLayout';
import { Card, EmptyState, ErrorBanner, Spinner } from '../../../components/ui';
import { canGrantConsent, canRevokeConsent, formatPatientDateTime, getPatientErrorMessageKey } from '../../../lib/patient-portal';

const ConsentChangeResponseSchema = z.object({ consent: ConsentDtoSchema });
type ConsentChangeResponse = z.infer<typeof ConsentChangeResponseSchema>;
type Provider = ProviderCursorPage['items'][number];

async function loadProviders(): Promise<Provider[]> {
  const items: Provider[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const page = await apiFetch<ProviderCursorPage>(`/api/v1/providers?${query}`, { method: 'GET', schema: ProviderCursorPageSchema });
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

async function loadConsents(): Promise<ConsentDto[]> {
  const items: ConsentDto[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const page = await apiFetch<ConsentCursorPage>(`/api/v1/patients/me/consents?${query}`, { method: 'GET', schema: ConsentCursorPageSchema });
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

function PatientConsent() {
  const { t, language } = useT();
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [consents, setConsents] = useState<ConsentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<import('../../../lib/i18n/en').TranslationKey | null>(null);
  const [success, setSuccess] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ConsentDto | null>(null);
  const revokeDialogRef = useRef<HTMLDialogElement>(null);
  const dialogTriggerRef = useRef<HTMLButtonElement>(null);

  const refresh = async () => {
    const [providerItems, consentItems] = await Promise.all([loadProviders(), loadConsents()]);
    setProviders(providerItems);
    setConsents(consentItems);
  };

  useEffect(() => {
    let isMounted = true;
    void Promise.all([loadProviders(), loadConsents()]).then(([providerItems, consentItems]) => {
      if (isMounted) { setProviders(providerItems); setConsents(consentItems); setErrorKey(null); }
    }).catch((error: unknown) => {
      if (isMounted) setErrorKey(getPatientErrorMessageKey(error instanceof ApiError ? error.code : 'NETWORK_ERROR', error instanceof ApiError ? error.status : 0));
    }).finally(() => { if (isMounted) setLoading(false); });
    return () => { isMounted = false; };
  }, []);

  const currentConsent = (providerId: string) => consents.find((consent) => consent.providerId === providerId && consent.revokedAt === null)
    ?? consents.find((consent) => consent.providerId === providerId)
    ?? null;

  const grant = async (providerId: string) => {
    setPendingProviderId(providerId);
    setErrorKey(null);
    setSuccess(false);
    try {
      await apiFetch<ConsentChangeResponse>('/api/v1/patients/me/consents', {
        method: 'POST', body: GrantConsentRequestSchema.parse({ providerId, scope: 'CROSS_PROVIDER_REFERRAL' }), schema: ConsentChangeResponseSchema,
      });
      await refresh();
      setSuccess(true);
    } catch (error) {
      setErrorKey(getPatientErrorMessageKey(error instanceof ApiError ? error.code : 'NETWORK_ERROR', error instanceof ApiError ? error.status : 0));
    } finally {
      setPendingProviderId(null);
    }
  };

  const openRevokeDialog = (consent: ConsentDto, trigger: HTMLButtonElement) => {
    setRevokeTarget(consent);
    setErrorKey(null);
    setSuccess(false);
    dialogTriggerRef.current = trigger;
    revokeDialogRef.current?.showModal();
  };

  const revoke = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!revokeTarget || !canRevokeConsent(true, pendingProviderId !== null)) return;
    const providerId = revokeTarget.providerId;
    setPendingProviderId(providerId);
    setErrorKey(null);
    try {
      await apiFetch<ConsentChangeResponse>(`/api/v1/patients/me/consents/${encodeURIComponent(revokeTarget.id)}/revoke`, {
        method: 'POST', body: {}, schema: ConsentChangeResponseSchema,
      });
      revokeDialogRef.current?.close();
      setRevokeTarget(null);
      await refresh();
      setSuccess(true);
    } catch (error) {
      setErrorKey(getPatientErrorMessageKey(error instanceof ApiError ? error.code : 'NETWORK_ERROR', error instanceof ApiError ? error.status : 0));
    } finally {
      setPendingProviderId(null);
    }
  };

  return (
    <ShellLayout>
      <div className="space-y-6">
        <header>
          <h1 tabIndex={-1} className="text-2xl font-bold tracking-tight text-slate-900">{t('patient_consentTitle')}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-700">{t('patient_consentIntro')}</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">{t('patient_consentGrantInfo')}</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">{t('patient_consentRevokeInfo')}</p>
        </header>
        {errorKey && <div aria-live="polite"><ErrorBanner title={t('errorTitle')} message={t(errorKey)} /></div>}
        {success && <p role="status" aria-live="polite" className="rounded-lg border border-slate-300 bg-white p-3 text-sm font-medium text-slate-800">{t('patient_consentUpdated')}</p>}
        {loading ? (
          <div aria-live="polite" className="flex justify-center rounded-xl border border-slate-200 bg-white py-12"><Spinner label={t('loading')} /></div>
        ) : providers?.length ? (
          <section aria-label={t('patient_consentProviders')} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {providers.map((provider) => {
              const consent = currentConsent(provider.id);
              const active = consent?.revokedAt === null;
              const pending = pendingProviderId === provider.id;
              return (
                <Card key={provider.id}>
                  <h2 className="text-base font-semibold text-slate-900">{provider.name}</h2>
                  <p className="mt-2 text-sm text-slate-700">{t(active ? 'patient_consentActive' : consent ? 'patient_consentRevoked' : 'patient_consentNotGranted')}</p>
                  {active && <p className="mt-1 text-xs text-slate-600">{t('patient_consentSince')} {formatPatientDateTime(consent.grantedAt, language)}</p>}
                  <div className="mt-4">
                    {active && consent ? (
                      <button type="button" onClick={(event) => openRevokeDialog(consent, event.currentTarget)} disabled={!canRevokeConsent(true, pendingProviderId !== null)} className="rounded-lg border border-slate-400 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 disabled:cursor-not-allowed disabled:opacity-50">{pending ? t('patient_consentPending') : t('patient_consentRevoke')}</button>
                    ) : (
                      <button type="button" onClick={() => void grant(provider.id)} disabled={!canGrantConsent(false, pendingProviderId !== null)} className="rounded-lg border border-teal-800 bg-teal-800 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 disabled:cursor-not-allowed disabled:opacity-50">{pending ? t('patient_consentPending') : t('patient_consentGrant')}</button>
                    )}
                  </div>
                </Card>
              );
            })}
          </section>
        ) : <EmptyState title={t('patient_consentNoProviders')} description={t('patient_consentNoProvidersDescription')} />}

        <dialog ref={revokeDialogRef} onClose={() => dialogTriggerRef.current?.focus()} aria-labelledby="patient-consent-revoke-title" aria-describedby="patient-consent-revoke-description" className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border border-slate-300 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/60">
          <form onSubmit={(event) => void revoke(event)} className="space-y-5 p-6">
            <div>
              <h2 id="patient-consent-revoke-title" className="text-lg font-semibold">{t('patient_consentRevokeTitle')}</h2>
              <p id="patient-consent-revoke-description" className="mt-2 text-sm leading-6 text-slate-700">{t('patient_consentRevokeInfo')}</p>
            </div>
            {errorKey && <div role="alert" aria-live="polite" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{t(errorKey)}</div>}
            <div className="flex flex-wrap justify-end gap-3">
              <button type="button" onClick={() => revokeDialogRef.current?.close()} disabled={pendingProviderId !== null} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 disabled:opacity-50">{t('cancel')}</button>
              <button type="submit" disabled={!canRevokeConsent(Boolean(revokeTarget), pendingProviderId !== null)} className="rounded-lg border border-rose-800 bg-rose-800 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-700 disabled:cursor-not-allowed disabled:opacity-50">{pendingProviderId ? t('patient_consentPending') : t('patient_consentRevoke')}</button>
            </div>
          </form>
        </dialog>
      </div>
    </ShellLayout>
  );
}

export default function PatientConsentPage() {
  return <RoleGuard allowedRole="PATIENT"><PatientConsent /></RoleGuard>;
}
