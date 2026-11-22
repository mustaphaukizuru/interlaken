import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { contentApi, type FormField } from '@/services/api';
import { apiFieldErrors } from '@/lib/apiErrors';

type Values = Record<string, string | boolean>;

/** Which fields are shown given the current values (mirrors backend `_visible`). */
export function visibleFields(fields: FormField[], values: Values): FormField[] {
  return fields.filter((f) => !f.show_if || String(values[f.show_if.field] ?? '') === String(f.show_if.equals));
}

const fieldDomId = (key: string) => `cf-${key}`;

/** The person filling the form is the one named: their own name, email and phone may autofill. */
function autoCompleteFor(f: FormField): string | undefined {
  if (f.type === 'email') return 'email';
  if (f.type === 'phone') return 'tel';
  if (/^(nombre|name|nombre_completo|full_name)$/i.test(f.key)) return 'name';
  return undefined;
}

/**
 * Public renderer for a CMS FormDefinition (BACKLOG P3-6). Used by the `form` block.
 * Same pattern as the other public forms: optional fields say «(opcional)»,
 * every message sits under its field (described by it, with the help text),
 * the first field the server rejects takes the focus, and the answer shows
 * inline where the form was.
 */
export function CmsForm({ slug }: { slug: string }) {
  const { pathname } = useLocation();
  const { data: def, isError } = useQuery({ queryKey: ['cms-form', slug], queryFn: async () => (await contentApi.getForm(slug)).data, retry: false, staleTime: 300_000 });
  const [values, setValues] = useState<Values>({});
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const doneRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLParagraphElement>(null);
  const submit = useMutation({
    mutationFn: () => contentApi.submitForm(slug, { ...values, consent, _page: pathname }),
    onSuccess: ({ data }) => setDone(data.message),
    onError: (e) => { setErrors(apiFieldErrors(e)); setFocusTick((n) => n + 1); },
  });
  useEffect(() => { if (done) doneRef.current?.focus(); }, [done]);
  // After a rejected submit: the first field with a message (in the form's order), else the general message.
  useEffect(() => {
    if (!focusTick || !def) return;
    const keys = [...visibleFields(def.fields, values).map((f) => f.key), 'consent'];
    const first = keys.find((k) => errors[k]);
    const el = first ? document.getElementById(fieldDomId(first)) : null;
    const target = el?.tagName === 'FIELDSET' ? el.querySelector<HTMLElement>('input') : el;
    (target ?? detailRef.current)?.focus();
    // Only when a new answer arrives (values/errors are read as they were then).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick]);
  if (isError || !def) return null;
  if (done) {
    return (
      <div ref={doneRef} tabIndex={-1} className="rounded-md bg-success-bg p-6 text-center focus:outline-none" role="status">
        <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-success" aria-hidden="true" />
        <p className="font-semibold text-ink">{done}</p>
      </div>
    );
  }
  const set = (k: string, v: string | boolean) => setValues((p) => ({ ...p, [k]: v }));
  const onSubmit = (e: FormEvent) => { e.preventDefault(); setErrors({}); submit.mutate(); };
  const consentErrorId = 'cf-consent-error';
  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-label={def.title} noValidate>
      {def.description && <p className="text-base text-muted">{def.description}</p>}
      {/* honeypot: hidden from people, filled by bots */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" value={String(values.website ?? '')} onChange={(e) => set('website', e.target.value)} />
      {visibleFields(def.fields, values).map((f) => <FieldInput key={f.key} field={f} value={values[f.key]} error={errors[f.key]} onChange={(v) => set(f.key, v)} />)}
      {def.consent_text && (
        <div>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input id={fieldDomId('consent')} type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)}
              aria-required="true" aria-invalid={errors.consent ? true : undefined} aria-describedby={errors.consent ? consentErrorId : undefined} />
            <span>{def.consent_text} <Link to="/aviso-de-privacidad" className="font-semibold text-purple underline">Aviso de Privacidad</Link></span>
          </label>
          {errors.consent && <p id={consentErrorId} className="mt-1.5 text-sm font-medium text-danger">{errors.consent}</p>}
        </div>
      )}
      {errors.detail && (
        <p ref={detailRef} tabIndex={-1} className="flex items-start gap-2 rounded-sm bg-danger-bg px-3 py-2.5 text-sm font-semibold text-danger focus:outline-none" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{errors.detail}</span>
        </p>
      )}
      <Button type="submit" variant="cta" loading={submit.isPending}>{def.submit_label || 'Enviar'}</Button>
    </form>
  );
}

const OPTIONAL = <>{' '}<span className="ml-1 text-xs font-normal text-subtle">(opcional)</span></>;

function FieldInput({ field: f, value, error, onChange }: { field: FormField; value: string | boolean | undefined; error?: string; onChange: (v: string | boolean) => void }) {
  const id = fieldDomId(f.key);
  const errorId = `${id}-error`;
  const helpId = `${id}-hint`;
  const describedBy = [error ? errorId : null, f.help ? helpId : null].filter(Boolean).join(' ') || undefined;
  const aria = {
    'aria-required': f.required || undefined,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
  } as const;
  const label = <>{f.label}{f.required ? null : OPTIONAL}</>;
  const messages = (
    <>
      {error && <p id={errorId} className="mt-1.5 text-sm font-medium text-danger">{error}</p>}
      {f.help && <p id={helpId} className="mt-1.5 text-sm text-muted">{f.help}</p>}
    </>
  );
  switch (f.type) {
    case 'textarea':
      return (
        <div>
          <label className="label" htmlFor={id}>{label}</label>
          <textarea id={id} name={f.key} className="input-field text-base" rows={4} placeholder={f.placeholder} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} {...aria} />
          {messages}
        </div>
      );
    case 'select':
      return (
        <div>
          <label className="label" htmlFor={id}>{label}</label>
          <select id={id} name={f.key} className="input-field text-base" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} {...aria}>
            <option value="">Seleccione…</option>
            {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          {messages}
        </div>
      );
    case 'radio':
      return (
        <fieldset id={id} role="radiogroup" {...aria}>
          <legend className="label">{label}</legend>
          <div className="flex flex-wrap gap-x-4">
            {(f.options ?? []).map((o) => <label key={o} className="flex min-h-[44px] items-center gap-1.5 text-base"><input type="radio" name={f.key} checked={value === o} onChange={() => onChange(o)} /> {o}</label>)}
          </div>
          {messages}
        </fieldset>
      );
    case 'checkbox':
      return (
        <div>
          <label className="flex min-h-[44px] items-center gap-2 text-base text-ink"><input id={id} name={f.key} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} {...aria} /> {label}</label>
          {messages}
        </div>
      );
    default:
      return (
        <Input
          id={id}
          name={f.key}
          label={f.label}
          optional={!f.required}
          aria-required={f.required || undefined}
          autoComplete={autoCompleteFor(f)}
          type={f.type === 'phone' ? 'tel' : f.type}
          placeholder={f.placeholder}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          hint={f.help}
          error={error}
          inputMode={f.type === 'phone' ? 'tel' : f.type === 'number' ? 'decimal' : undefined}
          className="text-base"
        />
      );
  }
}

export default CmsForm;
