import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import type { BulkActionDef, BulkResult } from '@/services/api';

/**
 * Taking people off the lists and back (owner, 2026-11-08), shared by the
 * roster, the student file and Usuarios. Each goes through BulkConfirmDialog,
 * so the person sees who is affected before anything runs.
 *
 * - Archivar: off every list, no sign-in, history and balance kept; reversible.
 * - Eliminar: erases a record with nothing to keep and archives the rest
 *   (the server decides per row and the plan says how many go each way).
 */
export const ARCHIVE_ACTION: BulkActionDef = {
  key: 'archive',
  name: 'archive',
  label: 'Archivar',
  icon: Archive,
  planVerb: 'Se archivarán',
};

export const RESTORE_ACTION: BulkActionDef = {
  key: 'restore',
  name: 'restore',
  label: 'Restaurar',
  icon: ArchiveRestore,
  planVerb: 'Se restaurarán',
};

export const DELETE_ACTION: BulkActionDef = {
  key: 'delete',
  name: 'delete',
  label: 'Eliminar',
  icon: Trash2,
  danger: true,
  planVerb: 'Eliminar afecta a',
  // The server refuses a delete without it; the dialog itself is the confirmation.
  payload: { confirm: 'ELIMINAR' },
};

type Audience = 'students' | 'staff';

const COPY: Record<Audience, { archive: string; restore: string; kept: string; keptOne: string }> = {
  students: {
    archive: 'Salen de todas las listas y ya no pueden entrar al portal. Su historial, sus pagos y su saldo se conservan, y puede restaurarlos desde Archivados.',
    restore: 'Vuelven a la lista como «Baja definitiva». Si regresan al colegio, use Cambiar estado → Activo.',
    kept: 'tienen pagos, compras, saldo o ya usaron el portal',
    keptOne: 'tiene pagos, compras, saldo o ya usó el portal',
  },
  staff: {
    archive: 'Salen de la lista, no pueden iniciar sesión y se cierran sus sesiones abiertas. Su actividad en Auditoría se conserva.',
    restore: 'Vuelven a la lista y pueden iniciar sesión de nuevo.',
    kept: 'ya iniciaron sesión o tienen actividad registrada',
    keptOne: 'ya inició sesión o tiene actividad registrada',
  },
};

/** "16 se eliminan por completo · 19 se archivan": what a delete will do, row by row. */
function RemovalPlan({ plan, audience }: { plan: BulkResult; audience: Audience }) {
  const erased = plan.outcomes?.erased ?? 0;
  const archived = plan.outcomes?.archived ?? 0;
  return (
    <ul className="mt-1 space-y-1.5 text-sm" aria-label="Resultado de eliminar">
      {erased > 0 && (
        <li className="flex gap-2">
          <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-coral-600" aria-hidden="true" />
          <span>
            <strong className="text-ink">{erased.toLocaleString('es-MX')}</strong>{' '}
            {erased === 1 ? 'se eliminará por completo: no tiene nada que conservar.' : 'se eliminarán por completo: no tienen nada que conservar.'} No se puede deshacer.
          </span>
        </li>
      )}
      {archived > 0 && (
        <li className="flex gap-2">
          <Archive className="mt-0.5 h-4 w-4 shrink-0 text-purple" aria-hidden="true" />
          <span>
            <strong className="text-ink">{archived.toLocaleString('es-MX')}</strong>{' '}
            {archived === 1
              ? `se archivará porque ${COPY[audience].keptOne}: sale de la lista y su historial se conserva.`
              : `se archivarán porque ${COPY[audience].kept}: salen de la lista y su historial se conserva.`}
          </span>
        </li>
      )}
    </ul>
  );
}

/** The extra lines a confirm dialog shows under its plan for these actions. */
export function removalPlanNote(action: BulkActionDef | null | undefined, audience: Audience = 'students') {
  if (action?.key === 'archive') return () => <p className="text-xs">{COPY[audience].archive}</p>;
  if (action?.key === 'restore') return () => <p className="text-xs">{COPY[audience].restore}</p>;
  if (action?.key === 'delete') return (plan: BulkResult) => <RemovalPlan plan={plan} audience={audience} />;
  return undefined;
}
