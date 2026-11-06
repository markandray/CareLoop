import React from 'react';

export interface AttentionBadgeProps {
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  score?: number;
  className?: string;
}

export function AttentionBadge({
  level,
  score,
  className = '',
}: AttentionBadgeProps) {
  const isHigh = level === 'HIGH';
  const isMedium = level === 'MEDIUM';

  const colorClasses = isHigh
    ? 'bg-rose-100 text-rose-900 border-rose-300'
    : isMedium
      ? 'bg-amber-100 text-amber-950 border-amber-300'
      : 'bg-emerald-50 text-emerald-900 border-emerald-300';

  return (
    <span
      title="Operational workflow rule, not a clinical risk assessment."
      className={`inline-flex items-center gap-1.5 rounded-md border ps-2 pe-2 py-0.5 text-xs font-semibold ${colorClasses} ${className}`}
    >
      {/* Explicit icon: never colour alone */}
      {isHigh ? (
        <svg
          className="h-3.5 w-3.5 text-rose-700 shrink-0"
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
      ) : isMedium ? (
        <svg
          className="h-3.5 w-3.5 text-amber-700 shrink-0"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        <svg
          className="h-3.5 w-3.5 text-emerald-700 shrink-0"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
            clipRule="evenodd"
          />
        </svg>
      )}

      <span>
        {level} Attention
        {score !== undefined && ` (${score})`}
      </span>
    </span>
  );
}
