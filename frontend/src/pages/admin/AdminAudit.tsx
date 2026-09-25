import { ShieldCheck } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/layout/PageHeader';
import { ExportMenu } from '@/components/admin/ExportMenu';
import { FilterBar } from '@/components/admin/FilterBar';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { parseSort, serializeSort, type SortState } from '@/components/ui/SortableTh';
import { useUrlFilters, useUrlPage } from '@/hooks/useUrlFilters';
import { useAuditExport, useAuditList, type AuditListParams } from '@/hooks/queries/audit';
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

const ACTION_OPTIONS = Object.entries(ACTION_LABEL).map(([value, label]) => ({ value, label }));

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
 * (money movements, wallet, datos de alumnos, roles). Reference page of the
 * Data Ops UI foundation: FilterBar + DataTable v2 (column controls, resizable)
 * + ExportMenu v2 through the hooks layer. Every filter lives in the URL.
 */
const COLUMNS: Column<AuditLogEntry>[] = [
  {
    id: 'date', header: 'Fecha', sortKey: 'date', hideable: false, minWidth: 150, className: 'whitespace-nowrap text-muted',
    cell: (e) => format(new Date(e.created_at), 'd MMM yyyy, HH:mm', { locale: es }),
  },
  {
    id: 'actor', header: 'Actor', sortKey: 'actor', minWidth: 140, className: 'text-muted max-w-[180px] truncate',
    cell: (e) => <span title={e.actor_label}>{e.actor_label || 'system'}</span>,
  },
  {
    id: 'action', header: 'Acción', sortKey: 'action', minWidth: 140,
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
    id: 'object', header: 'Objeto', sortKey: 'object', minWidth: 120, className: 'text-muted whitespace-nowrap text-xs font-mono',
    cell: (e) => `${e.object_type}#${e.object_id}`,
  },
  {
    id: 'detail', header: 'Detalle', minWidth: 200, className: 'text-muted max-w-md truncate',
    cell: (e) => <span title={changesSummary(e)}>{changesSummary(e)}</span>,
  },
];

export default function AdminAudit() {
  const { get, set } = useUrlFilters();
  const actor = get('actor');
  const action = get('accion');
  const from = get('desde');
  const to = get('hasta');
  const [page, setPage] = useUrlPage();
  const sort = parseSort(get('orden'));
  // Sorting is a filter like any other: it belongs in the URL so a sorted view
  // can be shared and survives a reload.
  const onSort = (next: SortState) => set({ orden: serializeSort(next), page: null });

  const filters: Omit<AuditListParams, 'page'> = {
    actor: actor || undefined,
    action: action || undefined,
    from: from || undefined,
    to: to || undefined,
    ordering: serializeSort(sort) || undefined,
  };
  const { data, isLoading, isError, refetch } = useAuditList({ page, ...filters });
  const exportAudit = useAuditExport();

  const rows = data?.results;
  const count = data?.count ?? 0;
  const anyFilter = !!(actor || action || from || to);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Auditoría"
        subtitle="Registro inmutable de acciones sensibles: dinero, saldos, datos de alumnos y roles."
        actions={(
          <ExportMenu
            formats={['csv', 'xlsx']}
            filenamePrefix="auditoria"
            fetch={(fmt) => exportAudit.mutateAsync({ ...filters, fmt })}
          />
        )}
      />

      <Card>
        <DataTable<AuditLogEntry>
          tableId="audit"
          columns={COLUMNS}
          rows={rows}
          rowKey={(e) => e.id}
          rowLabel={(e) => `registro ${e.id}`}
          caption="Registro de auditoría"
          sort={sort}
          onSort={onSort}
          page={page}
          count={count}
          onPage={setPage}
          itemLabel="registros"
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          columnControls
          resizable
          toolbar={(
            <FilterBar
              search={{ paramKey: 'actor', placeholder: 'Buscar por actor (correo)…', label: 'Buscar por actor', chipLabel: 'Actor' }}
              tabs={{ paramKey: 'accion', options: ACTION_OPTIONS, allLabel: 'Todas', label: 'Filtrar por acción' }}
              dateRange={{ idPrefix: 'auditoria' }}
            />
          )}
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
