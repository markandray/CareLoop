'use client';

import React, { useState } from 'react';
import { useT } from '../lib/i18n/context';

interface ReviewNoticeBannerProps {
  forceShow?: boolean;
}

export function ReviewNoticeBanner({ forceShow }: ReviewNoticeBannerProps) {
  const { language, t } = useT();
  const [dismissed, setDismissed] = useState(false);

  // Visible when active language is Arabic or explicitly forced
  if (dismissed || (language !== 'AR' && !forceShow)) {
    return null;
  }

  return (
    <div
      role="note"
      aria-label="Clinical review notice"
      className="mb-4 rounded-lg bg-amber-50 border border-amber-200 ps-4 pe-4 py-3 text-xs text-amber-900 shadow-sm flex items-start justify-between gap-3"
    >
      <div className="flex items-start gap-2.5">
        <svg
          className="h-4 w-4 text-amber-700 shrink-0 mt-0.5"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
            clipRule="evenodd"
          />
        </svg>
        <div>
          <span className="font-semibold">{t('reviewNotice_title')}: </span>
          <span>{t('reviewNotice_unreviewedText')}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-amber-700 hover:text-amber-900 font-medium shrink-0 ps-2 pe-2 py-0.5 rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-600"
      >
        {t('reviewNotice_dismiss')}
      </button>
    </div>
  );
}
