import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { clsx } from 'clsx';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = purple pill (matches .btn-primary); cta = pink gradient (.btn-pink) */
  variant?: 'primary' | 'cta' | 'secondary' | 'danger' | 'ghost' | 'green';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

/**
 * Shared button primitive — pill shape aligned with public `.btn-*` CSS so
 * portal forms and marketing CTAs no longer look like two design systems.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, disabled, children, className, ...props }, ref) => {
    const base =
      'inline-flex min-h-[44px] items-center justify-center gap-2 font-semibold rounded-full transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed motion-safe:active:scale-[0.97]';
    const variants = {
      primary:
        'bg-purple text-white shadow-sm hover:bg-purple-mid focus-visible:ring-purple/40',
      cta:
        'text-white shadow-[0_10px_28px_-8px_rgba(239,37,88,0.55)] hover:-translate-y-0.5 focus-visible:ring-pink/40 [background:var(--grad-cta)]',
      secondary:
        'border-2 border-purple bg-white text-purple shadow-sm hover:bg-purple hover:text-white focus-visible:ring-purple/30',
      danger:
        'bg-pink text-white shadow-sm hover:bg-pink-dark focus-visible:ring-pink/40',
      ghost:
        'text-muted hover:bg-cream focus-visible:ring-purple/30',
      green:
        'bg-green-strong text-white shadow-green hover:bg-green-dark focus-visible:ring-green/40',
    };
    const sizes = {
      sm: 'text-xs px-3 py-1.5 min-h-[36px]',
      md: 'text-sm px-5 py-2.5',
      lg: 'text-sm px-6 py-3',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={clsx(base, variants[variant], sizes[size], className)}
        style={{ fontFamily: "'Poppins', sans-serif" }}
        {...props}
      >
        {loading && (
          <svg className="animate-spin -ml-1 w-4 h-4" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
