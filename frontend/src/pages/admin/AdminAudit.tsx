import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ShieldCheck, Search } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card } from '@/components/ui/Card';
import { ExportMenu } from '@/components/admin/ExportMenu';
import { Badge } from '@/components/ui/Badge';
import { ActiveFilterChips, type FilterChip } from '@/components/admin/ActiveFilterChips';
import { coreApi } from '@/services/api';
import { toPaged } from '@/lib/pagination';
import { useUrlFilters, useUrlPage, useUrlSyncedSearch } from '@/hooks/useUrlFilters';
import type { AuditLogEntry } from '@/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { DateRangeFilter } from '@/components/ui/DateRangeFilter';
import { parseSort, serializeSort, type SortState } from '@/components/ui/SortableTh';
import { DataTable, type Column } from '@/components/ui/DataTable';

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
const COLUMNS: Column<AuditLogEntry>[] = [
  {
    header: 'Fecha', sortKey: 'date', className: 'whitespace-nowrap text-muted',
    cell: (e) => format(new Date(e.created_at), 'd MMM yyyy, HH:mm', { locale: es }),
  },
  {
    header: 'Actor', sortKey: 'actor', className: 'text-muted max-w-[180px] truncate',
    cell: (e) => <span title={e.actor_label}>{e.actor_label || 'system'}</span>,
  },
  {
    header: 'Acción', sortKey: 'action',
    cell: (e) => (
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant={ACTION_VARIANT[e.action] ?? 'neutral'}>
          {e.action_display || ACTION_LABEL[e.action] || e.action}
        </Badge>
        {e.context && <span className="text-xs text-subtle">{e.context}</span>}
      </div>
    ),
  },
  {
    header: 'Objeto', sortKey: 'object', className: 'text-muted whitespace-nowrap text-xs font-mono',
    cell: (e) => `${e.object_type}#${e.object_id}`,
  },
  {
    header: 'Detalle', className: 'text-muted max-w-md truncate',
    cell: (e) => <span title={changesSummary(e)}>{changesSummary(e)}</span>,
  },
];

export default function AdminAudit() {
  const { get, set } = useUrlFilters();
  const { input: actor, setInput: setActor, search: debouncedActor } = useUrlSyncedSearch('actor');
  const action = get('accion');
  const from = get('desde');
  const to = get('hasta');
  const [page, setPage] = useUrlPage();
  const sort = parseSort(get('orden'));
  // Sorting is a filter like any other: it belongs in the URL so a sorted view
  // can be shared and survives a reload.
  const onSort = (next: SortState) => set({ orden: serializeSort(next), page: null });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-audit', debouncedActor, action, from, to, page, sort.key, sort.dir],
    queryFn: async () =>
      toPaged<AuditLogEntry>(
        (await coreApi.getAuditLog({
          page,
          actor: debouncedActor || undefined,
          action: action || undefined,
          from: from || undefined,
          to: to || undefined,
          ordering: serializeSort(sort) || undefined,
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
      <PageHeader
        title="Auditoría"
        subtitle="Registro inmutable de acciones sensibles: dinero, saldos, datos de alumnos y roles."
        actions={(
          <>
          <ExportMenu options={[{ key: 'csv', label: 'Exportar CSV', filename: 'auditoria_{date}.csv',
            fetch: async () => (await coreApi.exportAuditLog({ actor: debouncedActor || undefined, action: action || undefined, from: from || undefined, to: to || undefined })).data as Blob }]} />
          </>
        )}
      />

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
        </div>
        <DateRangeFilter
          idPrefix="auditoria"
          className="mb-4"
          value={{ from, to }}
          onChange={(r) => set({ desde: r.from || null, hasta: r.to || null, page: null })}
        />

        <ActiveFilterChips
          chips={chips}
          onClearAll={() => {
            setActor('');
            set({ accion: null, desde: null, hasta: null, page: null });
          }}
        />

        <DataTable<AuditLogEntry>
          columns={COLUMNS}
          rows={rows}
          rowKey={(e) => e.id}
          sort={sort}
          onSort={onSort}
          page={page}
          count={count}
          onPage={setPage}
          itemLabel="registros"
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          empty={{
            icon: ShieldCheck,
            title: anyFilter ? 'Sin resultados' : 'Sin registros de auditoría',
            description: anyFilter
              ? 'Ningún registro coincide con los filtros.'
              : 'Las acciones sensibles aparecerán aquí conforme ocurran.',
          }}
        />
      </Card>
    </div>
  );
}
