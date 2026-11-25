import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Send } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { PrivacyNote } from '@/components/ui/PrivacyNote';
import { contactApi } from '@/services/api';
import { PHONE_MESSAGES, phoneProblem } from '@/lib/validators';

/**
 * Solicitud de facturación: los mismos 7 campos, todos obligatorios, que el
 * formulario oficial del colegio (interlaken.com.mx/index-7.html).
 * Bitácora 13/10/2026, ref. 8. El backend valida lo mismo.
 */
type Field = 'student' | 'razon_social' | 'rfc' | 'cp' | 'regimen' | 'email' | 'phone';
type Form = Record<Field, string>;
const FIELDS: Field[] = ['student', 'razon_social', 'rfc', 'cp', 'regimen', 'email', 'phone'];
const EMPTY: Form = { student: '', razon_social: '', rfc: '', cp: '', regimen: '', email: '', phone: '' };
/** Each field's element id, in the order the form shows them (the first with an error takes the focus). */
const DOM_ID: Record<Field, string> = {
  student: 'fx-student', razon_social: 'fx-razon', rfc: 'fx-rfc', cp: 'fx-cp', regimen: 'fx-regimen', email: 'fx-email', phone: 'fx-phone',
};

export const REGIMENES = [
  'Régimen de sueldos y salarios e ingresos asimilados a salarios',
  'Régimen simplificado de confianza',
  'Régimen de las personas físicas con actividades empresariales y profesionales',
  'Régimen de incorporación fiscal',
  'Régimen general de ley personas morales',
  'Régimen simplificado de ley personas morales',
  'Régimen de pequeños contribuyentes',
  'Régimen de arrendamiento',
  'Régimen de enajenación o adquisición de bienes',
  'Régimen intermedio de las personas físicas con actividades empresariales',
  'Régimen simplificado de ley personas físicas',
  'Régimen de las actividades empresariales con ingresos a través de plataformas tecnológicas.',
] as const;

const digits = (v: string) => v.replace(/\D/g, '');

/**
 * The form's words, editable in Contenido (Facturación · Solicitud). Fields,
 * rules and the SAT regime list stay in code. {facturas} = the billing
 * address of the section, {correo} = the address the family typed.
 */
export const FACTURACION_FORM_DEFAULTS = {
  requiredNote: 'Todos los campos son obligatorios.',
  studentLabel: 'Nombre del alumno',
  razonLabel: 'Razón social',
  razonHint: 'Tal como aparece en su constancia de situación fiscal.',
  rfcLabel: 'RFC',
  cpLabel: 'Código postal',
  regimenLabel: 'Régimen fiscal',
  regimenPlaceholder: 'Seleccione su régimen fiscal',
  emailLabel: 'Correo para enviar facturas',
  emailPlaceholder: 'ejemplo@ejemplo.com',
  phoneLabel: 'Teléfono de contacto',
  phonePlaceholder: '(00) 0000-0000',
  submitLabel: 'Enviar solicitud',
  errRequired: 'Requerido.',
  errRfc: 'El RFC debe tener 12 o 13 caracteres.',
  errCp: 'El código postal debe tener 5 dígitos.',
  errPhone: 'Escriba el teléfono a 10 dígitos: (00) 0000-0000.',
  errGeneral: 'No se pudo enviar. Intente de nuevo o escriba a {facturas}.',
  doneTitle: 'Solicitud enviada',
  doneText: 'Le enviamos una confirmación a {correo}. Recibirá sus facturas cada mes desde {facturas}, 24 horas hábiles después de realizar sus pagos.',
};
export type FacturacionFormCopy = typeof FACTURACION_FORM_DEFAULTS;

const fillIn = (text: string, values: Record<string, string>) => text.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);

