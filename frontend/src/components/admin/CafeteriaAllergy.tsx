import { AlertTriangle, ShieldCheck } from 'lucide-react';
import type { StudentProfile } from '@/types';

/**
 * Allergies in the cafetería console (2026-11-24). They come only while the
 * school's «La cafetería ve las alergias» switch is on (Ajustes), and only for
 * children whose family authorised health data (`allergies_shared`). With the
 * switch off the API sends nothing and these render nothing.
 */
type Student = Pick<StudentProfile, 'allergies' | 'allergies_shared' | 'tipo'>;

const allergyText = (s: Student) => (s.allergies_shared ? (s.allergies ?? '').trim() : '');

/** Compact marker next to a name in the console lists: only when there is something to watch for. */
export function AllergyTag({ student, className = '' }: { student: Student; className?: string }) {
  const text = allergyText(student);
  if (!text) return null;
  return (
    <span
      title={`Alergias: ${text}`}
      className={`inline-flex min-w-0 max-w-[16rem] items-center gap-1 rounded-full bg-coral-50 px-2 py-0.5 align-middle text-xs font-semibold text-coral-700 ring-1 ring-inset ring-coral-600/30 ${className}`.trim()}
    >
      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">Alergias: {text}</span>
    </span>
  );
}

/** The per-student page: the allergies, or why none are shown. */
export function AllergyNotice({ student }: { student: Student }) {
  if (student.allergies_shared === undefined) return null;
  const text = allergyText(student);
  if (text) {
    return (
      <div role="note" aria-label="Alergias" className="flex items-start gap-3 rounded-md border-2 border-coral-600/40 bg-coral-50 px-4 py-3 text-ink">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-coral-600" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-semibold text-coral-700">Alergias: <span className="break-words">{text}</span></p>
          <p className="mt-0.5 text-sm text-muted">Dato de salud que la familia autorizó. Tómelo en cuenta antes de servir o vender.</p>
        </div>
      </div>
    );
  }
  // A staff member's own wallet has no family: nothing to explain there.
  if (student.tipo === 'personal') return null;
  return (
    <p className="flex items-start gap-2 text-sm text-muted">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
      <span>
        {student.allergies_shared
          ? 'Sin alergias registradas.'
          : 'La familia no ha autorizado compartir los datos de salud: aquí no se ven sus alergias.'}
      </span>
    </p>
  );
}
