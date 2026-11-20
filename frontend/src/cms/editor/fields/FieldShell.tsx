/** Label, help, warning and error lines shared by every CMS editor field (visible label, error next to the field). */
import type { ReactNode } from 'react';
import { AlertCircle, AlertTriangle } from 'lucide-react';

export interface FieldBaseProps {
  /** id of the main control; the label points at it and errors are `${id}-error`. */
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  warning?: string;
  /** Focus left the field (validation shows its error from then on). */
  onBlur?: () => void;
}

export function RequiredMark({ required }: { required?: boolean }) {
  if (!required) return null;
  return <><span aria-hidden="true" className="text-coral-600"> *</span><span className="sr-only"> (obligatorio)</span></>;
}

export function FieldLabel({ htmlFor, id, label, required, children }: { htmlFor?: string; id?: string; label: string; required?: boolean; children?: ReactNode }) {
  return (
    <label className="label" htmlFor={htmlFor} id={id}>
      {label}<RequiredMark required={required} />{children}
    </label>
  );
}

/** aria-describedby for a control: error first, then warning, then help. */
export function describedBy(id: string, p: { hint?: string; error?: string; warning?: string }): string | undefined {
  const ids = [p.error && `${id}-error`, p.warning && `${id}-warn`, p.hint && `${id}-hint`].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}

export function FieldNotes({ id, hint, error, warning }: { id: string; hint?: string; error?: string; warning?: string }) {
  return (
    <>
      {error && (
        <p id={`${id}-error`} className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-coral-600">
          <AlertCircle size={14} className="mt-px shrink-0" aria-hidden="true" /> <span>{error}</span>
        </p>
      )}
      {warning && (
        <p id={`${id}-warn`} className="mt-1.5 flex items-start gap-1.5 text-xs text-amber">
          <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden="true" /> <span>{warning}</span>
        </p>
      )}
      {hint && <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted">{hint}</p>}
    </>
  );
}

/** Red outline of an input in error, matching components/ui/Input. */
export const invalidClass = (error?: string) => (error ? 'border-coral-400 focus:border-coral-400 focus:ring-coral-400/20' : '');
