/**
 * auditLabels.ts — Spanish words for core.AuditLog rows, once.
 *
 * The audit page and the dashboard's «Actividad reciente» read the same
 * entries; the landing page used to print the raw codes («update ·
 * studentprofile #12», «system»). Unknown codes fall back to a neutral word,
 * never to the code itself.
 */
import type { BadgeVariant } from '@/lib/status/importRow';

export const ACTION_LABEL: Record<string, string> = {
  create: 'Creación',
  update: 'Modificación',
  delete: 'Eliminación',
  permission: 'Permisos',
  export: 'Exportación',
  import: 'Importación',
};

/** Past-tense verb for a feed line: «Ana López modificó un alumno». */
const ACTION_VERB: Record<string, string> = {
  create: 'creó',
  update: 'modificó',
  delete: 'eliminó',
  permission: 'cambió permisos de',
  export: 'exportó',
  import: 'importó',
};

export const ACTION_VARIANT: Record<string, Exclude<BadgeVariant, 'neutral'>> = {
  create: 'success',
  update: 'info',
  delete: 'error',
  permission: 'warning',
  export: 'info',
  import: 'info',
};

/** `app.model` (or the bare model name) → «un alumno», «una recarga». */
const OBJECT_LABEL: Record<string, string> = {
  studentprofile: 'un alumno',
  parentprofile: 'un tutor',
  user: 'un usuario',
  family: 'una familia',
  passwordrequest: 'una solicitud de contraseña',
  preregistration: 'un pre-registro',
  registration: 'una inscripción',
  registrationdocument: 'un documento',
  requireddocument: 'un documento requerido',
  booking: 'una visita',
  availabilityslot: 'un horario de visita',
  payment: 'un pago',
  cafeteriabalance: 'un saldo',
  cafeteriatransaction: 'un movimiento',
  topuprequest: 'una recarga',
  balanceadjustment: 'un ajuste de saldo',
  contactmessage: 'un mensaje',
  arcorequest: 'una solicitud ARCO',
  announcement: 'un comunicado',
  page: 'una página',
  form: 'un formulario',
  formsubmission: 'una respuesta de formulario',
  media: 'un archivo',
  testimonial: 'un testimonio',
  sitesettings: 'los ajustes del sitio',
};

export const actionLabel = (action: string, display?: string) =>
  display || ACTION_LABEL[action] || 'Cambio';

export function objectLabel(objectType: string): string {
  const model = objectType.split('.').pop()?.toLowerCase() ?? '';
  return OBJECT_LABEL[model] ?? 'un registro';
}

/** The actor of a row; an empty label is the system (cron, webhook, signal). */
export const actorLabel = (label: string | null | undefined) => label?.trim() || 'Sistema';

/** «modificó un alumno» */
export function activitySentence(action: string, objectType: string): string {
  return `${ACTION_VERB[action] ?? 'cambió'} ${objectLabel(objectType)}`;
}
