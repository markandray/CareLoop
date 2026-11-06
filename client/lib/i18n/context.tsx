'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import type { Language } from '@careloop/shared';
import { useSession } from '../session';
import { en, type TranslationKey, type Translations } from './en';
import { ar } from './ar';

interface I18nContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  dir: 'ltr' | 'rtl';
  t: (key: TranslationKey) => string;
  isPatient: boolean;
}

const dictionaries: Record<'EN' | 'AR', Translations> = {
  EN: en,
  AR: ar,
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  const isPatient = user?.role === 'PATIENT';

  // Default from UserSession.language (OTHER uses EN). Non-patients are always EN.
  const computeInitialLanguage = useCallback((): Language => {
    if (!isPatient) return 'EN';
    return user?.language === 'AR' ? 'AR' : 'EN';
  }, [isPatient, user?.language]);

  const [language, setLanguageState] = useState<Language>(computeInitialLanguage);

  useEffect(() => {
    const nextLang = computeInitialLanguage();
    setLanguageState(nextLang);
  }, [computeInitialLanguage]);

  const setLanguage = useCallback(
    (nextLang: Language) => {
      if (!isPatient) {
        setLanguageState('EN');
        return;
      }
      setLanguageState(nextLang === 'AR' ? 'AR' : 'EN');
    },
    [isPatient]
  );

  const activeDictKey = language === 'AR' ? 'AR' : 'EN';
  const dir: 'ltr' | 'rtl' = activeDictKey === 'AR' ? 'rtl' : 'ltr';

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = activeDictKey.toLowerCase();
      document.documentElement.dir = dir;
    }
  }, [activeDictKey, dir]);

  const t = useCallback(
    (key: TranslationKey): string => {
      const dict = dictionaries[activeDictKey];
      return dict[key] ?? en[key] ?? key;
    },
    [activeDictKey]
  );

  return (
    <I18nContext.Provider
      value={{
        language,
        setLanguage,
        dir,
        t,
        isPatient,
      }}
    >
      {children}
    </I18nContext.Provider>
  );
}

export function useT() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useT must be used within an I18nProvider');
  }
  return context;
}

/**
 * Language toggle visible ONLY to patients.
 * Staff screens are English only.
 */
export function PatientLanguageToggle() {
  const { language, setLanguage, isPatient } = useT();

  if (!isPatient) {
    return null;
  }

  const isArabic = language === 'AR';

  return (
    <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 shadow-sm text-xs font-medium">
      <button
        type="button"
        onClick={() => setLanguage('EN')}
        className={`rounded-md ps-2.5 pe-2.5 py-1 transition-colors ${
          !isArabic
            ? 'bg-teal-700 text-white font-semibold'
            : 'text-slate-600 hover:text-slate-900'
        }`}
        aria-pressed={!isArabic}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLanguage('AR')}
        className={`rounded-md ps-2.5 pe-2.5 py-1 transition-colors ${
          isArabic
            ? 'bg-teal-700 text-white font-semibold'
            : 'text-slate-600 hover:text-slate-900'
        }`}
        aria-pressed={isArabic}
      >
        العربية
      </button>
    </div>
  );
}
