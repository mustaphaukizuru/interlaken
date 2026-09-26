/** Shared admissions status metadata for the Admisiones console, bulk dialogs and the review modal. */
export type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

/** Registration lifecycle → badge label + variant. */
export const STATUS_BADGE: Record<string, { label: string; variant: BadgeVariant }> = {
  draft:     { label: 'Borrador',    variant: 'neutral' },
  submitted: { label: 'Enviado',     variant: 'info' },
  reviewing: { label: 'En Revisión', variant: 'warning' },
  approved:  { label: 'Aprobado',    variant: 'success' },
  rejected:  { label: 'Rechazado',   variant: 'error' },
  complete:  { label: 'Completa',    variant: 'success' },
};

/** Review states an admin can set from the modal (`complete` only through "Convertir en alumno"). */
export const REGISTRATION_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'submitted', label: 'Enviado' },
  { value: 'reviewing', label: 'En Revisión' },
  { value: 'approved',  label: 'Aprobado' },
  { value: 'rejected',  label: 'Rechazado' },
];

/** Pre-registro lifecycle → label + variant. */
export const PREREG_STATUS: Record<string, { label: string; variant: BadgeVariant }> = {
  pending:   { label: 'Pendiente',   variant: 'warning' },
  contacted: { label: 'Contactado',  variant: 'info' },
  enrolled:  { label: 'Inscrito',    variant: 'success' },
  rejected:  { label: 'No procedió', variant: 'error' },
};

export const PREREG_LEVELS: { value: string; label: string }[] = [
  { value: 'preescolar', label: 'Preescolar' },
  { value: 'primaria',   label: 'Primaria' },
  { value: 'secundaria', label: 'Secundaria' },
];

/**
 * Mirrors `backend/apps/core/transitions.py` (the server is the authority; this
 * only decides which choices the UI offers and when it asks for a note).
 */
export const PREREG_TRANSITIONS: Record<string, string[]> = {
  pending:   ['contacted', 'enrolled', 'rejected'],
  contacted: ['enrolled', 'rejected', 'pending'],
  rejected:  ['pending'],
  enrolled:  [],
};

export const REGISTRATION_TRANSITIONS: Record<string, string[]> = {
  submitted: ['reviewing', 'approved', 'rejected'],
  reviewing: ['approved', 'rejected', 'submitted'],
  approved:  ['reviewing'],
  rejected:  ['reviewing'],
  draft:     [],
  complete:  [],
};

const REVERSE = new Set([
  'preregistration:contacted>pending',
  'preregistration:rejected>pending',
  'registration:reviewing>submitted',
  'registration:approved>reviewing',
  'registration:rejected>reviewing',
]);

/** Undoing a decision needs a note (audited with it). */
export function isReverseTransition(entity: 'preregistration' | 'registration', from: string, to: string): boolean {
  return REVERSE.has(`${entity}:${from}>${to}`);
}
