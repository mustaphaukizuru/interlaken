import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FolderOpen } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { StageChip } from '@/components/admin/admissions/StageChip';
import type { FieldErrorMap } from '@/lib/apiErrors';
import { PHONE_MESSAGES, phoneProblem } from '@/lib/validators';
import { fmtDay } from '@/lib/caseStages';
import { canOpen } from '@/lib/areas';
import { useAuthStore } from '@/store/authStore';
import { bookingsApi, type BookingAdmissions, type PassToAdmissionsBody } from '@/services/api';
import { invalidateEntity } from '@/hooks/queries/keys';
import { BOOKINGS_ENTITY } from '@/hooks/queries/bookings';
import { CASES_ENTITY } from '@/hooks/queries/cases';
import { useDirtyCloseGuard, useReportDirty, valuesDiffer } from '@/hooks/useDirtyCloseGuard';
import { ChoiceGroup, ErrorSummary, SelectField, errorsFrom } from './case/formKit';
import { GRADE_OPTIONS, cycleChoices } from './case/caseBits';

const LABELS: Record<string, string> = {
  child_name: 'Nombre del alumno',
  parent_name: 'Tutor',
  parent_phone: 'Celular',
  parent_email: 'Correo',
  grade_applying: 'Grado',
  cycle: 'Ciclo',
  notes: 'Notas',
  link_to: 'Expediente',
};

interface Form {
  child_name: string;
  parent_name: string;
  parent_phone: string;
  parent_email: string;
  grade_applying: string;
  cycle: 'actual' | 'proximo';
  notes: string;
}

function initial(prefill: BookingAdmissions['prefill']): Form {
  return {
    child_name: prefill.child_name,
    parent_name: prefill.parent_name,
    parent_phone: prefill.parent_phone,
    parent_email: prefill.parent_email,
    grade_applying: prefill.grade_applying,
    // A family visiting now is usually looking at the next school year.
    cycle: 'proximo',
    notes: '',
  };
}

/** The «Nuevo prospecto» rules, so the server's answer is never the first surprise. */
function validate(f: Form): FieldErrorMap {
  const e: FieldErrorMap = {};
  if (!f.child_name.trim()) e.child_name = 'Escriba el nombre del alumno.';
  if (!f.parent_name.trim()) e.parent_name = 'Escriba el nombre del tutor.';
  if (phoneProblem(f.parent_phone) === PHONE_MESSAGES.chars) e.parent_phone = PHONE_MESSAGES.chars;
  else if (f.parent_phone.replace(/\D/g, '').length < 10) e.parent_phone = 'Escriba un celular de 10 dígitos.';
  if (!f.grade_applying) e.grade_applying = 'Elija el grado.';
  if (f.parent_email && !/^\S+@\S+\.\S+$/.test(f.parent_email.trim())) e.parent_email = 'Revise el correo.';
  return e;
}

/**
 * «Pasar a Admisiones» (owner 2026-11-26): a family that booked its visit on the
 * website had no admissions case, so the office could neither see it in
 * Admisiones nor start the process. This opens one from the visit: the form
 * starts with what the family typed when booking, and cases with the same
 * phone or email are offered to link instead (the same family, often the same
 * child). The case lands in «Visita guiada» (the visit is on its file); a result
 * already recorded on the visit moves it as «Resultado de la visita» does.
 */
export function PassToAdmissionsDialog({ bookingId, parentName, bookingStatus, onClose }: {
  bookingId: number | null;
  parentName?: string;
  /** The visit's status: a cancelled or missed visit leaves the case in «Informes». */
  bookingStatus?: string;
  onClose: () => void;
}) {
  const guard = useDirtyCloseGuard(onClose);
  return (
    <>
      <Modal open={bookingId !== null} onClose={guard.requestClose} title="Pasar a Admisiones" maxWidth={620} fullScreenOnPhone>
        {bookingId !== null && (
          <PassBody key={bookingId} bookingId={bookingId} parentName={parentName} bookingStatus={bookingStatus} onClose={onClose}
            onCancel={guard.requestClose} onDirty={guard.reportDirty} />
        )}
      </Modal>
      {guard.dialog}
    </>
  );
}

