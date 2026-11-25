import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { portalApi, type GuardianWrite } from '@/services/api';
import { fieldErrorsOrNull } from '@/lib/apiErrors';
import { emailProblem, phoneProblem } from '@/lib/validators';
import { useDirtyCloseGuard, useReportDirty, valuesDiffer } from '@/hooks/useDirtyCloseGuard';

export interface GuardianEditTarget {
  id: number;
  email: string;
  first_name?: string;
  last_name?: string;
  whatsapp?: string;
  phone?: string;
  relationship?: string;
  is_self?: boolean;
}

interface Props {
  studentId: number;
  guardian: GuardianEditTarget | null;
  onClose: () => void;
}

const RELATIONSHIPS = ['Padre', 'Madre', 'Padre/Madre', 'Tutor', 'Abuelo/a', 'Otro'];
/** The office types someone else's address: «el correo», not «su correo». */
const GUARDIAN_EMAIL = { empty: 'Escriba el correo.', invalid: 'Revise el correo: debe ser como nombre@ejemplo.com.' };

/** Edit a linked guardian's identity and contact data (BACKLOG P1-A3). */
export function GuardianEditModal({ studentId, guardian, onClose }: Props) {
  const guard = useDirtyCloseGuard(onClose);
  return (
    <>
      <Modal open={!!guardian} onClose={guard.requestClose} title="Editar tutor" maxWidth={520}>
        {guardian && <GuardianForm key={guardian.id} studentId={studentId} guardian={guardian} onClose={onClose}
          onCancel={guard.requestClose} onDirty={guard.reportDirty} />}
      </Modal>
      {guard.dialog}
    </>
  );
}

function GuardianForm({ studentId, guardian, onClose, onCancel, onDirty }: {
  studentId: number; guardian: GuardianEditTarget; onClose: () => void; onCancel: () => void; onDirty: (dirty: boolean) => void;
}) {
  const qc = useQueryClient();
  const [start] = useState<GuardianWrite>(() => ({
    first_name: guardian.first_name ?? '',
    last_name: guardian.last_name ?? '',
    email: guardian.email,
    whatsapp: guardian.whatsapp ?? '',
    phone: guardian.phone ?? '',
    relationship: guardian.relationship ?? 'Padre/Madre',
  }));
  const [form, setForm] = useState<GuardianWrite>(start);
  useReportDirty(valuesDiffer(form, start), onDirty);
  const [errors, setErrors] = useState<Partial<Record<keyof GuardianWrite | 'detail' | 'error', string>>>({});
  const set = <K extends keyof GuardianWrite>(k: K, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const mutation = useMutation({
    mutationFn: () => portalApi.updateGuardian(studentId, guardian.id, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-student-guardians', studentId] });
      toast.success('Tutor actualizado.');
      onClose();
    },
    onError: (err: unknown) => {
      const next = fieldErrorsOrNull(err) as typeof errors | null;
      if (next) {
        setErrors(next);
        toast.error(next.error ?? next.detail ?? 'Revise los campos marcados.');
      } else {
        toast.error('No se pudo guardar el tutor.');
      }
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!form.first_name.trim()) next.first_name = 'Requerido.';
    // Checked when typed: the saved address (and the family login, not editable here) never blocks a save.
    const email = guardian.is_self || form.email === start.email ? null : emailProblem(form.email, { messages: GUARDIAN_EMAIL });
    if (email) next.email = email;
    // A number saved before the phone rule is sent back as it is (phoneProblem's `saved`).
    const whatsapp = phoneProblem(form.whatsapp, start.whatsapp);
    if (whatsapp) next.whatsapp = whatsapp;
    const phone = phoneProblem(form.phone, start.phone);
    if (phone) next.phone = phone;
    if (Object.keys(next).length) { setErrors(next); return; }
    mutation.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Nombre(s)" value={form.first_name} onChange={(e) => set('first_name', e.target.value)} error={errors.first_name} required />
        <Input label="Apellidos" value={form.last_name} onChange={(e) => set('last_name', e.target.value)} error={errors.last_name} />
      </div>
      <Input
        label="Correo de acceso"
        type="email"
        inputMode="email"
        value={form.email}
        onChange={(e) => set('email', e.target.value)}
        error={errors.email}
        disabled={!!guardian.is_self}
        hint={guardian.is_self ? 'La cuenta familiar usa la matrícula del alumno.' : 'Cambiarlo cambia el correo con el que inicia sesión.'}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="WhatsApp" inputMode="tel" value={form.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} error={errors.whatsapp} placeholder="5215512345678" hint="Con lada de país; recibe avisos." />
        <Input label="Teléfono" inputMode="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} error={errors.phone} />
      </div>
      {!guardian.is_self && (
        <div>
          <label className="label" htmlFor="ge-rel">Parentesco</label>
          <select id="ge-rel" className="input-field min-h-[44px]" value={form.relationship} onChange={(e) => set('relationship', e.target.value)}>
            {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
            {!RELATIONSHIPS.includes(form.relationship) && <option value={form.relationship}>{form.relationship}</option>}
          </select>
        </div>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onCancel} className="min-h-[44px]">Cancelar</Button>
        <Button type="submit" loading={mutation.isPending} className="min-h-[44px]">Guardar cambios</Button>
      </div>
    </form>
  );
}

export default GuardianEditModal;
