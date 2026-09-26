/**
 * auditDiff.ts — read an AuditLog `changes` payload as a before/after diff and
 * link an audited object to its admin page (BACKLOG P4-8, Data Ops Phase 7).
 *
 * Signal-audited updates store `{field: [before, after]}`; explicit `record()`
 * calls add context keys (`reason`, `note`, `bulk`, counts). The drawer shows
 * the first kind as a two-column diff and the rest as plain details.
 */

export interface AuditDiffRow {
  field: string;
  before: string;
  after: string;
  changed: boolean;
}

export interface AuditDetailRow {
  field: string;
  value: string;
}

const EMPTY = '—';

/** Human text for one stored value (JSON for objects, "—" for empty). */
export function auditValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return EMPTY;
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Split `changes` into diff rows (`[before, after]` pairs) and detail rows (everything else). */
export function splitChanges(changes: unknown): { diff: AuditDiffRow[]; details: AuditDetailRow[] } {
  const diff: AuditDiffRow[] = [];
  const details: AuditDetailRow[] = [];
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return { diff, details };
  for (const [field, value] of Object.entries(changes as Record<string, unknown>)) {
    if (Array.isArray(value) && value.length === 2) {
      const before = auditValue(value[0]);
      const after = auditValue(value[1]);
      diff.push({ field, before, after, changed: before !== after });
    } else {
      details.push({ field, value: auditValue(value) });
    }
  }
  return { diff, details };
}

/** Admin console route for an audited object, when one exists. */
export function auditObjectLink(objectType: string, objectId: string): { to: string; label: string } | null {
  const id = encodeURIComponent(objectId);
  switch (objectType) {
    case 'accounts.studentprofile':
      return { to: `/admin/alumnos/${id}`, label: 'Abrir ficha del alumno' };
    case 'accounts.user':
      return { to: '/admin/usuarios', label: 'Ir a Usuarios' };
    case 'accounts.passwordrequest':
      return { to: '/admin/contrasenas', label: 'Ir a Contraseñas' };
    case 'admissions.preregistration':
    case 'admissions.registration':
      return { to: '/admin/admisiones', label: 'Ir a Admisiones' };
    case 'bookings.booking':
      return { to: '/admin/visitas', label: 'Ir a Visitas' };
    case 'payments.payment':
      return { to: '/admin/pagos', label: 'Ir a Pagos' };
    case 'cafeteria.cafeteriabalance':
    case 'cafeteria.cafeteriatransaction':
    case 'cafeteria.topuprequest':
    case 'cafeteria.balanceadjustment':
      return { to: '/admin/cafeteria', label: 'Ir a Cafetería' };
    case 'core.contactmessage':
      return { to: '/admin/mensajes', label: 'Ir a Mensajes' };
    case 'legal.arcorequest':
      return { to: '/admin/arco', label: 'Ir a Solicitudes ARCO' };
    case 'portal.announcement':
      return { to: '/admin/comunicados', label: 'Ir a Comunicados' };
    case 'content.page':
      return { to: `/admin/contenido/${id}`, label: 'Abrir página' };
    default:
      return null;
  }
}
