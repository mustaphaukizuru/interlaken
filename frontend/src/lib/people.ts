/**
 * Pupils and staff cafetería accounts (2026-11-18): the labels the console
 * and «Mi cafetería» share. A staff member is a StudentProfile with
 * `tipo: 'personal'` (no grade; a puesto). Only admin and portal chunks import
 * this module (never the public home page bundle).
 */
import type { PersonTipo, StaffPuesto, StudentProfile } from '@/types';

export const PUESTO_LABEL: Record<StaffPuesto, string> = {
  sin_asignar: 'Sin asignar',
  direccion: 'Dirección',
  coordinacion: 'Coordinación',
  docente: 'Docente',
  administracion: 'Administración',
  apoyo_escolar: 'Apoyo escolar (psicología, enfermería)',
  mantenimiento: 'Mantenimiento e intendencia',
  seguridad: 'Seguridad',
  cafeteria: 'Cafetería',
  otro: 'Otro',
};

export const PUESTO_OPTIONS = (Object.keys(PUESTO_LABEL) as StaffPuesto[])
  .map((value) => ({ value, label: PUESTO_LABEL[value] }));

export const TIPO_LABEL: Record<PersonTipo, string> = {
  alumno: 'Alumno',
  personal: 'Personal del colegio',
};

/** A staff member's cafetería account (not a pupil). */
export const isStaffAccount = (p?: Pick<StudentProfile, 'tipo'> | null) => p?.tipo === 'personal';

/** «3° Primaria A» for a pupil, the puesto for a staff member. */
export function gradeOrPuesto(p: Pick<StudentProfile, 'tipo' | 'grade' | 'group' | 'puesto_label'>): string {
  if (p.tipo === 'personal') return p.puesto_label || 'Sin asignar';
  return `${p.grade} ${p.group}`.trim();
}

/**
 * The «Estado» filter of the cafetería lists (A8): active people by default
 * (no URL param), the rest on demand. Maps the URL value to the API's
 * `student_status` (`all` = every status).
 */
export const PERSON_STATUS_OPTIONS = [
  { value: 'on_leave', label: 'Baja temporal' },
  { value: 'graduated', label: 'Egresados' },
  { value: 'withdrawn', label: 'Baja definitiva' },
  { value: 'inactive', label: 'Todos los no activos' },
  { value: 'archived', label: 'Archivados' },
  { value: 'todos', label: 'Todos los estados' },
];

export function personStatusParam(urlValue: string | null | undefined): string | undefined {
  const v = (urlValue ?? '').trim();
  if (!v || v === 'active') return 'active';
  if (v === 'todos') return undefined;
  return v;
}

export const PERSON_TIPO_OPTIONS = [
  { value: 'alumno', label: 'Solo alumnos' },
  { value: 'personal', label: 'Solo personal' },
];
