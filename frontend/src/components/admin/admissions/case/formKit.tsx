import { useId, useState, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';
import { apiErrorMessage, apiFieldErrors, type FieldErrorMap } from '@/lib/apiErrors';

/**
 * Small form pieces the Expediente cards and dialogs share: a labelled
 * select / textarea with its inline error (the same look as `ui/Input`), and
 * the error summary that lists what the server refused, so a person who
 * missed the inline message still reads it (announced as an alert).
 */

/** Server errors → `{field: message}`; anything without a field lands on `detail`. */
export function errorsFrom(err: unknown, fallback = 'No se pudo guardar.'): FieldErrorMap {
  const fields = apiFieldErrors(err);
  if (!Object.keys(fields).length) return { detail: apiErrorMessage(err, fallback) };
  return fields;
}

export function ErrorSummary({ errors, labels }: { errors: FieldErrorMap; labels: Record<string, string> }) {
  const known = Object.entries(errors).filter(([k]) => k !== 'detail' && k !== 'non_field_errors');
  const detail = errors.detail;
  if (!detail && known.length === 0) return null;
  return (
    <div role="alert" className="rounded-xl bg-coral-50 px-3 py-2.5 text-sm text-coral-700">
      <p className="flex items-start gap-2 font-semibold">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {detail || 'Revise los datos marcados.'}
      </p>
      {known.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-9">
          {known.map(([k, msg]) => <li key={k}>{labels[k] ? `${labels[k]}: ` : ''}{msg}</li>)}
        </ul>
      )}
    </div>
  );
}

function FieldShell({ id, label, error, hint, children, className }: {
  id: string; label: string; error?: string; hint?: string; children: ReactNode; className?: string;
}) {
  return (
    <div className={clsx('w-full', className)}>
      <label htmlFor={id} className="label">{label}</label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted">{hint}</p>}
      {error && <p id={`${id}-error`} className="mt-1.5 text-xs text-coral-600">{error}</p>}
    </div>
  );
}

export function SelectField({ label, error, hint, options, className, id, placeholder, ...props }: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string; error?: string; hint?: string; options: { value: string; label: string }[]; placeholder?: string;
}) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldShell id={fid} label={label} error={error} hint={hint} className={className}>
      <select
        id={fid}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fid}-error` : hint ? `${fid}-hint` : undefined}
        className={clsx('input-field', error && 'border-coral-400')}
        {...props}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </FieldShell>
  );
}

export function TextareaField({ label, error, hint, className, id, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string; error?: string; hint?: string;
}) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldShell id={fid} label={label} error={error} hint={hint} className={className}>
      <textarea
        id={fid}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fid}-error` : hint ? `${fid}-hint` : undefined}
        className={clsx('input-field min-h-[88px]', error && 'border-coral-400')}
        {...props}
      />
    </FieldShell>
  );
}

/** A row of mutually exclusive choices as large tap targets (radio inputs inside). */
export function ChoiceGroup<T extends string>({ legend, name, value, options, onChange, disabled, error }: {
  legend: string;
  name: string;
  value: T | '';
  options: { value: T; label: string; hint?: string; tone?: 'positive' | 'negative' | 'neutral' }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  error?: string;
}) {
  const errId = useId();
  return (
    <fieldset aria-describedby={error ? errId : undefined} disabled={disabled}>
      <legend className="label">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {options.map((o) => {
          const checked = value === o.value;
          return (
            <label
              key={o.value}
              className={clsx(
                'flex min-h-[48px] cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition focus-within:ring-2 focus-within:ring-purple/40',
                checked
                  ? o.tone === 'negative' ? 'border-coral-400 bg-coral-50/60' : 'border-purple bg-purple/5'
                  : 'border-line bg-white hover:border-purple/40',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input type="radio" name={name} value={o.value} checked={checked} onChange={() => onChange(o.value)} className="mt-0.5" />
              <span className="min-w-0">
                <span className="font-medium text-ink">{o.label}</span>
                {o.hint && <span className="block text-xs text-muted">{o.hint}</span>}
              </span>
            </label>
          );
        })}
      </div>
      {error && <p id={errId} className="mt-1.5 text-xs text-coral-600">{error}</p>}
    </fieldset>
  );
}

/** Polite live region for «Guardado» / «Enviado» after a write. */
export function SaveStatus({ message }: { message: string }) {
  return <p className="min-h-[1.25rem] text-xs text-green-700" role="status" aria-live="polite">{message}</p>;
}

/**
 * Edits over server values: `value(k)` shows the draft or the saved value,
 * `changed` holds only what differs (the PATCH body), `reset()` drops the
 * draft after a save. A refetch never overwrites what the person is typing.
 */
export function useDraft<T extends Record<string, unknown>>(server: T) {
  const [draft, setDraft] = useState<Partial<T>>({});
  const value = <K extends keyof T>(k: K): T[K] => (k in draft ? (draft[k] as T[K]) : server[k]);
  const set = <K extends keyof T>(k: K, v: T[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const changed = Object.fromEntries(
    Object.entries(draft).filter(([k, v]) => v !== server[k]),
  ) as Partial<T>;
  return { value, set, changed, dirty: Object.keys(changed).length > 0, reset: () => setDraft({}) };
}
