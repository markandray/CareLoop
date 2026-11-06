'use client';

import React from 'react';
import { AuthProvider } from '../lib/session';
import { I18nProvider } from '../lib/i18n/context';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <I18nProvider>{children}</I18nProvider>
    </AuthProvider>
  );
}
