'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '../../lib/api';
import { getRoleLandingRoute } from '../../lib/auth';
import { useSession } from '../../lib/session';

interface DemoAccount {
  role: string;
  name: string;
  email: string;
  provider?: string;
  language?: string;
}

const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    role: 'DOCTOR',
    name: 'Dr. Fatima Al-Hashimi',
    email: 'doctor.screening@careloop.local',
    provider: 'Screening Centre',
  },
  {
    role: 'DOCTOR',
    name: 'Dr. Tariq Mansoor',
    email: 'doctor.hospital@careloop.local',
    provider: 'Hospital',
  },
  {
    role: 'COORDINATOR',
    name: 'Sara Al-Zaabi',
    email: 'coordinator.screening@careloop.local',
    provider: 'Screening Centre',
  },
  {
    role: 'COORDINATOR',
    name: 'Zaid Al-Husseini',
    email: 'coordinator.hospital@careloop.local',
    provider: 'Hospital',
  },
  {
    role: 'ADMIN',
    name: 'CareLoop Administrator',
    email: 'admin@careloop.local',
  },
  {
    role: 'PATIENT',
    name: 'John Miller (English)',
    email: 'patient.en@careloop.local',
    language: 'EN',
  },
  {
    role: 'PATIENT',
    name: 'Noura Al-Nuaimi (Arabic)',
    email: 'patient.ar@careloop.local',
    language: 'AR',
  },
];

export default function LoginPage() {
  const { user, login } = useSession();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // If already authenticated, redirect to landing route
  useEffect(() => {
    if (user) {
      router.replace(getRoleLandingRoute(user.role));
    }
  }, [user, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSubmitting(true);

    try {
      const loggedInUser = await login(email, password);
      router.replace(getRoleLandingRoute(loggedInUser.role));
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.code === 'RATE_LIMITED' || err.status === 429) {
          setErrorMessage(
            'Too many failed login attempts. Please try again later.'
          );
        } else if (err.code === 'UNAUTHENTICATED' || err.status === 401) {
          setErrorMessage('Invalid email or password');
        } else if (err.code === 'VALIDATION_ERROR' || err.status === 400) {
          setErrorMessage('Please enter a valid email and password.');
        } else {
          setErrorMessage(err.message || 'An unexpected error occurred. Please try again.');
        }
      } else {
        setErrorMessage('Invalid email or password');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

  const defaultDemoPassword =
    process.env.NEXT_PUBLIC_DEMO_PASSWORD || 'CareLoopDemo2026!';

  const handleFillDemo = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword(defaultDemoPassword);
    setErrorMessage(null);
  };

  return (
    <div className="flex min-h-screen flex-col justify-center bg-slate-50 py-12 sm:ps-6 sm:pe-6 lg:ps-8 lg:pe-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h1 className="text-center text-3xl font-bold tracking-tight text-slate-900">
          CareLoop
        </h1>
        <p className="mt-2 text-center text-sm text-slate-600">
          Screening-to-care coordination platform
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white ps-6 pe-6 py-8 shadow-sm rounded-xl border border-slate-200 sm:ps-10 sm:pe-10">
          <form className="space-y-6" onSubmit={handleSubmit} noValidate>
            {errorMessage && (
              <div
                role="alert"
                aria-live="polite"
                className="rounded-lg bg-rose-50 border border-rose-200 p-4 text-sm text-rose-800"
              >
                {errorMessage}
              </div>
            )}

            <div>
              <label
                htmlFor="login-email"
                className="block text-sm font-medium text-slate-700"
              >
                Email address
              </label>
              <div className="mt-1">
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={submitting}
                  aria-describedby={errorMessage ? 'login-error-desc' : undefined}
                  className="block w-full rounded-lg border border-slate-300 ps-3 pe-3 py-2 text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:ring-offset-1 sm:text-sm disabled:opacity-50"
                  placeholder="name@example.com"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-sm font-medium text-slate-700"
              >
                Password
              </label>
              <div className="mt-1">
                <input
                  id="login-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                  className="block w-full rounded-lg border border-slate-300 ps-3 pe-3 py-2 text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:ring-offset-1 sm:text-sm disabled:opacity-50"
                  placeholder="Enter your password"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={submitting}
                className="flex w-full justify-center rounded-lg bg-teal-700 py-2.5 ps-4 pe-4 text-sm font-semibold text-white shadow-sm hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:opacity-60 transition-colors"
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <svg
                      className="h-4 w-4 animate-spin text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Signing in...
                  </span>
                ) : (
                  'Sign in'
                )}
              </button>
            </div>
          </form>

          {isDemoMode && (
            <div className="mt-8 border-t border-slate-200 pt-6">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Demo accounts
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Click an account to auto-fill credentials.
              </p>
              <div className="mt-3 space-y-2">
                {DEMO_ACCOUNTS.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    onClick={() => handleFillDemo(account.email)}
                    className="flex w-full items-center justify-between rounded-lg border border-slate-200 ps-3 pe-3 py-2 text-start text-xs hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors"
                  >
                    <div>
                      <span className="font-semibold text-slate-800">
                        {account.name}
                      </span>
                      <span className="ms-2 inline-flex items-center rounded-full bg-slate-100 ps-2 pe-2 py-0.5 text-[10px] font-medium text-slate-700">
                        {account.role}
                      </span>
                      <p className="text-[11px] text-slate-500">{account.email}</p>
                    </div>
                    <span className="text-teal-700 font-medium text-xs">Fill</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
