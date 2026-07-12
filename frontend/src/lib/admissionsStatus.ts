/** Shared admissions status metadata for the Inscripciones console + review modal. */
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

/** Review states an admin can set from the modal. */
export const REGISTRATION_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'submitted', label: 'Enviado' },
  { value: 'reviewing', label: 'En Revisión' },
  { value: 'approved',  label: 'Aprobado' },
  { value: 'rejected',  label: 'Rechazado' },
  { value: 'complete',  label: 'Inscripción Completa' },
];
