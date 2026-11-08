import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { History } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { splitChanges } from '@/lib/auditDiff';
import { STUDENT_STATUS } from '@/lib/studentStatus';
import type { AuditLogEntry } from '@/types';

type Variant = 'success' | 'info' | 'error' | 'warning' | 'neutral';

const ACTION: Record<string, { label: string; variant: Variant }> = {
  create: { label: 'Alta', variant: 'success' },
  update: { label: 'Cambio', variant: 'info' },
  delete: { label: 'Eliminación', variant: 'error' },
  permission: { label: 'Permisos', variant: 'warning' },
  export: { label: 'Exportación', variant: 'neutral' },
  import: { label: 'Importación', variant: 'neutral' },
};

/** Which row of a group names it: the strongest action wins. */
const WEIGHT: Record<string, number> = { delete: 5, create: 4, permission: 3, import: 2, update: 1, export: 0 };

/** Field names as the office reads them; anything not listed is left out of the summary. */
const FIELD: Record<string, string> = {
  first_name: 'Nombre', last_name: 'Apellidos', email: 'Correo', grade: 'Grado', group: 'Grupo',
  status: 'Estado', is_active: 'Puede entrar', archived: 'Archivado', loyverse_id: 'Loyverse',
  student_id: 'Matrícula', birth_date: 'Nacimiento', curp: 'CURP', emergency_phone: 'Tel. de emergencia',
  blood_type: 'Tipo de sangre', allergies: 'Alergias', medical_notes: 'Notas médicas', role: 'Rol',
  staff_title: 'Puesto', staff_areas: 'Áreas', password: 'Contraseña', sessions_revoked: 'Sesiones cerradas',
  reason: 'Motivo', enrollment_date: 'Ingreso', notify_email: 'Correo para avisos',
};

const VALUE: Record<string, string> = {
  ...Object.fromEntries(Object.entries(STUDENT_STATUS).map(([k, v]) => [k, v.label])),
  admin: 'Administrador', staff: 'Personal', student: 'Alumno', parent: 'Tutor',
};

const show = (v: string) => VALUE[v] ?? v;

/**
 * The technical `context` tags as the office reads them. A tag that names a
 * screen of the portal ("portal: edición de alumno") keeps its own words;
 * anything else unknown is left out rather than shown raw.
 */
const CONTEXT: [RegExp, string][] = [
  [/^bulk:/, ''], // the badge already says what the action did
  [/^import:loyverse/, 'Importación desde Loyverse'],
  [/^import:/, 'Importación de archivo'],
  [/^system:sync_roster/, 'Sincronización con Loyverse'],
  [/^student\.personal$/, 'Ficha del alumno'],
  [/^student\.medical$/, 'Datos médicos'],
  [/^account\.permission$/, 'Acceso al portal'],
  [/^accounts\.(staff_)?set_password$/, 'Contraseña'],
  [/^accounts\.notify_email$/, 'Correo para avisos'],
  [/^cafeteria\.wallet$/, 'Monedero de cafetería'],
  [/^cafeteria\.topup/, 'Recarga de cafetería'],
  [/^cafeteria\.refund/, 'Reembolso de cafetería'],
  [/^cafeteria\.relink$/, 'Vínculo con Loyverse'],
  [/^payments/, 'Pagos'],
  [/^guardian\.merge$/, 'Fusión de tutores'],
  [/^school-year\.rollover$/, 'Cambio de ciclo escolar'],
  [/^retention\.purge$/, 'Depuración de datos'],
  [/^cms\./, 'Contenido del sitio'],
  [/^portal\.announcement$/, 'Comunicados'],
];

function contextLabel(context: string): string {
  if (!context) return '';
  for (const [pattern, label] of CONTEXT) if (pattern.test(context)) return label;
  const screen = /^[\w-]+: (.+)$/.exec(context);
  if (screen) return screen[1].charAt(0).toUpperCase() + screen[1].slice(1);
  return context.includes(' ') ? context : '';
}

