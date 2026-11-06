import React from 'react';

export interface ErrorBannerProps {
  title?: string;
  message: string;
  onDismiss?: () => void;
  className?: string;
}

export function ErrorBanner({
  title = 'An error occurred',
  message,
  onDismiss,
  className = '',
}: ErrorBannerProps) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className={`rounded-lg bg-rose-50 border border-rose-200 ps-4 pe-4 py-3 text-xs text-rose-900 shadow-sm flex items-start justify-between gap-3 ${className}`}
    >
      <div className="flex items-start gap-2.5">
        <svg
          className="h-4 w-4 text-rose-700 shrink-0 mt-0.5"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
            clipRule="evenodd"
          />
        </svg>
        <div>
          {title && <span className="font-semibold">{title}: </span>}
          <span>{message}</span>
        </div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-rose-700 hover:text-rose-900 font-medium shrink-0 ps-2 pe-2 py-0.5 rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rose-600"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}

