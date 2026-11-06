import React from 'react';
import { Spinner } from './Spinner';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

const variantClasses = {
  primary:
    'bg-teal-700 text-white hover:bg-teal-800 focus-visible:ring-teal-600 border border-transparent shadow-sm',
  secondary:
    'bg-slate-100 text-slate-800 hover:bg-slate-200 focus-visible:ring-slate-500 border border-slate-300',
  outline:
    'bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-teal-600 border border-slate-300 shadow-sm',
  danger:
    'bg-rose-700 text-white hover:bg-rose-800 focus-visible:ring-rose-600 border border-transparent shadow-sm',
  ghost:
    'bg-transparent text-slate-700 hover:bg-slate-100 focus-visible:ring-slate-500 border border-transparent',
};

const sizeClasses = {
  sm: 'ps-2.5 pe-2.5 py-1 text-xs',
  md: 'ps-4 pe-4 py-2 text-sm',
  lg: 'ps-5 pe-5 py-2.5 text-base',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      disabled,
      className = '',
      children,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`inline-flex items-center justify-center font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        {...props}
      >
        {loading && <Spinner size="sm" className="me-2 text-current" />}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';

