import React from 'react';

export interface CardProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  headerAction?: React.ReactNode;
  footer?: React.ReactNode;
  headingLevel?: 2 | 3;
}

export function Card({
  title,
  subtitle,
  headerAction,
  footer,
  headingLevel = 3,
  className = '',
  children,
  ...props
}: CardProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div
      className={`bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden ${className}`}
      {...props}
    >
      {(title || subtitle || headerAction) && (
        <div className="ps-5 pe-5 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
          <div>
            {title && (
              <Heading className="text-base font-semibold text-slate-900 leading-tight">
                {title}
              </Heading>
            )}
            {subtitle && (
              <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
            )}
          </div>
          {headerAction && <div>{headerAction}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
      {footer && (
        <div className="ps-5 pe-5 py-3 bg-slate-50 border-t border-slate-100 text-xs text-slate-500">
          {footer}
        </div>
      )}
    </div>
  );
}

