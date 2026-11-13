import type { RosterStudent } from '@/hooks/queries/students';
import type { FamilyRef, FamilyStudent, SuggestionConfidence } from '@/services/familiesApi';

/** A student as both the picker (roster rows) and the plan (family summaries) describe it. */
export interface PickedStudent {
  id: number;
  name: string;
  grade: string;
  group: string;
  student_id: string;
  family: FamilyRef | null;
}

export type FamilyLinkMode =
  /** From a student's file: link siblings to `anchor`. */
  | { kind: 'student'; anchor: PickedStudent }
  /** From a family: add students to it. */
  | { kind: 'family'; family: FamilyRef; memberIds: number[] }
  /** From the Familias table: pick two or more. */
  | { kind: 'new' };

export const fromRoster = (s: RosterStudent): PickedStudent => ({
  id: s.id,
  name: s.user.full_name,
  grade: s.grade,
  group: s.group,
  student_id: s.student_id,
  family: s.family ?? null,
});

export const fromFamilyStudent = (s: FamilyStudent): PickedStudent => ({
  id: s.id, name: s.name, grade: s.grade, group: s.group, student_id: s.student_id, family: s.family,
});

export const gradeLine = (s: { grade: string; group: string }) => `${s.grade}${s.group ? ` ${s.group}` : ''}`;

export const initial = (name: string) => (name.trim().charAt(0) || '?').toUpperCase();

export function lastLoginLabel(iso: string | null) {
  if (!iso) return 'Nunca ha entrado';
  return `Último acceso: ${new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export const CONFIDENCE: Record<SuggestionConfidence, { label: string; short: string; variant: 'success' | 'warning' }> = {
  alta: { label: 'Confianza alta', short: 'Alta', variant: 'success' },
  media: { label: 'Confianza media', short: 'Media', variant: 'warning' },
};
