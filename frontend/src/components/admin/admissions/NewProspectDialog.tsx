import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { StageChip } from '@/components/admin/admissions/StageChip';
import type { FieldErrorMap } from '@/lib/apiErrors';
import { fmtDay } from '@/lib/caseStages';
import { casesApi, storeCase, type CaseRow, type ProspectInput } from '@/hooks/queries/cases';
import { ChoiceGroup, ErrorSummary, SelectField, errorsFrom } from './case/formKit';
import { GRADE_OPTIONS, RELATIONSHIPS, cycleChoices } from './case/caseBits';

const LABELS: Record<string, string> = {
  child_name: 'Nombre del alumno',
  parent_name: 'Tutor',
  parent_phone: 'Celular',
  previous_school: 'Colegio de procedencia',
  relationship: 'Parentesco',
  child_age: 'Edad',
  grade_applying: 'Grado',
  cycle: 'Ciclo',
  parent_email: 'Correo',
};

interface Form {
  child_name: string;
  parent_name: string;
  parent_phone: string;
  previous_school: string;
  child_age: string;
  grade_applying: string;
  cycle: 'actual' | 'proximo';
  parent_email: string;
  relationship: string;
}

const EMPTY: Form = {
  child_name: '', parent_name: '', parent_phone: '', previous_school: '', child_age: '', grade_applying: '', cycle: 'proximo', parent_email: '', relationship: '',
};

function validate(f: Form): FieldErrorMap {
  const e: FieldErrorMap = {};
  if (!f.child_name.trim()) e.child_name = 'Escriba el nombre del alumno.';
  if (!f.parent_name.trim()) e.parent_name = 'Escriba el nombre del tutor.';
  if (f.parent_phone.replace(/\D/g, '').length < 10) e.parent_phone = 'Escriba un celular de 10 dígitos.';
  if (!f.grade_applying) e.grade_applying = 'Elija el grado.';
  if (f.child_age && (Number(f.child_age) < 0 || Number(f.child_age) > 25)) e.child_age = 'Escriba una edad de 0 a 25.';
  if (f.parent_email && !/^\S+@\S+\.\S+$/.test(f.parent_email.trim())) e.parent_email = 'Revise el correo.';
  return e;
}

function toInput(f: Form): ProspectInput {
  return {
    child_name: f.child_name.trim(),
    parent_name: f.parent_name.trim(),
    parent_phone: f.parent_phone.trim(),
    grade_applying: f.grade_applying,
    cycle: f.cycle,
    previous_school: f.previous_school.trim(),
    child_age: f.child_age ? Number(f.child_age) : null,
    parent_email: f.parent_email.trim(),
    // Blank: the API stores «Padre/Madre»; a ficha choice prefills «Quién llena la ficha».
    ...(f.relationship ? { relationship: f.relationship } : {}),
  };
}

/**
 * «Nuevo prospecto»: the seven details the office takes on the first call
 * (plus an optional email). Before creating it checks for cases with the
 * same phone or email (a warning with links, never a block); then it opens
 * the new Expediente.
 */
export function NewProspectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Nuevo prospecto" maxWidth={620} fullScreenOnPhone>
      <NewProspectBody onClose={onClose} />
    </Modal>
  );
}

