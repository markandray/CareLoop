'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Role } from '@careloop/shared';
import { useSession } from '../lib/session';
import { getProviderName } from '../lib/providers';
import { PatientLanguageToggle } from '../lib/i18n/context';
import { useT } from '../lib/i18n/context';
import { DemoClockBanner } from './DemoClockBanner';

interface NavItem {
  label: string;
  href: string;
  isPlanned?: boolean;
}

const ROLE_NAV_ITEMS: Record<Role, NavItem[]> = {
  PATIENT: [
    { label: 'Cases & Care Status', href: '/patient' },
    { label: 'Notifications', href: '/patient/notifications' },
    { label: 'Data Consent', href: '/patient/consent', isPlanned: true },
    { label: 'Clinical Consults', href: '/patient/consults', isPlanned: true },
  ],
  DOCTOR: [
    { label: 'Clinical Worklist', href: '/doctor' },
    { label: 'Attention Queue', href: '/doctor/attention', isPlanned: true },
    { label: 'Incoming Referrals', href: '/doctor/referrals', isPlanned: true },
    { label: 'Case Consults', href: '/doctor/consults', isPlanned: true },
  ],
  COORDINATOR: [
    { label: 'Attention Queue', href: '/coordinator' },
    { label: 'All Cases', href: '/coordinator/cases', isPlanned: true },
    { label: 'Dispatch Outbox', href: '/coordinator/notifications', isPlanned: true },
    { label: 'Appointments', href: '/coordinator/appointments', isPlanned: true },
  ],
  ADMIN: [
    { label: 'Operational KPIs', href: '/admin' },
    { label: 'Attention & Escalations', href: '/admin/attention', isPlanned: true },
    { label: 'Cases Directory', href: '/admin/cases', isPlanned: true },
    { label: 'Cohort Simulation', href: '/admin/simulation', isPlanned: true },
    { label: 'Audit Trail', href: '/admin/audit', isPlanned: true },
  ],
};

export function ShellLayout({
  children,
  headerAction,
}: {
  children: React.ReactNode;
  headerAction?: React.ReactNode;
}) {
  const { user, logout } = useSession();
  const { t } = useT();
  const pathname = usePathname();
  const [providerName, setProviderName] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;
    if (user?.providerId) {
      void getProviderName(user.providerId).then((name) => {
        if (isMounted) setProviderName(name);
      });
    } else {
      setProviderName(null);
    }
    return () => {
      isMounted = false;
    };
  }, [user?.providerId]);

  if (!user) {
    return <>{children}</>;
  }

  const navItems = ROLE_NAV_ITEMS[user.role] ?? [];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col min-w-[360px]">
      <DemoClockBanner />

      {/* Main Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="ps-4 pe-4 sm:ps-6 sm:pe-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* Mobile menu button */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden inline-flex items-center justify-center p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
              aria-label="Toggle navigation menu"
              aria-expanded={mobileMenuOpen}
            >
              <svg
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                />
              </svg>
            </button>

            <Link href="/" className="flex items-center gap-2">
              <span className="text-xl font-bold tracking-tight text-teal-800">
                CareLoop
              </span>
              <span className="hidden sm:inline-block rounded-md bg-teal-50 ps-2 pe-2 py-0.5 text-xs font-medium text-teal-800 border border-teal-200">
                Screening-to-Care
              </span>
            </Link>
          </div>

          {/* User info, actions and logout */}
          <div className="flex items-center gap-2 sm:gap-4">
            <PatientLanguageToggle />
            {headerAction}

            <div className="hidden sm:flex flex-col text-end">
              <span className="text-sm font-semibold text-slate-900 leading-tight">
                {user.name}
              </span>
              <div className="flex items-center gap-1.5 justify-end text-xs text-slate-500">
                <span className="inline-flex items-center rounded bg-slate-100 ps-1.5 pe-1.5 py-0.5 text-[11px] font-medium text-slate-700">
                  {user.role}
                </span>
                {providerName && (
                  <span className="text-slate-600 truncate max-w-[140px]" title={providerName}>
                    • {providerName}
                  </span>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg border border-slate-300 bg-white ps-3 pe-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Desktop Sidebar */}
        <aside className="hidden md:block w-64 bg-white border-e border-slate-200 shrink-0">
          <div className="p-4 ps-4 pe-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 ps-3 pe-3 mb-2">
              Navigation
            </p>
            <nav className="space-y-1">
              {navItems.map((item) => {
                const isActive = pathname === item.href || (item.href === '/patient' && pathname.startsWith('/patient/cases/'));
                const label = user.role === 'PATIENT' && item.href === '/patient'
                  ? t('nav_casesAndTracker')
                  : user.role === 'PATIENT' && item.href === '/patient/notifications'
                    ? t('nav_notifications')
                    : item.label;
                return (
                  <div key={item.href}>
                    {item.isPlanned ? (
                      <div className="flex items-center justify-between rounded-lg ps-3 pe-3 py-2 text-sm font-medium text-slate-400 cursor-not-allowed">
                        <span>{label}</span>
                        <span className="text-[10px] uppercase font-semibold bg-slate-100 text-slate-500 rounded ps-1.5 pe-1.5 py-0.5">
                          Planned
                        </span>
                      </div>
                    ) : (
                      <Link
                        href={item.href}
                        className={`flex items-center justify-between rounded-lg ps-3 pe-3 py-2 text-sm font-medium transition-colors ${
                          isActive
                            ? 'bg-teal-50 text-teal-800 font-semibold'
                            : 'text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <span>{label}</span>
                        {isActive && (
                          <span className="h-1.5 w-1.5 rounded-full bg-teal-600" />
                        )}
                      </Link>
                    )}
                  </div>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* Mobile Sidebar Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-40 md:hidden flex">
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-slate-900/50"
              onClick={() => setMobileMenuOpen(false)}
              aria-hidden="true"
            />
            {/* Drawer */}
            <div className="relative flex-1 flex flex-col max-w-xs w-full bg-white shadow-xl z-50">
              <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-900">{user.name}</p>
                  <p className="text-xs text-slate-500">{user.role}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                  aria-label="Close navigation menu"
                >
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-1">
                {navItems.map((item) => {
                  const isActive = pathname === item.href || (item.href === '/patient' && pathname.startsWith('/patient/cases/'));
                  const label = user.role === 'PATIENT' && item.href === '/patient'
                    ? t('nav_casesAndTracker')
                    : user.role === 'PATIENT' && item.href === '/patient/notifications'
                      ? t('nav_notifications')
                      : item.label;
                  return (
                    <div key={item.href}>
                      {item.isPlanned ? (
                        <div className="flex items-center justify-between rounded-lg ps-3 pe-3 py-2 text-sm font-medium text-slate-400">
                          <span>{label}</span>
                          <span className="text-[10px] uppercase font-semibold bg-slate-100 text-slate-500 rounded ps-1.5 pe-1.5 py-0.5">
                            Planned
                          </span>
                        </div>
                      ) : (
                        <Link
                          href={item.href}
                          onClick={() => setMobileMenuOpen(false)}
                          className={`flex items-center justify-between rounded-lg ps-3 pe-3 py-2 text-sm font-medium ${
                            isActive
                              ? 'bg-teal-50 text-teal-800 font-semibold'
                              : 'text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <span>{label}</span>
                          {isActive && (
                            <span className="h-1.5 w-1.5 rounded-full bg-teal-600" />
                          )}
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Main Content */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8">
          <div className="max-w-6xl mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}
