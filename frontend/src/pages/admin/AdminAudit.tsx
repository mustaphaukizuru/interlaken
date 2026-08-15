import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ShieldCheck, Search } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { TableSkeleton } from '@/components/ui/TableSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Pagination } from '@/components/ui/Pagination';
import { ActiveFilterChips, type FilterChip } from '@/components/admin/ActiveFilterChips';
import { coreApi } from '@/services/api';
import { toPaged, ADMIN_PAGE_SIZE } from '@/lib/pagination';
import { useUrlFilters, useUrlPage, useUrlSyncedSearch } from '@/hooks/useUrlFilters';
import type { AuditLogEntry } from '@/types';

const ACTION_LABEL: Record<string, string> = {
  create: 'Creación',
  update: 'Modificación',
  delete: 'Eliminación',
  permission: 'Permisos',
};

const ACTION_VARIANT: Record<string, 'success' | 'info' | 'error' | 'warning'> = {
  create: 'success',
  update: 'info',
  delete: 'error',
  permission: 'warning',
};

/** Human summary of one audit row's `changes` payload (reason first). */
function changesSummary(entry: AuditLogEntry): string {
  const { changes } = entry;
  if (!changes || typeof changes !== 'object') return '—';
  const parts: string[] = [];
  if (typeof changes.reason === 'string' && changes.reason) {
    parts.push(`Motivo: ${changes.reason}`);
  }
  for (const [key, value] of Object.entries(changes)) {
    if (key === 'reason') continue;
    if (Array.isArray(value) && value.length === 2) {
      parts.push(`${key}: ${value[0] ?? '—'} → ${value[1] ?? '—'}`);
    } else {
      parts.push(`${key}: ${String(value)}`);
    }
  }
  return parts.length ? parts.join(' · ') : '—';
}

/**
 * /admin/auditoria — read-only viewer over the append-only AuditLog
 * (money movements, wallet, datos de alumnos, roles). Filters are URL-synced.
 */
export default function AdminAudit() {
  const { get, set } = useUrlFilters();
  const { input: actor, setInput: setActor, search: debouncedActor } = useUrlSyncedSearch('actor');
  const action = get('accion');
  const from = get('desde');
  const to = get('hasta');
  const [page, setPage] = useUrlPage();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-audit', debouncedActor, action, from, to, page],
    queryFn: async () =>
      toPaged<AuditLogEntry>(
        (await coreApi.getAuditLog({
          page,
          actor: debouncedActor || undefined,
          action: action || undefined,
          from: from || undefined,
          to: to || undefined,
        })).data,
      ),
    placeholderData: keepPreviousData,
  });

  const rows = data?.results;
  const count = data?.count ?? 0;
  const anyFilter = !!(debouncedActor || action || from || to);

  const chips: FilterChip[] = [
    ...(debouncedActor
      ? [{ key: 'actor', label: `Actor: ${debouncedActor}`, onClear: () => setActor('') }]
      : []),
    ...(action
      ? [{ key: 'accion', label: `Acción: ${ACTION_LABEL[action] ?? action}`, onClear: () => set({ accion: null, page: null }) }]
      : []),
    ...(from
      ? [{ key: 'desde', label: `Desde: ${from}`, onClear: () => set({ desde: null, page: null }) }]
      : []),
    ...(to
      ? [{ key: 'hasta', label: `Hasta: ${to}`, onClear: () => set({ hasta: null, page: null }) }]
      : []),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-head text-fluid-xl font-bold leading-tight tracking-[-0.3px] text-ink">Auditoría</h1>
        <p className="text-muted text-sm mt-0.5">
          Registro inmutable de acciones sensibles: dinero, saldos, datos de alumnos y roles.
        </p>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
            <input
              className="input-field pl-9"
              placeholder="Buscar por actor (correo)…"
              aria-label="Buscar por actor"
              value={actor}
              onChange={(e) => setActor(e.target.value)}
            />
          </div>
          <select
            className="input-field w-auto"
            aria-label="Acción"
            value={action}
            onChange={(e) => set({ accion: e.target.value || null, page: null })}
          >
            <option value="">Todas las acciones</option>
            <option value="create">Creación</option>
            <option value="update">Modificación</option>
            <option value="delete">Eliminación</option>
            <option value="permission">Permisos</option>
          </select>
          <input
            type="date"
            className="input-field w-auto"
            aria-label="Desde"
            value={from}
            onChange={(e) => set({ desde: e.target.value || null, page: null })}
          />
          <input
            type="date"
            className="input-field w-auto"
            aria-label="Hasta"
            value={to}
            onChange={(e) => set({ hasta: e.target.value || null, page: null })}
          />
        </div>

        <ActiveFilterChips
          chips={chips}
          onClearAll={() => {
            setActor('');
            set({ accion: null, desde: null, hasta: null, page: null });
          }}
        />

        {isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : isLoading ? (
          <TableSkeleton />
        ) : !rows?.length ? (
          <EmptyState
            icon={ShieldCheck}
            title={anyFilter ? 'Sin resultados' : 'Sin registros de auditoría'}
            description={anyFilter
              ? 'Ningún registro coincide con los filtros.'
              : 'Las acciones sensibles quedarán registradas aquí.'}
          />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Actor</th>
                  <th>Acción</th>
                  <th>Objeto</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr key={entry.id}>
                    <td data-label="Fecha" className="whitespace-nowrap text-muted">
                      {format(new Date(entry.created_at), 'd MMM yyyy, HH:mm', { locale: es })}
                    </td>
                    <td data-label="Actor" className="text-muted max-w-[180px] truncate" title={entry.actor_label}>
                      {entry.actor_label || 'system'}
                    </td>
                    <td data-label="Acción">
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge variant={ACTION_VARIANT[entry.action] ?? 'neutral'}>
                          {entry.action_display || ACTION_LABEL[entry.action] || entry.action}
                        </Badge>
                        {entry.context && (
                          <span className="text-xs text-subtle">{entry.context}</span>
                        )}
                      </div>
                    </td>
                    <td data-label="Objeto" className="text-muted whitespace-nowrap text-xs font-mono">
                      {entry.object_type}#{entry.object_id}
                    </td>
                    <td data-label="Detalle" className="text-muted max-w-md truncate" title={changesSummary(entry)}>
                      {changesSummary(entry)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} count={count} onChange={setPage} itemLabel="registros" />
      </Card>
    </div>
  );
}