/** What the row did, from the outcome the server wrote: an archive is not an erasure. */
function badgeOf(entry: AuditLogEntry): { label: string; variant: Variant } {
  const outcome = entry.changes?.outcome;
  const archived = entry.changes?.archived;
  if (outcome === 'erased') return { label: 'Eliminación', variant: 'error' };
  if (outcome === 'archived' || (Array.isArray(archived) && archived[1] === true)) return { label: 'Archivo', variant: 'neutral' };
  if (outcome === 'restored' || (Array.isArray(archived) && archived[1] === false)) return { label: 'Restauración', variant: 'success' };
  return ACTION[entry.action] ?? { label: entry.action_display || entry.action, variant: 'neutral' };
}

/** One audit row as short sentences: "Grado: 1° Primaria → 2° Primaria". */
function describe(entry: AuditLogEntry): string[] {
  const { diff, details } = splitChanges(entry.changes);
  const lines = diff
    .filter((d) => FIELD[d.field] && d.changed)
    .map((d) => `${FIELD[d.field]}: ${show(d.before)} → ${show(d.after)}`);
  for (const d of details) {
    if (!FIELD[d.field]) continue;
    if (d.field === 'sessions_revoked' && d.value === '0') continue;
    lines.push(`${FIELD[d.field]}: ${show(d.value)}`);
  }
  return lines;
}

/** Automated rows carry "system" or "system:<job>"; the office reads them as Sistema. */
const actorOf = (label: string) => (!label || /^system(:|$)/.test(label) ? 'Sistema' : label);

/** Rows one action wrote together: same person, same subject, within a few seconds. */
const SAME_ACTION_MS = 3000;

function groupRows(entries: AuditLogEntry[]): AuditLogEntry[][] {
  const groups: AuditLogEntry[][] = [];
  for (const e of entries) {
    const head = groups[groups.length - 1]?.[0];
    const together = head
      && head.actor_label === e.actor_label
      && (head.object_label ?? '') === (e.object_label ?? '')
      && Math.abs(Date.parse(head.created_at) - Date.parse(e.created_at)) <= SAME_ACTION_MS;
    if (together) groups[groups.length - 1].push(e);
    else groups.push([e]);
  }
  return groups;
}

/**
 * Who changed what, and when: a student's Historial and a user's recent
 * activity. Reads the same append-only Auditoría rows, newest first, and folds
 * the rows one action wrote (the file, its login, the action's own record)
 * into a single entry named after what the action did.
 */
export function AuditTimeline({ entries, empty = 'Aún no hay cambios registrados.', showActor = true }: {
  entries: AuditLogEntry[];
  empty?: string;
  /** Off in one person's own activity feed, where every row is theirs. */
  showActor?: boolean;
}) {
  if (entries.length === 0) {
    return <EmptyState icon={History} title="Sin movimientos" description={empty} />;
  }
  return (
    <ol className="relative space-y-4 border-l border-line pl-5">
      {groupRows(entries).map((group) => {
        const main = group.reduce((a, b) => (
          (b.changes?.outcome ? 10 : 0) + (WEIGHT[b.action] ?? 0) > (a.changes?.outcome ? 10 : 0) + (WEIGHT[a.action] ?? 0) ? b : a
        ));
        const badge = badgeOf(main);
        const lines = Array.from(new Set([main, ...group.filter((e) => e !== main)].flatMap(describe)));
        const where = contextLabel(main.context) || (main.changes?.outcome ? '' : group.map((e) => contextLabel(e.context)).find(Boolean) ?? '');
        return (
          <li key={group[0].id} className="relative">
            <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-purple ring-1 ring-line" aria-hidden="true" />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Badge variant={badge.variant}>{badge.label}</Badge>
              {main.object_label && <span className="text-sm font-semibold text-ink">{main.object_label}</span>}
              <time dateTime={group[0].created_at} className="text-xs text-subtle">
                {format(new Date(group[0].created_at), "d MMM yyyy, HH:mm", { locale: es })}
              </time>
              {showActor && <span className="text-xs text-muted">· {actorOf(main.actor_label)}</span>}
            </div>
            {lines.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-sm text-ink">
                {lines.map((line) => <li key={line} className="break-words">{line}</li>)}
              </ul>
            )}
            {where && <p className="mt-1 text-xs text-subtle">{where}</p>}
          </li>
        );
      })}
    </ol>
  );
}

export default AuditTimeline;
