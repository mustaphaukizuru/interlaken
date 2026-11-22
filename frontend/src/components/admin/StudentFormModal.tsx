import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Lock, SearchX } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { portalApi, type StudentWrite, type StudentStatus } from '@/services/api';
import { STUDENT_STATUS } from '@/lib/studentStatus';
import { invalidateStudents, studentDetailKey } from '@/hooks/queries/studentKeys';
import { fieldErrorsOrNull } from '@/lib/apiErrors';
import { PUESTO_OPTIONS } from '@/lib/people';
import type { LoyverseLinkOutcome, PersonTipo, StudentProfile } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Existing student to edit; omit to create. */
  student?: StudentProfile | null;
  onSaved?: (student: StudentProfile) => void;
  /** A new record starts as this (the «Personal» tab creates staff). */
  defaultTipo?: PersonTipo;
}

export type FieldErrors = Partial<Record<keyof StudentWrite | 'detail', string>>;


const GRADES = [
  'Maternal', '1° Preescolar', '2° Preescolar', '3° Preescolar',
  '1° Primaria', '2° Primaria', '3° Primaria', '4° Primaria', '5° Primaria', '6° Primaria',
  '1° Secundaria', '2° Secundaria', '3° Secundaria',
];

function initial(student?: StudentProfile | null, defaultTipo: PersonTipo = 'alumno'): StudentWrite {
  return {
    tipo: student?.tipo ?? (student ? 'alumno' : defaultTipo),
    puesto: student?.puesto ?? '',
    first_name: student?.user.first_name ?? '',
    last_name: student?.user.last_name ?? '',
    email: student?.user.email && !student.user.email.endsWith('@alumnos.interlaken.edu.mx') ? student.user.email : '',
    student_id: student?.student_id ?? '',
    grade: student?.grade ?? '',
    group: student?.group ?? '',
    enrollment_date: student?.enrollment_date ?? '',
    is_active: student?.is_active ?? true,
    status: student?.status ?? 'active',
    birth_date: student?.birth_date ?? '',
    curp: student?.curp ?? '',
    emergency_name: student?.emergency_name ?? '',
    emergency_phone: student?.emergency_phone ?? '',
    emergency_rel: student?.emergency_rel ?? '',
    blood_type: student?.blood_type ?? '',
    allergies: student?.allergies ?? '',
    medical_notes: student?.medical_notes ?? '',
  };
}

/**
 * Create / edit a student from the portal (BACKLOG P1-A1). Mirrors the CSV
 * importer: without a real email the backend mints the synthetic
 * `<matrícula>@alumnos…` login; passwords are always assigned by an admin.
 */
export function StudentFormModal({ open, onClose, student, onSaved, defaultTipo = 'alumno' }: Props) {
  const qc = useQueryClient();
  const editing = !!student;
  // The title follows the selector («Alumno» / «Personal del colegio»).
  const [tipo, setTipo] = useState<PersonTipo>(student?.tipo ?? defaultTipo);
  const staff = tipo === 'personal';
  const title = editing
    ? (staff ? 'Editar personal' : 'Editar alumno')
    : (staff ? 'Nuevo personal del colegio' : 'Nuevo alumno');
  // A roster row carries no medical fields: editing from it would show blanks
  // (and once saved them over the real allergies). Load the file first, the
  // same query the student page uses.
  const needsFile = open && editing && student!.blood_type === undefined && !student!.medical_masked;
  const file = useQuery({
    queryKey: studentDetailKey(student?.id ?? 0),
    queryFn: async () => (await portalApi.getStudent(student!.id)).data as StudentProfile,
    enabled: needsFile,
  });
  const source = needsFile ? file.data : student;
  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth={640}>
      {needsFile && !source ? (
        file.isError ? (
          <div role="alert" className="space-y-4 py-2">
            <p className="text-sm text-ink">No se pudo cargar el expediente del alumno.</p>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => void file.refetch()} className="min-h-[44px]">Reintentar</Button>
              <Button type="button" variant="ghost" onClick={onClose} className="min-h-[44px]">Cancelar</Button>
            </div>
          </div>
        ) : (
          <p role="status" className="py-6 text-center text-sm text-muted">Cargando expediente…</p>
        )
      ) : (
        /* Keyed so each open starts from the current student (no effect-driven reset). */
        <StudentForm key={`${open}-${source?.id ?? 'new'}`} student={source} onClose={onClose} onSaved={onSaved} qc={qc}
          defaultTipo={defaultTipo} onTipo={setTipo} />
      )}
    </Modal>
  );
}

const MEDICAL_KEYS: ReadonlyArray<keyof StudentWrite> = ['blood_type', 'allergies', 'medical_notes'];

