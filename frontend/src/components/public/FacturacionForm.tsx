import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Send } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { PrivacyNote } from '@/components/ui/PrivacyNote';
import { contactApi } from '@/services/api';

type Field = 'name' | 'email' | 'phone' | 'student' | 'rfc' | 'razon_social' | 'regimen' | 'cp' | 'uso_cfdi' | 'concepto' | 'monto' | 'fecha_pago' | 'referencia' | 'notes';
type Form = Record<Field, string>;
const EMPTY: Form = { name: '', email: '', phone: '', student: '', rfc: '', razon_social: '', regimen: '', cp: '', uso_cfdi: 'D10', concepto: 'Recarga de cafetería', monto: '', fecha_pago: '', referencia: '', notes: '' };

const USOS = [['D10', 'D10 - Pagos por servicios educativos (colegiaturas)'], ['G03', 'G03 - Gastos en general'], ['S01', 'S01 - Sin efectos fiscales']];
const REQUIRED: Field[] = ['name', 'email', 'rfc', 'razon_social', 'cp', 'concepto', 'monto', 'fecha_pago'];

/** CFDI request form (BACKLOG P1-G6): emails facturación with Reply-To the requester. */
export function FacturacionForm({ billingEmail }: { billingEmail: string }) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [done, setDone] = useState(false);
  const set = (k: Field) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: undefined }));
  };
  const send = useMutation({
    mutationFn: () => contactApi.requestInvoice(form),
    onSuccess: () => setDone(true),
    onError: (err: unknown) => {
      const data = (err as { response?: { data?: Record<string, string[]> } })?.response?.data;
      if (data && typeof data === 'object') {
        const next: Partial<Record<Field, string>> = {};
        for (const [k, v] of Object.entries(data)) next[k as Field] = Array.isArray(v) ? v[0] : String(v);
        setErrors(next);
      } else {
        setErrors({ notes: 'No se pudo enviar. Intente de nuevo o escriba a ' + billingEmail });
      }
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Partial<Record<Field, string>> = {};
    REQUIRED.forEach((k) => { if (!form[k].trim()) next[k] = 'Requerido.'; });
    if (form.rfc && (form.rfc.trim().length < 12 || form.rfc.trim().length > 13)) next.rfc = 'El RFC debe tener 12 o 13 caracteres.';
    if (Object.keys(next).length) { setErrors(next); return; }
    send.mutate();
  };

  if (done) {
    return (
      <div className="rounded-xl2 border border-green/30 bg-green/5 p-6 text-center" role="status">
        <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-green-dark" aria-hidden="true" />
        <p className="font-head text-lg font-bold text-ink">Solicitud enviada</p>
        <p className="mt-1 text-sm text-muted">Le enviamos una confirmación a {form.email}. Recibirá su CFDI desde {billingEmail}.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5" aria-label="Solicitud de factura">
      <fieldset className="space-y-4">
        <legend className="font-head text-base font-bold text-ink">Quién solicita</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Nombre" value={form.name} onChange={set('name')} error={errors.name} autoComplete="name" required />
          <Input label="Correo" type="email" inputMode="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} required />
          <Input label="Teléfono" type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} error={errors.phone} />
          <Input label="Alumno (nombre y grado)" value={form.student} onChange={set('student')} error={errors.student} />
        </div>
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="font-head text-base font-bold text-ink">Datos fiscales</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="RFC" value={form.rfc} onChange={set('rfc')} error={errors.rfc} maxLength={13} autoComplete="off" required />
          <Input label="Razón social (como en la constancia)" value={form.razon_social} onChange={set('razon_social')} error={errors.razon_social} required />
          <Input label="Régimen fiscal" value={form.regimen} onChange={set('regimen')} error={errors.regimen} placeholder="Ej. 605" />
          <Input label="Código postal fiscal" inputMode="numeric" value={form.cp} onChange={set('cp')} error={errors.cp} maxLength={5} required />
          <div className="sm:col-span-2">
            <label className="label" htmlFor="fx-uso">Uso de CFDI</label>
            <select id="fx-uso" className="input-field min-h-[44px]" value={form.uso_cfdi} onChange={set('uso_cfdi')}>
              {USOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="font-head text-base font-bold text-ink">Pago a facturar</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Concepto" value={form.concepto} onChange={set('concepto')} error={errors.concepto} required />
          <Input label="Monto (MXN)" inputMode="decimal" value={form.monto} onChange={set('monto')} error={errors.monto} required />
          <Input label="Fecha de pago" type="date" value={form.fecha_pago} onChange={set('fecha_pago')} error={errors.fecha_pago} required hint="Solo se facturan pagos del mes en curso." />
          <Input label="Referencia o folio del comprobante" value={form.referencia} onChange={set('referencia')} error={errors.referencia} />
        </div>
        <div>
          <label className="label" htmlFor="fx-notes">Notas</label>
          <textarea id="fx-notes" className="input-field min-h-[80px]" value={form.notes} onChange={set('notes')} />
          {errors.notes && <p className="mt-1.5 text-xs text-coral-600">{errors.notes}</p>}
        </div>
      </fieldset>
      <PrivacyNote />
      <Button type="submit" variant="cta" size="lg" loading={send.isPending} className="w-full justify-center">
        <Send className="h-4 w-4" aria-hidden="true" /> Solicitar factura
      </Button>
    </form>
  );
}

export default FacturacionForm;
