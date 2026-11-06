import React from 'react';

export interface FormFieldProps {
  id: string;
  label: string;
  error?: string;
  helpText?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function FormField({
  id,
  label,
  error,
  helpText,
  required,
  children,
  className = '',
}: FormFieldProps) {
  const errorId = error ? `${id}-error` : undefined;
  const helpId = helpText ? `${id}-help` : undefined;
  const describedBy = [errorId, helpId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`space-y-1.5 ${className}`}>
      <label
        htmlFor={id}
        className="block text-xs font-semibold text-slate-700"
      >
        {label}
        {required && (
          <span className="text-rose-600 ms-1" aria-hidden="true">
            *
          </span>
        )}
      </label>

      <div>
        {React.isValidElement(children)
          ? React.cloneElement(
              children as React.ReactElement<{
                id?: string;
                'aria-describedby'?: string;
                'aria-invalid'?: boolean;
              }>,
              {
                id,
                'aria-describedby': describedBy,
                'aria-invalid': Boolean(error),
              }
            )
          : children}
      </div>

      {helpText && !error && (
        <p id={helpId} className="text-[11px] text-slate-500">
          {helpText}
        </p>
      )}

      {error && (
        <p
          id={errorId}
          role="alert"
          className="text-xs font-medium text-rose-600"
        >
          {error}
        </p>
      )}
    </div>
  );
}