export function FacturacionForm({ billingEmail, copy }: { billingEmail: string; copy?: Partial<FacturacionFormCopy> }) {
  // Blank texts fall back to the built-in copy, like every other CMS text.
  const c = { ...FACTURACION_FORM_DEFAULTS, ...Object.fromEntries(Object.entries(copy ?? {}).filter(([, v]) => typeof v === 'string' && v.trim())) } as FacturacionFormCopy;
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<Field | 'general', string>>>({});
  const [done, setDone] = useState(false);
  // Bumped whenever new errors arrive: the first field with one (else the general message) takes the focus.
  const [focusTick, setFocusTick] = useState(0);
  const generalRef = useRef<HTMLParagraphElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusTick) return;
    const first = FIELDS.find((k) => errors[k]);
    (first ? document.getElementById(DOM_ID[first]) : generalRef.current)?.focus();
    // Only on a new set of errors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick]);
  useEffect(() => { if (done) doneRef.current?.focus(); }, [done]);
  const set = (k: Field) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: undefined }));
  };
  const send = useMutation({
    mutationFn: () => contactApi.requestInvoice(form),
    onSuccess: () => setDone(true),
    onError: (err: unknown) => {
      const data = (err as { response?: { data?: Record<string, string[] | string> } })?.response?.data;
      const next: Partial<Record<Field | 'general', string>> = {};
      if (data && typeof data === 'object') {
        for (const [k, v] of Object.entries(data)) {
          if ((FIELDS as string[]).includes(k)) next[k as Field] = Array.isArray(v) ? v[0] : String(v);
        }
      }
      if (Object.keys(next).length === 0) next.general = fillIn(c.errGeneral, { facturas: billingEmail });
      setErrors(next);
      setFocusTick((n) => n + 1);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Partial<Record<Field, string>> = {};
    FIELDS.forEach((k) => { if (!form[k].trim()) next[k] = c.errRequired; });
    const rfc = form.rfc.trim();
    if (rfc && (rfc.length < 12 || rfc.length > 13)) next.rfc = c.errRfc;
    if (form.cp && !/^\d{5}$/.test(form.cp.trim())) next.cp = c.errCp;
    // Letters are refused like a wrong length (the site's phone rule; the server checks it too).
    if (form.phone && (digits(form.phone).length !== 10 || phoneProblem(form.phone) === PHONE_MESSAGES.chars)) next.phone = c.errPhone;
    if (Object.keys(next).length) { setErrors(next); setFocusTick((n) => n + 1); return; }
    send.mutate();
  };

  if (done) {
    return (
      <div ref={doneRef} tabIndex={-1} className="rounded-md bg-success-bg p-6 text-center focus:outline-none" role="status">
        <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-success" aria-hidden="true" />
        <p className="font-head text-lg font-bold text-ink">{c.doneTitle}</p>
        <p className="mt-1 text-base text-muted">
          {fillIn(c.doneText, { correo: form.email, facturas: billingEmail })}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label="Solicitud de facturación">
      <p className="text-sm text-muted">{c.requiredNote}</p>
      <Input id="fx-student" name="student" label={c.studentLabel} value={form.student} onChange={set('student')} error={errors.student} autoComplete="off" className="text-base" required />
      <Input id="fx-razon" name="razon_social" label={c.razonLabel} value={form.razon_social} onChange={set('razon_social')} error={errors.razon_social} hint={c.razonHint} autoComplete="organization" className="text-base" required />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input id="fx-rfc" name="rfc" label={c.rfcLabel} value={form.rfc} onChange={set('rfc')} error={errors.rfc} maxLength={13} autoComplete="off" autoCapitalize="characters" className="text-base" required />
        <Input id="fx-cp" name="cp" label={c.cpLabel} inputMode="numeric" value={form.cp} onChange={set('cp')} error={errors.cp} maxLength={5} autoComplete="postal-code" className="text-base" required />
      </div>
      <div>
        <label className="label" htmlFor="fx-regimen">{c.regimenLabel}</label>
        <select
          id="fx-regimen"
          name="regimen"
          className="input-field min-h-[44px] text-base"
          value={form.regimen}
          onChange={set('regimen')}
          required
          aria-invalid={!!errors.regimen}
          aria-describedby={errors.regimen ? 'fx-regimen-error' : undefined}
        >
          <option value="">{c.regimenPlaceholder}</option>
          {REGIMENES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {errors.regimen && <p id="fx-regimen-error" className="mt-1.5 text-sm font-medium text-danger">{errors.regimen}</p>}
      </div>
      <Input id="fx-email" name="email" label={c.emailLabel} type="email" inputMode="email" autoComplete="email" placeholder={c.emailPlaceholder} value={form.email} onChange={set('email')} error={errors.email} className="text-base" required />
      <Input id="fx-phone" name="phone" label={c.phoneLabel} type="tel" inputMode="tel" autoComplete="tel" placeholder={c.phonePlaceholder} value={form.phone} onChange={set('phone')} error={errors.phone} className="text-base" required />
      {errors.general && (
        <p ref={generalRef} tabIndex={-1} className="flex items-start gap-2 rounded-sm bg-danger-bg px-3 py-2.5 text-sm font-semibold text-danger focus:outline-none" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{errors.general}</span>
        </p>
      )}
      <PrivacyNote />
      <Button type="submit" variant="cta" size="lg" loading={send.isPending} className="w-full justify-center">
        <Send className="h-4 w-4" aria-hidden="true" /> {c.submitLabel}
      </Button>
    </form>
  );
}

export default FacturacionForm;
