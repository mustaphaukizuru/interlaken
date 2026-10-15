import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Send } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { PrivacyNote } from '@/components/ui/PrivacyNote';
import { contactApi } from '@/services/api';

/**
 * Solicitud de facturación: los mismos 7 campos, todos obligatorios, que el
 * formulario oficial del colegio (interlaken.com.mx/index-7.html).
 * Bitácora 13/10/2026, ref. 8. El backend valida lo mismo.
 */
type Field = 'student' | 'razon_social' | 'rfc' | 'cp' | 'regimen' | 'email' | 'phone';
type Form = Record<Field, string>;
const FIELDS: Field[] = ['student', 'razon_social', 'rfc', 'cp', 'regimen', 'email', 'phone'];
const EMPTY: Form = { student: '', razon_social: '', rfc: '', cp: '', regimen: '', email: '', phone: '' };

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

export function FacturacionForm({ billingEmail }: { billingEmail: string }) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<Field | 'general', string>>>({});
  const [done, setDone] = useState(false);
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
      if (Object.keys(next).length === 0) next.general = `No se pudo enviar. Intente de nuevo o escriba a ${billingEmail}.`;
      setErrors(next);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Partial<Record<Field, string>> = {};
    FIELDS.forEach((k) => { if (!form[k].trim()) next[k] = 'Requerido.'; });
    const rfc = form.rfc.trim();
    if (rfc && (rfc.length < 12 || rfc.length > 13)) next.rfc = 'El RFC debe tener 12 o 13 caracteres.';
    if (form.cp && !/^\d{5}$/.test(form.cp.trim())) next.cp = 'El código postal debe tener 5 dígitos.';
    if (form.phone && digits(form.phone).length !== 10) next.phone = 'Escriba el teléfono a 10 dígitos: (00) 0000-0000.';
    if (Object.keys(next).length) { setErrors(next); return; }
    send.mutate();
  };

  if (done) {
    return (
      <div className="rounded-xl2 border border-green/30 bg-green/5 p-6 text-center" role="status">
        <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-green-dark" aria-hidden="true" />
        <p className="font-head text-lg font-bold text-ink">Solicitud enviada</p>
        <p className="mt-1 text-sm text-muted">
          Le enviamos una confirmación a {form.email}. Recibirá sus facturas cada mes desde {billingEmail},
          24 horas hábiles después de realizar sus pagos.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label="Solicitud de facturación">
      <p className="text-xs text-muted">Todos los campos son obligatorios.</p>
      <Input label="Nombre del alumno" value={form.student} onChange={set('student')} error={errors.student} autoComplete="off" required />
      <Input label="Razón social" value={form.razon_social} onChange={set('razon_social')} error={errors.razon_social} hint="Tal como aparece en su constancia de situación fiscal." required />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="RFC" value={form.rfc} onChange={set('rfc')} error={errors.rfc} maxLength={13} autoComplete="off" autoCapitalize="characters" required />
        <Input label="Código postal" inputMode="numeric" value={form.cp} onChange={set('cp')} error={errors.cp} maxLength={5} autoComplete="postal-code" required />
      </div>
      <div>
        <label className="label" htmlFor="fx-regimen">Régimen fiscal</label>
        <select
          id="fx-regimen"
          className="input-field min-h-[44px] text-base"
          value={form.regimen}
          onChange={set('regimen')}
          required
          aria-invalid={!!errors.regimen}
          aria-describedby={errors.regimen ? 'fx-regimen-error' : undefined}
        >
          <option value="">Seleccione su régimen fiscal</option>
          {REGIMENES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {errors.regimen && <p id="fx-regimen-error" className="mt-1.5 text-xs text-coral-600">{errors.regimen}</p>}
      </div>
      <Input label="Correo para enviar facturas" type="email" inputMode="email" autoComplete="email" placeholder="ejemplo@ejemplo.com" value={form.email} onChange={set('email')} error={errors.email} required />
      <Input label="Teléfono de contacto" type="tel" inputMode="tel" autoComplete="tel" placeholder="(00) 0000-0000" value={form.phone} onChange={set('phone')} error={errors.phone} required />
      {errors.general && <p className="text-sm text-coral-600" role="alert">{errors.general}</p>}
      <PrivacyNote />
      <Button type="submit" variant="cta" size="lg" loading={send.isPending} className="w-full justify-center">
        <Send className="h-4 w-4" aria-hidden="true" /> Enviar solicitud
      </Button>
    </form>
  );
}

export default FacturacionForm;
