import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { clsx } from 'clsx';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className, id, ...props }, ref) => {
    const autoId = useId();
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-') ?? autoId;
    const errorId = `${inputId}-error`;
    const hintId = `${inputId}-hint`;
    const describedBy = error ? errorId : hint ? hintId : undefined;
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="label">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={clsx(
            'input-field',
            error && 'border-coral-400 focus:border-coral-400 focus:ring-coral-400/20',
            className
          )}
          {...props}
        />
        {hint && !error && <p id={hintId} className="mt-1.5 text-xs text-muted">{hint}</p>}
        {error && <p id={errorId} className="mt-1.5 text-xs text-coral-600">{error}</p>}
      </div>
    );
  }
);
Input.displayName = 'Input';
