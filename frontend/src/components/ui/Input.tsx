import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { clsx } from 'clsx';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  /** Marks an optional field «(opcional)» after the label (forms mark the optional ones, not the required). */
  optional?: boolean;
}

/**
 * Label, field, then the inline error and the hint. The hint stays on screen
 * while there is an error, and the field is described by both (error first),
 * so a screen reader hears what went wrong and how to fill it.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, optional, className, id, ...props }, ref) => {
    // Unique per field (QA 2026-11-24): an id built from the label repeated on
    // every «Texto» of a list (Navegación had 15 inputs with id "texto"), so
    // each label pointed at the first one.
    const autoId = useId();
    const inputId = id ?? autoId;
    const errorId = `${inputId}-error`;
    const hintId = `${inputId}-hint`;
    const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="label">
            {label}
            {optional ? <>{' '}<span className="ml-1 text-xs font-normal text-subtle">(opcional)</span></> : null}
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
        {error && <p id={errorId} className="mt-1.5 text-sm font-medium text-danger">{error}</p>}
        {hint && <p id={hintId} className="mt-1.5 text-sm text-muted">{hint}</p>}
      </div>
    );
  }
);
Input.displayName = 'Input';
