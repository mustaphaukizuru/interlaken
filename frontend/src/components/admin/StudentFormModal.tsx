import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { portalApi, type StudentWrite, type StudentStatus } from '@/services/api';
import { STUDENT_STATUS } from '@/lib/studentStatus';
import type { StudentProfile } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Existing student to edit; omit to create. */
  student?: StudentProfile | null;
  onSaved?: (student: StudentProfile) => void;
}

export type FieldErrors = Partial<Record<keyof StudentWrite | 'detail', string>>;

/** DRF `{field: [msg]}` / `{detail}` payload → per-field messages (first message wins). */
export function fieldErrorsFrom(err: unknown): FieldErrors | null {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (!data || typeof data !== 'object') return null;
  const next: FieldErrors = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    next[k as keyof FieldErrors] = Array.isArray(v) ? String(v[0]) : String(v);
  }
  return next;
}

const GRADES = [
  'Maternal', '1° Preescolar', '2° Preescolar', '3° Preescolar',
  '1° Primaria', '2° Primaria', '3° Primaria', '4° Primaria', '5° Primaria', '6° Primaria',
  '1° Secundaria', '2° Secundaria', '3° Secundaria',
];

function initial(student?: StudentProfile | null): StudentWrite {
  return {
    first_name: student?.user.first_name ?? '',
    last_name: student?.user.last_name ?? '',
    email: student?.user.email && !student.user.email.endsWith('@alumnos.interlaken.edu.mx') ? student.user.email : '',
    student_id: student?.student_id ?? '',
    grade: student?.grade ?? '',
    group: student?.group ?? '',
    enrollment_date: student?.enrollment_date ?? '',
    is_active: student?.is_active ?? true,
    status: student?.status ?? 'active',
  };
}

/**
 * Create / edit a student from the portal (BACKLOG P1-A1). Mirrors the CSV
 * importer: without a real email the backend mints the synthetic
 * `<matrícula>@alumnos…` login; passwords are always assigned by an admin.
 */
export function StudentFormModal({ open, onClose, student, onSaved }: Props) {
  const qc = useQueryClient();
  const editing = !!student;
  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Editar alumno' : 'Nuevo alumno'} maxWidth={560}>
      {/* Keyed so each open starts from the current student (no effect-driven reset). */}
      <StudentForm key={`${open}-${student?.id ?? 'new'}`} student={student} onClose={onClose} onSaved={onSaved} qc={qc} />
    </Modal>
  );
}

function StudentForm({ student, onClose, onSaved, qc }: {
  student?: StudentProfile | null; onClose: () => void; onSaved?: (s: StudentProfile) => void;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const editing = !!student;
  const [form, setForm] = useState<StudentWrite>(() => initial(student));
  const [errors, setErrors] = useState<FieldErrors>({});

  const set = <K extends keyof StudentWrite>(k: K, v: StudentWrite[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: StudentWrite = { ...form, enrollment_date: form.enrollment_date || null };
      const { data } = editing
        ? await portalApi.updateStudent(student!.id, payload)
        : await portalApi.createStudent(payload);
      return data as StudentProfile;
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['admin-students'] });
      qc.invalidateQueries({ queryKey: ['admin-student', String(saved.id)] });
      toast.success(editing ? 'Alumno actualizado.' : 'Alumno creado.');
      onSaved?.(saved);
      onClose();
    },
    onError: (err: unknown) => {
      const next = fieldErrorsFrom(err);
      if (next) {
        setErrors(next);
        toast.error(next.detail ?? 'Revise los campos marcados.');
      } else {
        toast.error('No se pudo guardar el alumno.');
      }
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: FieldErrors = {};
    if (!form.first_name.trim()) next.first_name = 'Requerido.';
    if (!form.last_name.trim()) next.last_name = 'Requerido.';
    if (!form.student_id.trim()) next.student_id = 'Requerido.';
    if (!form.grade.trim()) next.grade = 'Requerido.';
    if (Object.keys(next).length) { setErrors(next); return; }
    mutation.mutate();
  };

  return (
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Nombre(s)" value={form.first_name} onChange={(e) => set('first_name', e.target.value)} error={errors.first_name} autoComplete="off" required />
          <Input label="Apellidos" value={form.last_name} onChange={(e) => set('last_name', e.target.value)} error={errors.last_name} autoComplete="off" required />
          <Input label="Matrícula" value={form.student_id} onChange={(e) => set('student_id', e.target.value.toUpperCase())} error={errors.student_id} autoComplete="off" required />
          <div>
            <label className="label" htmlFor="sf-grade">Grado</label>
            <select id="sf-grade" className="input-field min-h-[44px]" value={form.grade} onChange={(e) => set('grade', e.target.value)} aria-invalid={!!errors.grade || undefined}>
              <option value="">Seleccione…</option>
              {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
              {form.grade && !GRADES.includes(form.grade) && <option value={form.grade}>{form.grade}</option>}
            </select>
            {errors.grade && <p className="mt-1.5 text-xs text-coral-600">{errors.grade}</p>}
          </div>
          <Input label="Grupo" value={form.group ?? ''} onChange={(e) => set('group', e.target.value.toUpperCase())} error={errors.group} maxLength={5} placeholder="A" />
          <Input label="Fecha de ingreso" type="date" value={form.enrollment_date ?? ''} onChange={(e) => set('enrollment_date', e.target.value)} error={errors.enrollment_date} />
        </div>
        <Input
          label="Correo del alumno (opcional)"
          type="email"
          value={form.email ?? ''}
          onChange={(e) => set('email', e.target.value)}
          error={errors.email}
          hint="Vacío = acceso con matrícula@alumnos.interlaken.edu.mx. La contraseña la asigna un administrador."
          inputMode="email"
          autoComplete="off"
        />
        <div>
          <label className="label" htmlFor="sf-status">Estado</label>
          <select id="sf-status" className="input-field min-h-[44px]" value={form.status ?? 'active'} onChange={(e) => set('status', e.target.value as StudentStatus)}>
            {Object.entries(STUDENT_STATUS).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
          </select>
          <p className="mt-1.5 text-xs text-subtle">Si no está activo, su acceso familiar al portal se desactiva y deja de recibir comunicados y sincronización de cafetería.</p>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} className="min-h-[44px]">Cancelar</Button>
          <Button type="submit" loading={mutation.isPending} className="min-h-[44px]">
            {editing ? 'Guardar cambios' : 'Crear alumno'}
          </Button>
        </div>
      </form>
  );
}

export default StudentFormModal;