function PassBody({ bookingId, parentName, bookingStatus, onClose, onCancel, onDirty }: {
  bookingId: number;
  parentName?: string;
  bookingStatus?: string;
  onClose: () => void;
  onCancel: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['booking-admissions', bookingId],
    queryFn: async () => (await bookingsApi.getBookingAdmissions(bookingId)).data,
    staleTime: 0,
  });
  if (isLoading) return <div className="py-8"><LoadingSpinner /></div>;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;
  return <PassForm bookingId={bookingId} parentName={parentName} bookingStatus={bookingStatus} data={data} onClose={onClose} onCancel={onCancel} onDirty={onDirty} />;
}

function PassForm({ bookingId, parentName, bookingStatus, data, onClose, onCancel, onDirty }: {
  bookingId: number;
  parentName?: string;
  bookingStatus?: string;
  data: BookingAdmissions;
  onClose: () => void;
  onCancel: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  // A Visitas-only account may start the case but not open Admisiones.
  const mayOpenCases = canOpen(user, '/admin/admisiones');
  const start = initial(data.prefill);
  const [form, setForm] = useState<Form>(start);
  useReportDirty(valuesDiffer(form, start), onDirty);
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const [busy, setBusy] = useState<'create' | number | null>(null);
  const cycles = cycleChoices();
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setForm((f) => ({ ...f, [k]: v })); setErrors({}); };

  if (data.case) {
    // Linked meanwhile (another tab, or the Expediente's visit link).
    return (
      <div className="space-y-4 pb-6">
        <p className="text-sm text-muted">
          Esta visita ya está en el expediente de <span className="font-semibold text-ink">{data.case.child_name || parentName}</span>,
          en «{data.case.stage_label}».
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cerrar</Button>
          {mayOpenCases && (
            <Button type="button" onClick={() => { onClose(); navigate(`/admin/admisiones/${data.case!.id}`); }}>
              <FolderOpen className="h-4 w-4" aria-hidden="true" /> Ver expediente
            </Button>
          )}
        </div>
      </div>
    );
  }

  const send = async (body: PassToAdmissionsBody, which: 'create' | number) => {
    setBusy(which);
    try {
      const res = await bookingsApi.passToAdmissions(bookingId, body);
      void invalidateEntity(qc, BOOKINGS_ENTITY, [CASES_ENTITY]);
      const child = res.data.case.child_name;
      onClose();
      if (mayOpenCases) {
        toast.success(res.data.created ? `Expediente creado: ${child}.` : `Visita agregada al expediente de ${child}.`);
        navigate(`/admin/admisiones/${res.data.case.id}`);
      } else {
        toast.success(res.data.created
          ? `Expediente creado: ${child}. El equipo de Admisiones ya lo ve en su lista.`
          : `Visita agregada al expediente de ${child}. El equipo de Admisiones ya lo ve.`);
      }
    } catch (e) {
      setErrors(errorsFrom(e, 'No se pudo pasar la visita a Admisiones.'));
    } finally {
      setBusy(null);
    }
  };

  const create = () => {
    const local = validate(form);
    if (Object.keys(local).length) { setErrors(local); return; }
    void send({
      child_name: form.child_name.trim(),
      parent_name: form.parent_name.trim(),
      parent_phone: form.parent_phone.trim(),
      parent_email: form.parent_email.trim(),
      grade_applying: form.grade_applying,
      cycle: form.cycle,
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
    }, 'create');
  };

  const field = (k: Exclude<keyof Form, 'cycle'>) => ({
    value: form[k],
    onChange: (e: { target: { value: string } }) => set(k, e.target.value),
    error: errors[k],
  });
  const dupes = data.duplicates;
  const wrote = data.prefill.child_grade_text.trim();

  return (
    <form noValidate className="flex flex-1 flex-col" onSubmit={(e) => { e.preventDefault(); create(); }}>
      <div className="flex-1 space-y-4 pb-4">
        <p className="text-sm text-muted">
          Crea el expediente de admisión con los datos que la familia dio al agendar la visita. Revíselos y complete lo que falte.{' '}
          {bookingStatus === 'cancelled' || bookingStatus === 'no_show'
            ? 'Como la visita no se realizó, el expediente empieza en «Informes».'
            : 'El expediente queda en «Visita guiada», con esta visita.'}
        </p>

        {dupes.length > 0 && (
          <div className="space-y-2 rounded-md border border-amber/40 bg-amber/10 p-3" role="alert">
            <p className="flex items-start gap-2 text-sm font-semibold text-ink">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" aria-hidden="true" />
              {dupes.length === 1
                ? 'Ya hay un expediente con este celular o correo.'
                : `Ya hay ${dupes.length} expedientes con este celular o correo.`}
            </p>
            <ul className="space-y-1.5" aria-label="Expedientes de esta familia">
              {dupes.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-sm bg-white px-3 py-2 text-sm">
                  <span className="min-w-0">
                    {mayOpenCases
                      ? <Link to={`/admin/admisiones/${d.id}`} className="font-semibold text-purple underline" onClick={onClose}>{d.child_name}</Link>
                      : <span className="font-semibold text-ink">{d.child_name}</span>}
                    <span className="block text-xs text-muted">{d.parent_name} · {d.grade_applying} · {fmtDay(d.created_at)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <StageChip stage={d.stage} outcome={d.closed_outcome_label} short />
                    <Button type="button" size="sm" variant="secondary" loading={busy === d.id} disabled={busy !== null}
                      aria-label={`Agregar la visita al expediente de ${d.child_name}`}
                      onClick={() => void send({ link_to: d.id }, d.id)}>
                      Vincular a este
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">Si es el mismo alumno, vincule la visita a su expediente. Si es otro hijo de la familia, cree uno nuevo abajo.</p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Input id="pa-child" label="Nombre del alumno" autoComplete="off" {...field('child_name')} />
          <Input id="pa-parent" label="Nombre del tutor" autoComplete="off" {...field('parent_name')} />
          <Input id="pa-phone" label="Celular" type="tel" inputMode="tel" autoComplete="off" placeholder="55 1234 5678" {...field('parent_phone')} />
          <Input id="pa-email" label="Correo (opcional)" type="email" autoComplete="off" {...field('parent_email')} />
          <SelectField id="pa-grade" label="Grado al que ingresa" placeholder="Elija el grado" options={GRADE_OPTIONS}
            hint={wrote && !data.prefill.grade_applying ? `Al agendar escribió «${wrote}».` : undefined}
            {...field('grade_applying')} />
        </div>
        <ChoiceGroup
          legend="Ciclo"
          name="pa-cycle"
          value={form.cycle}
          onChange={(v) => set('cycle', v)}
          error={errors.cycle}
          options={[
            { value: 'actual', label: cycles[0].label },
            { value: 'proximo', label: cycles[1].label },
          ]}
        />
        <div>
          <label className="label" htmlFor="pa-notes">Notas (opcional)</label>
          <textarea id="pa-notes" className="input-field" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
        <ErrorSummary errors={errors} labels={LABELS} />
      </div>
      <div className="sticky bottom-0 -mx-4 flex flex-col-reverse gap-2 border-t border-line bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:flex-row sm:justify-end sm:border-0 sm:px-0 sm:pb-6">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" loading={busy === 'create'} disabled={busy !== null}>
          {dupes.length > 0 ? 'Crear un expediente nuevo' : 'Crear expediente'}
        </Button>
      </div>
    </form>
  );
}

export default PassToAdmissionsDialog;