function NewProspectBody({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const [duplicates, setDuplicates] = useState<CaseRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const cycles = cycleChoices();
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setForm((f) => ({ ...f, [k]: v })); setErrors({}); setDuplicates(null); };

  const create = async () => {
    const created = await casesApi.create(toInput(form));
    storeCase(qc, created.data);
    toast.success(`Expediente creado: ${created.data.child_name}.`);
    onClose();
    navigate(`/admin/admisiones/${created.data.id}`);
  };

  const submit = async (force = false) => {
    const local = validate(form);
    if (Object.keys(local).length) { setErrors(local); return; }
    setBusy(true);
    try {
      if (!force) {
        const check = await casesApi.create(toInput(form), true);
        if (check.data.duplicates?.length) { setDuplicates(check.data.duplicates); return; }
      }
      await create();
    } catch (e) {
      setErrors(errorsFrom(e, 'No se pudo crear el expediente.'));
    } finally {
      setBusy(false);
    }
  };

  const field = (k: Exclude<keyof Form, 'cycle'>) => ({
    value: form[k],
    onChange: (e: { target: { value: string } }) => set(k, e.target.value),
    error: errors[k],
  });

  return (
    <form noValidate className="flex flex-1 flex-col" onSubmit={(e) => { e.preventDefault(); void submit(false); }}>
      <div className="flex-1 space-y-4 pb-4">
        <p className="text-sm text-muted">Los datos de la primera llamada. Con el celular basta para enviarle las cuotas por WhatsApp.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input id="np-child" label="Nombre del alumno" autoComplete="off" {...field('child_name')} />
          <Input id="np-parent" label="Nombre del tutor" autoComplete="off" {...field('parent_name')} />
          <Input id="np-phone" label="Celular" type="tel" inputMode="tel" autoComplete="off" placeholder="55 1234 5678" {...field('parent_phone')} />
          <Input id="np-email" label="Correo (opcional)" type="email" autoComplete="off" {...field('parent_email')} />
          <SelectField id="np-rel" label="Parentesco (opcional)" placeholder="Sin dato" options={RELATIONSHIPS.map((r) => ({ value: r, label: r }))} {...field('relationship')} />
          <SelectField id="np-grade" label="Grado al que ingresa" placeholder="Elija el grado" options={GRADE_OPTIONS} {...field('grade_applying')} />
          <Input id="np-age" label="Edad (opcional)" type="number" min={0} max={25} inputMode="numeric" {...field('child_age')} />
          <Input id="np-school" label="Colegio de procedencia (opcional)" autoComplete="off" {...field('previous_school')} />
        </div>
        <ChoiceGroup
          legend="Ciclo"
          name="np-cycle"
          value={form.cycle}
          onChange={(v) => set('cycle', v)}
          error={errors.cycle}
          options={[
            { value: 'actual', label: cycles[0].label },
            { value: 'proximo', label: cycles[1].label },
          ]}
        />

        {duplicates && duplicates.length > 0 && (
          <div className="space-y-2 rounded-xl border border-amber/40 bg-amber/10 p-3" role="alert">
            <p className="flex items-start gap-2 text-sm font-semibold text-ink">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" aria-hidden="true" />
              Ya hay {duplicates.length === 1 ? 'un expediente' : `${duplicates.length} expedientes`} con ese celular o correo.
            </p>
            <ul className="space-y-1.5" aria-label="Expedientes parecidos">
              {duplicates.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <Link to={`/admin/admisiones/${d.id}`} className="font-semibold text-purple underline" onClick={onClose}>{d.child_name}</Link>
                    <span className="block text-xs text-muted">{d.parent_name} · {d.grade_applying} · {fmtDay(d.created_at)}</span>
                  </span>
                  <StageChip stage={d.stage} outcome={d.closed_outcome_label} short />
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">Abra el expediente existente o, si es otro alumno de la misma familia, cree uno nuevo.</p>
          </div>
        )}
        <ErrorSummary errors={errors} labels={LABELS} />
      </div>
      <div className="sticky bottom-0 -mx-4 flex flex-col-reverse gap-2 border-t border-line bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:flex-row sm:justify-end sm:border-0 sm:px-0 sm:pb-6">
        <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
        {duplicates && duplicates.length > 0 ? (
          <Button type="button" loading={busy} onClick={() => void submit(true)}>Crear de todos modos</Button>
        ) : (
          <Button type="submit" loading={busy}>Crear expediente</Button>
        )}
      </div>
    </form>
  );
}

export default NewProspectDialog;
