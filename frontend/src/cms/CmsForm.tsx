import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { contentApi, type FormDefinitionPublic, type FormField } from '@/services/api';
import { apiErrors } from './editor/helpers';

type Values = Record<string, string | boolean>;

/** Which fields are shown given the current values (mirrors backend `_visible`). */
export function visibleFields(fields: FormField[], values: Values): FormField[] {
  return fields.filter((f) => !f.show_if || String(values[f.show_if.field] ?? '') === String(f.show_if.equals));
}

/** Public renderer for a CMS FormDefinition (BACKLOG P3-6). Used by the `form` block. */
export function CmsForm({ slug }: { slug: string }) {
  const { pathname } = useLocation();
  const { data: def, isError } = useQuery({ queryKey: ['cms-form', slug], queryFn: async () => (await contentApi.getForm(slug)).data, retry: false, staleTime: 300_000 });
  const [values, setValues] = useState<Values>({});
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);
  const submit = useMutation({
    mutationFn: () => contentApi.submitForm(slug, { ...values, consent, _page: pathname }),
    onSuccess: ({ data }) => setDone(data.message),
    onError: (e) => setErrors(apiErrors(e)),
  });
  if (isError || !def) return null;
  if (done) return <div className="rounded-2xl border border-green-200 bg-green-50 p-6 text-center" role="status"><CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-green-600" aria-hidden="true" /><p className="font-semibold text-ink">{done}</p></div>;
  const set = (k: string, v: string | boolean) => setValues((p) => ({ ...p, [k]: v }));
  const onSubmit = (e: FormEvent) => { e.preventDefault(); setErrors({}); submit.mutate(); };
  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-label={def.title} noValidate>
      {def.description && <p className="text-sm text-muted">{def.description}</p>}
      {/* honeypot: hidden from people, filled by bots */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" value={String(values.website ?? '')} onChange={(e) => set('website', e.target.value)} />
      {visibleFields(def.fields, values).map((f) => <FieldInput key={f.key} field={f} value={values[f.key]} error={errors[f.key]} onChange={(v) => set(f.key, v)} />)}
      {def.consent_text && (
        <div>
          <label className="flex items-start gap-2 text-sm text-ink"><input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> <span>{def.consent_text} <Link to="/aviso-de-privacidad" className="font-semibold text-purple underline">Aviso de Privacidad</Link></span></label>
          {errors.consent && <p className="mt-1 text-xs text-coral-600" role="alert">{errors.consent}</p>}
        </div>
      )}
      {errors.detail && <p className="text-sm text-coral-600" role="alert">{errors.detail}</p>}
      <Button type="submit" variant="cta" loading={submit.isPending}>{def.submit_label || 'Enviar'}</Button>
    </form>
  );
}

function FieldInput({ field: f, value, error, onChange }: { field: FormField; value: string | boolean | undefined; error?: string; onChange: (v: string | boolean) => void }) {
  const label = f.required ? `${f.label} *` : f.label;
  const id = `cf-${f.key}`;
  switch (f.type) {
    case 'textarea':
      return (
        <div>
          <label className="label" htmlFor={id}>{label}</label>
          <textarea id={id} className="input-field" rows={4} placeholder={f.placeholder} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} />
          {f.help && !error && <p className="mt-1 text-xs text-muted">{f.help}</p>}
          {error && <p className="mt-1 text-xs text-coral-600" role="alert">{error}</p>}
        </div>
      );
    case 'select':
      return (
        <div>
          <label className="label" htmlFor={id}>{label}</label>
          <select id={id} className="input-field" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error}>
            <option value="">Seleccione…</option>
            {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          {error && <p className="mt-1 text-xs text-coral-600" role="alert">{error}</p>}
        </div>
      );
    case 'radio':
      return (
        <fieldset>
          <legend className="label">{label}</legend>
          <div className="flex flex-wrap gap-3">
            {(f.options ?? []).map((o) => <label key={o} className="flex items-center gap-1.5 text-sm"><input type="radio" name={f.key} checked={value === o} onChange={() => onChange(o)} /> {o}</label>)}
          </div>
          {error && <p className="mt-1 text-xs text-coral-600" role="alert">{error}</p>}
        </fieldset>
      );
    case 'checkbox':
      return (
        <div>
          <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {label}</label>
          {error && <p className="mt-1 text-xs text-coral-600" role="alert">{error}</p>}
        </div>
      );
    default:
      return <Input id={id} label={label} type={f.type === 'phone' ? 'tel' : f.type} placeholder={f.placeholder} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} hint={f.help} error={error} inputMode={f.type === 'phone' ? 'tel' : f.type === 'number' ? 'decimal' : undefined} />;
  }
}

export default CmsForm;