/** The record the server says already holds this matrícula (archived ones included). */
interface ExistingStudent { id: number; name: string; student_id: string; status: string; archived: boolean }

const existingOf = (err: unknown): ExistingStudent | null =>
  (err as { response?: { data?: { existing?: ExistingStudent } } })?.response?.data?.existing ?? null;

function StudentForm({ student, onClose, onSaved, qc, defaultTipo, onTipo }: {
  student?: StudentProfile | null; onClose: () => void; onSaved?: (s: StudentProfile) => void;
  qc: ReturnType<typeof useQueryClient>; defaultTipo: PersonTipo; onTipo: (t: PersonTipo) => void;
}) {
  const editing = !!student;
  // Masked for this account (staff, by role): the values are «●●●», never real.
  const medicalLocked = !!student?.medical_masked;
  const [form, setForm] = useState<StudentWrite>(() => initial(student, defaultTipo));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [existing, setExisting] = useState<ExistingStudent | null>(null);
  const [restoring, setRestoring] = useState(false);
  // A7: what saving did with Loyverse, shown before the modal closes.
  const [linked, setLinked] = useState<{ saved: StudentProfile; link: LoyverseLinkOutcome } | null>(null);
  const staff = form.tipo === 'personal';

  const set = <K extends keyof StudentWrite>(k: K, v: StudentWrite[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const setTipo = (t: PersonTipo) => {
    set('tipo', t);
    onTipo(t);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!editing) {
        const payload: StudentWrite = { ...form, enrollment_date: form.enrollment_date || null, birth_date: form.birth_date || null };
        if (payload.tipo === 'personal') {
          payload.grade = '';
          payload.group = '';
          payload.puesto = payload.puesto || 'sin_asignar';
        } else {
          delete payload.puesto;
        }
        return (await portalApi.createStudent(payload)).data as StudentProfile;
      }
      // Only what was changed: a field nobody touched is never re-sent (a
      // stale or masked value can not overwrite the record).
      const base = initial(student);
      const changed = (Object.keys(form) as (keyof StudentWrite)[])
        .filter((k) => form[k] !== base[k] && !(medicalLocked && MEDICAL_KEYS.includes(k)));
      const payload = Object.fromEntries(changed.map((k) => [k, form[k]])) as Partial<StudentWrite>;
      if ('enrollment_date' in payload) payload.enrollment_date = payload.enrollment_date || null;
      if ('birth_date' in payload) payload.birth_date = payload.birth_date || null;
      return (await portalApi.updateStudent(student!.id, payload)).data as StudentProfile;
    },
    onSuccess: (saved) => {
      // Roster list + this student's file (both under ['admin', 'students', ...]).
      void invalidateStudents(qc);
      const noun = saved?.tipo === 'personal' ? 'Personal' : 'Alumno';
      toast.success(editing ? `${noun} actualizado.` : `${noun} creado.`);
      onSaved?.(saved);
      // The save looked the person up in Loyverse: say what happened first.
      if (saved?.loyverse_link) setLinked({ saved, link: saved.loyverse_link });
      else onClose();
    },
    onError: (err: unknown) => {
      setExisting(existingOf(err));
      const next = fieldErrorsOrNull(err) as FieldErrors | null;
      if (next) {
        setErrors(next);
        toast.error(next.detail ?? 'Revise los campos marcados.');
      } else {
        toast.error('No se pudo guardar el alumno.');
      }
    },
  });

  // An archived student who comes back keeps their history: restore instead of re-creating.
  const restore = async () => {
    if (!existing) return;
    setRestoring(true);
    try {
      await portalApi.studentsBulk({ action: 'restore', ids: [existing.id], all_matching: false, payload: {}, dry_run: false });
      void invalidateStudents(qc);
      toast.success(`${existing.name} volvió a la lista como «Baja definitiva».`);
      onClose();
    } catch {
      toast.error('No se pudo restaurar. Use la pestaña Archivados.');
    } finally {
      setRestoring(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: FieldErrors = {};
    if (!form.first_name.trim()) next.first_name = 'Requerido.';
    if (!form.last_name.trim()) next.last_name = 'Requerido.';
    if (!form.student_id.trim()) next.student_id = 'Requerido.';
    if (!staff && !form.grade.trim()) next.grade = 'Requerido.';
    if (Object.keys(next).length) { setErrors(next); return; }
    mutation.mutate();
  };

  if (linked) return <LinkResult saved={linked.saved} link={linked.link} editing={editing} onClose={onClose} />;

  return (
      <form onSubmit={submit} className="space-y-4" noValidate>
        <fieldset>
          <legend className="label">Tipo de registro</legend>
          <div className="grid grid-cols-2 gap-1 rounded-md bg-cream-2 p-1">
            {([['alumno', 'Alumno'], ['personal', 'Personal del colegio']] as const).map(([value, label]) => {
              const on = (form.tipo ?? 'alumno') === value;
              return (
                <label
                  key={value}
                  className={`flex min-h-[44px] cursor-pointer items-center justify-center rounded-sm px-3 text-center text-sm font-semibold transition-colors focus-within:ring-2 focus-within:ring-purple/40 ${
                    on ? 'bg-white text-purple shadow-sm ring-1 ring-purple/15' : 'text-muted hover:text-ink'
                  }`}
                >
                  <input type="radio" name="sf-tipo" value={value} checked={on} onChange={() => setTipo(value)} className="sr-only" />
                  {label}
                </label>
              );
            })}
          </div>
          {staff && (
            <p className="mt-1.5 text-xs text-subtle">
              Para el personal que compra en cafetería: mismo saldo, recargas, estado de cuenta y credencial que un alumno.
              No cuenta como alumno ni recibe comunicados de familias.
            </p>
          )}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Nombre(s)" value={form.first_name} onChange={(e) => set('first_name', e.target.value)} error={errors.first_name} autoComplete="off" required />
          <Input label="Apellidos" value={form.last_name} onChange={(e) => set('last_name', e.target.value)} error={errors.last_name} autoComplete="off" required />
          <Input
            label={staff ? 'Código Loyverse' : 'Matrícula o código Loyverse'}
            value={form.student_id}
            onChange={(e) => set('student_id', e.target.value)}
            error={errors.student_id}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            hint={staff ? 'Como aparece en Loyverse (por ejemplo jperez).' : undefined}
            required
          />
          {staff ? (
            <div>
              <label className="label" htmlFor="sf-puesto">Puesto</label>
              <select id="sf-puesto" className="input-field min-h-[44px]" value={form.puesto || 'sin_asignar'} onChange={(e) => set('puesto', e.target.value as StudentWrite['puesto'])}>
                {PUESTO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label className="label" htmlFor="sf-grade">Grado</label>
              <select id="sf-grade" className="input-field min-h-[44px]" value={form.grade} onChange={(e) => set('grade', e.target.value)} aria-invalid={!!errors.grade || undefined}>
                <option value="">Seleccione…</option>
                {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                {form.grade && !GRADES.includes(form.grade) && <option value={form.grade}>{form.grade}</option>}
              </select>
              {errors.grade && <p className="mt-1.5 text-xs text-coral-600">{errors.grade}</p>}
            </div>
          )}
          {!staff && <Input label="Grupo" value={form.group ?? ''} onChange={(e) => set('group', e.target.value.toUpperCase())} error={errors.group} maxLength={5} placeholder="A" />}
          <Input label={staff ? 'Fecha de alta' : 'Fecha de ingreso'} type="date" value={form.enrollment_date ?? ''} onChange={(e) => set('enrollment_date', e.target.value)} error={errors.enrollment_date} />
        </div>
        <Input
          label={staff ? 'Correo escolar (Google)' : 'Correo del alumno (opcional)'}
          type="email"
          inputMode="email"
          autoComplete="off"
          value={form.email ?? ''}
          onChange={(e) => set('email', e.target.value)}
          error={errors.email}
          hint={staff
            ? 'Su cuenta de Google del colegio: con ella entra al portal a «Mi cafetería», y Loyverse lo busca primero por este correo. Si ya entra a la consola con este correo, la conserva.'
            : 'Escriba el correo escolar (ci…@interlaken.com.mx): con él la familia entra con Google y recibe los avisos. Vacío = una dirección interna sin buzón.'}
        />
        <fieldset className="space-y-4 rounded-md border border-line p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-subtle">Datos personales</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Fecha de nacimiento" type="date" value={form.birth_date ?? ''} onChange={(e) => set('birth_date', e.target.value)} error={errors.birth_date} />
            <Input label="CURP" value={form.curp ?? ''} onChange={(e) => set('curp', e.target.value.toUpperCase())} error={errors.curp} maxLength={18} autoComplete="off" />
          </div>
        </fieldset>
        <fieldset className="space-y-4 rounded-md border border-line p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-subtle">Contacto de emergencia</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Nombre" value={form.emergency_name ?? ''} onChange={(e) => set('emergency_name', e.target.value)} />
            <Input label="Teléfono" inputMode="tel" value={form.emergency_phone ?? ''} onChange={(e) => set('emergency_phone', e.target.value)} />
            <Input label="Parentesco" value={form.emergency_rel ?? ''} onChange={(e) => set('emergency_rel', e.target.value)} />
          </div>
        </fieldset>
        <fieldset className="space-y-4 rounded-md border border-coral/30 bg-coral-50/40 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-coral-600">Datos médicos (confidencial)</legend>
          {medicalLocked ? (
            <p className="flex items-start gap-2.5 text-sm text-muted">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-coral-600" aria-hidden="true" />
              <span>Solo administración ve y edita los datos médicos. Guardar este formulario no los cambia.</span>
            </p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="Tipo de sangre" value={form.blood_type ?? ''} onChange={(e) => set('blood_type', e.target.value.toUpperCase())} error={errors.blood_type} maxLength={10} placeholder="O+" />
                <Input label="Alergias" value={form.allergies ?? ''} onChange={(e) => set('allergies', e.target.value)} error={errors.allergies} hint="Visible en cafetería para evitar incidentes." />
              </div>
              <div>
                <label className="label" htmlFor="sf-med">Notas médicas</label>
                <textarea id="sf-med" className="input-field min-h-[80px]" value={form.medical_notes ?? ''} onChange={(e) => set('medical_notes', e.target.value)} aria-invalid={!!errors.medical_notes || undefined} aria-describedby={errors.medical_notes ? 'sf-med-error' : undefined} />
                {errors.medical_notes
                  ? <p id="sf-med-error" className="mt-1.5 text-xs text-coral-600">{errors.medical_notes}</p>
                  : <p className="mt-1.5 text-xs text-subtle">Cifrado en reposo; solo administración y la familia del alumno lo ven.</p>}
              </div>
            </>
          )}
        </fieldset>
        <div>
          <label className="label" htmlFor="sf-status">Estado</label>
          <select id="sf-status" className="input-field min-h-[44px]" value={form.status ?? 'active'} onChange={(e) => set('status', e.target.value as StudentStatus)}>
            {Object.entries(STUDENT_STATUS).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
          </select>
          <p className="mt-1.5 text-xs text-subtle">
            {staff
              ? 'Si no está activo, su acceso al portal se desactiva y deja de sincronizarse con cafetería.'
              : 'Si no está activo, su acceso familiar al portal se desactiva y deja de recibir comunicados y sincronización de cafetería.'}
          </p>
        </div>
        {!editing && existing && (
          <div role="alert" className="space-y-3 rounded-md border border-amber/40 bg-amber/[0.08] px-4 py-3 text-sm text-ink">
            <p className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" aria-hidden="true" />
              <span>
                La matrícula {existing.student_id} ya pertenece a <strong>{existing.name}</strong>
                {existing.archived ? ', que está archivado' : ''}. Use ese expediente en lugar de crear uno nuevo.
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Link to={`/admin/alumnos/${existing.id}`} onClick={onClose} className="btn-outline min-h-[44px] text-sm sm:min-h-[40px]">
                Abrir expediente
              </Link>
              {existing.archived && (
                <Button type="button" size="sm" loading={restoring} onClick={restore} className="min-h-[44px] sm:min-h-[40px]">
                  Restaurar a {existing.name.split(' ')[0]}
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} className="min-h-[44px]">Cancelar</Button>
          <Button type="submit" loading={mutation.isPending} className="min-h-[44px]">
            {editing ? 'Guardar cambios' : staff ? 'Crear personal' : 'Crear alumno'}
          </Button>
        </div>
      </form>
  );
}

/** A7: what the save did with Loyverse, in the office's words. */
function LinkResult({ saved, link, editing, onClose }: {
  saved: StudentProfile; link: LoyverseLinkOutcome; editing: boolean; onClose: () => void;
}) {
  const ok = link.status === 'linked' || link.status === 'already_linked';
  const pending = link.status === 'unreachable' || link.status === 'error';
  const Icon = ok ? CheckCircle2 : pending ? AlertTriangle : SearchX;
  const tone = ok ? 'border-green-600/25 bg-green-50 text-green-800' : 'border-amber/40 bg-amber/[0.08] text-ink';
  const noun = saved.tipo === 'personal' ? 'Personal' : 'Alumno';
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink">
        <strong>{saved.user?.full_name}</strong> · {noun} {editing ? 'actualizado' : 'creado'}.
      </p>
      <div role="status" className={`flex items-start gap-2.5 rounded-md border px-4 py-3 text-sm ${tone}`}>
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${ok ? 'text-green-700' : 'text-amber'}`} aria-hidden="true" />
        <div>
          <p className="font-semibold">{link.message}</p>
          {ok && link.customer_code && (
            <p className="mt-0.5 text-xs text-muted">
              Cliente {link.customer_code}{link.matched_by ? ` (por ${link.matched_by})` : ''}
              {link.replayed ? ` · ${link.replayed} compra(s) anteriores agregadas a su historial` : ''}
            </p>
          )}
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="button" onClick={onClose} className="min-h-[44px]">Listo</Button>
      </div>
    </div>
  );
}

export default StudentFormModal;
