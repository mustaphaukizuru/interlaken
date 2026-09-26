import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, History, ShieldCheck } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/layout/PageHeader';
import { ExportMenu } from '@/components/admin/ExportMenu';
import { FilterBar } from '@/components/admin/FilterBar';
import { SearchInput } from '@/components/admin/SearchInput';
import { Modal } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { parseSort, serializeSort, type SortState } from '@/components/ui/SortableTh';
import { useUrlFilters, useUrlPage } from '@/hooks/useUrlFilters';
import { useAuditExport, useAuditList, type AuditListParams } from '@/hooks/queries/audit';
import { auditObjectLink, splitChanges } from '@/lib/auditDiff';
import type { AuditLogEntry } from '@/types';

const ACTION_LABEL: Record<string, string> = {
  create: 'Creación',
  update: 'Modificación',
  delete: 'Eliminación',
  permission: 'Permisos',
  export: 'Exportación',
  import: 'Importación',
};

const ACTION_VARIANT: Record<string, 'success' | 'info' | 'error' | 'warning'> = {
  create: 'success',
  update: 'info',
  delete: 'error',
  permission: 'warning',
  export: 'info',
  import: 'info',
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
    id: 'context', header: 'Contexto', sortKey: 'context', minWidth: 140, defaultHidden: true, className: 'text-xs text-subtle',
    cell: (e) => e.context || '—',
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
  const context = get('contexto');
  const objectType = get('objeto');
  const objectId = get('id');
  const [page, setPage] = useUrlPage();
  const [open, setOpen] = useState<AuditLogEntry | null>(null);
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
  // Only sent when set, so the plain view keeps its original request shape.
  if (context) filters.context = context;
  if (objectType) filters.object_type = objectType;
  if (objectId) filters.object_id = objectId;
  const { data, isLoading, isError, refetch } = useAuditList({ page, ...filters });
  const exportAudit = useAuditExport();

  const rows = data?.results;
  const count = data?.count ?? 0;
  const anyFilter = !!(actor || action || from || to || context || objectType || objectId);
  const extraChips = [
    context && { key: 'contexto', label: `Contexto: “${context}”`, onClear: () => set({ contexto: null, page: null }) },
    objectType && { key: 'objeto', label: `Objeto: ${objectType}`, onClear: () => set({ objeto: null, page: null }) },
    objectId && { key: 'id', label: `ID: ${objectId}`, onClear: () => set({ id: null, page: null }) },
  ].filter(Boolean) as { key: string; label: string; onClear: () => void }[];
  const showHistory = (e: AuditLogEntry) => {
    setOpen(null);
    set({ objeto: e.object_type, id: e.object_id, page: null });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Auditoría"
        subtitle="Registro inmutable de acciones sensibles: dinero, saldos, datos de alumnos y roles."
        actions={(
          <ExportMenu
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
          onRowClick={setOpen}
          toolbar={(
            <FilterBar
              search={{ paramKey: 'actor', placeholder: 'Buscar por actor (correo)…', label: 'Buscar por actor', chipLabel: 'Actor' }}
              tabs={{ paramKey: 'accion', options: ACTION_OPTIONS, allLabel: 'Todas', label: 'Filtrar por acción' }}
              dateRange={{ idPrefix: 'auditoria' }}
              extraChips={extraChips}
            >
              <SearchInput paramKey="contexto" placeholder="Contexto (p. ej. cafeteria.adjust)…" label="Filtrar por contexto" className="min-w-[180px] flex-1 sm:max-w-xs" />
              <SearchInput paramKey="objeto" placeholder="Tipo de objeto…" label="Filtrar por tipo de objeto" className="min-w-[160px] sm:max-w-[220px]" />
              <SearchInput paramKey="id" placeholder="ID" label="Filtrar por ID de objeto" className="w-28" />
            </FilterBar>
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
      <AuditEntryDrawer entry={open} onClose={() => setOpen(null)} onHistory={showHistory} />
    </div>
  );
}

/** Row detail (BACKLOG P4-8): who/when/what, the before/after diff of `changes`, and links. */
function AuditEntryDrawer({ entry, onClose, onHistory }: { entry: AuditLogEntry | null; onClose: () => void; onHistory: (e: AuditLogEntry) => void }) {
  const { diff, details } = splitChanges(entry?.changes);
  const link = entry ? auditObjectLink(entry.object_type, entry.object_id) : null;
  return (
    <Modal open={!!entry} onClose={onClose} title={entry ? `Registro #${entry.id}` : ''} maxWidth={640}>
      {entry && (
        <div className="space-y-4 text-sm">
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5">
            <dt className="text-subtle">Fecha</dt>
            <dd className="text-ink">{format(new Date(entry.created_at), "d 'de' MMMM yyyy, HH:mm:ss", { locale: es })}</dd>
            <dt className="text-subtle">Actor</dt>
            <dd className="break-all text-ink">{entry.actor_label || 'system'}</dd>
            <dt className="text-subtle">Acción</dt>
            <dd><Badge variant={ACTION_VARIANT[entry.action] ?? 'neutral'}>{entry.action_display || ACTION_LABEL[entry.action] || entry.action}</Badge></dd>
            <dt className="text-subtle">Contexto</dt>
            <dd className="break-all text-ink">{entry.context || '—'}</dd>
            <dt className="text-subtle">Objeto</dt>
            <dd className="break-all font-mono text-xs text-ink">{entry.object_type}#{entry.object_id}</dd>
          </dl>

          {diff.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">Cambios: valor anterior y nuevo</caption>
                <thead>
                  <tr className="border-b border-line text-subtle">
                    <th scope="col" className="py-1.5 pr-3 font-semibold">Campo</th>
                    <th scope="col" className="py-1.5 pr-3 font-semibold">Antes</th>
                    <th scope="col" className="py-1.5 font-semibold">Después</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.map((d) => (
                    <tr key={d.field} className="border-b border-cream align-top">
                      <th scope="row" className="py-1.5 pr-3 font-mono font-medium text-ink">{d.field}</th>
                      <td className="py-1.5 pr-3 break-all text-coral-700"><span className="sr-only">Antes: </span>{d.before}</td>
                      <td className={`py-1.5 break-all ${d.changed ? 'font-semibold text-green-700' : 'text-muted'}`}><span className="sr-only">Después: </span>{d.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {details.length > 0 && (
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 rounded-lg bg-cream-2 p-3 text-xs" aria-label="Detalles">
              {details.map((d) => (
                <div key={d.field} className="contents">
                  <dt className="font-mono text-subtle">{d.field}</dt>
                  <dd className="break-all text-ink">{d.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {diff.length === 0 && details.length === 0 && <p className="text-muted">Sin cambios registrados.</p>}

          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-outline min-h-[44px] text-sm" onClick={() => onHistory(entry)}>
              <History size={15} aria-hidden="true" /> Historial de este objeto
            </button>
            {link && (
              <Link to={link.to} className="btn-primary min-h-[44px] text-sm">
                {link.label} <ArrowRight size={15} aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
