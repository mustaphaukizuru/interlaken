import { Link } from 'react-router-dom';
import { AlertTriangle, CreditCard } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/ui/StatCard';
import { ExportMenu } from '@/components/admin/ExportMenu';
import { FilterBar } from '@/components/admin/FilterBar';
import { BulkActionBar } from '@/components/admin/BulkActionBar';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { parseSort, serializeSort, type SortState } from '@/components/ui/SortableTh';
import { formatMXN } from '@/lib/format';
import { useUrlFilters, useUrlPage } from '@/hooks/useUrlFilters';
import { useRowSelection } from '@/hooks/useRowSelection';
import { usePaymentsExport, usePaymentsList, usePaymentsSummary, type PaymentsListParams } from '@/hooks/queries/payments';
import { idsParam, type ExportFormat } from '@/services/dataOps';
import type { Payment } from '@/types';

const STATUS: Record<string, { label: string; variant: 'success' | 'warning' | 'error' | 'info' | 'neutral' }> = {
  success: { label: 'Completado', variant: 'success' },
  pending: { label: 'Pendiente', variant: 'warning' },
  processing: { label: 'Procesando', variant: 'info' },
  failed: { label: 'Fallido', variant: 'error' },
  refunded: { label: 'Reembolsado', variant: 'neutral' },
};
const GATEWAYS: Record<string, string> = { global_payments: 'Global Payments', banorte: 'Banorte', sandbox: 'Sandbox' };

const STATUS_OPTIONS = Object.entries(STATUS).map(([value, m]) => ({ value, label: m.label }));
const GATEWAY_OPTIONS = Object.entries(GATEWAYS).map(([value, label]) => ({ value, label }));

/** /admin/pagos — gateway ledger: every online top-up, filters, totals, export (BACKLOG P1-D9).
 *  Refunds and cash approvals stay in the Cafetería console (money moves in one place).
 *  Reference page of the Data Ops UI foundation: selection + "Solo seleccionados",
 *  FilterBar, column controls and the admin export endpoint through the hooks layer.
 *  Bulk actions are export-only: payment state belongs to the gateway webhook. */
const COLUMNS: Column<Payment>[] = [
  {
    id: 'date', header: 'Fecha', sortKey: 'date', hideable: false, minWidth: 150, className: 'whitespace-nowrap text-muted',
    cell: (p) => new Date(p.created_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }),
  },
  {
    id: 'student', header: 'Alumno', hideable: false, minWidth: 160, className: 'font-medium text-ink',
    cell: (p) => p.student_id
      ? <Link to={`/admin/cafeteria/${p.student_id}`} className="hover:text-purple hover:underline">{p.student_name}</Link>
      : '—',
  },
  { id: 'payer', header: 'Pagó', minWidth: 140, className: 'text-xs text-subtle', cell: (p) => p.description || '—' },
  { id: 'amount', header: 'Monto', sortKey: 'amount', align: 'right', hideable: false, minWidth: 110, className: 'font-semibold text-ink', cell: (p) => formatMXN(p.amount) },
  { id: 'gateway', header: 'Pasarela', sortKey: 'gateway', minWidth: 130, className: 'text-muted', cell: (p) => p.gateway_label ?? GATEWAYS[p.gateway ?? ''] ?? p.gateway },
  { id: 'reference', header: 'Referencia', minWidth: 140, defaultHidden: true, className: 'font-mono text-xs text-subtle', cell: (p) => p.gateway_tx_id || p.gateway_ref || '—' },
  {
    id: 'status', header: 'Estado', sortKey: 'status', minWidth: 120,
    cell: (p) => <Badge variant={STATUS[p.status]?.variant ?? 'neutral'}>{STATUS[p.status]?.label ?? p.status}</Badge>,
  },
];

export default function AdminPayments() {
  const [page, setPage] = useUrlPage();
  const { get, set } = useUrlFilters();
  const q = get('q');
  const status = get('estado');
  const gateway = get('pasarela');
  const student = get('alumno');
  const from = get('desde');
  const to = get('hasta');
  const sort = parseSort(get('orden'));
  const filters: Omit<PaymentsListParams, 'page'> = {
    q: q || undefined, status: status || undefined, gateway: gateway || undefined, student: student || undefined,
    from: from || undefined, to: to || undefined, ordering: serializeSort(sort) || undefined,
  };

  const summary = usePaymentsSummary(30);
  const { data, isLoading, isError, refetch } = usePaymentsList({ page, ...filters });
  const exportPayments = usePaymentsExport();

  const rows = data?.results ?? [];
  const count = data?.count ?? 0;
  const s = summary.data;
  // Selection is forgotten when the filters change ("select all matching"
  // refers to the filters active when it was pressed); paging keeps it.
  const selection = useRowSelection(count, JSON.stringify(filters));
  // Sorting lives in the URL like every other filter, so a sorted view is
  // shareable and survives a reload.
  const onSort = (next: SortState) => set({ orden: serializeSort(next), page: null });

  const fetchExport = (fmt: ExportFormat, { selectedOnly }: { selectedOnly: boolean }) =>
    exportPayments.mutateAsync({
      ...filters,
      fmt,
      ids: selectedOnly && !selection.allMatching ? idsParam(selection.ids) : undefined,
    });

  return (
    <>
      <PageHeader
        title="Pagos en línea"
        subtitle="Ledger de la pasarela: recargas de cafetería pagadas con tarjeta. Reembolsos y pagos en caja se gestionan en Cafetería."
        actions={<ExportMenu filenamePrefix="pagos" selectedCount={selection.count} fetch={fetchExport} />}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard title="Cobrado (30 días)" value={s ? formatMXN(s.by_status.success?.total ?? 0) : '…'} icon={CreditCard} color="green" />
        <StatCard title="Pagos completados" value={s?.by_status.success?.count ?? 0} icon={CreditCard} color="purple" />
        <StatCard title="Fallidos / reembolsados" value={(s?.by_status.failed?.count ?? 0) + (s?.by_status.refunded?.count ?? 0)} icon={AlertTriangle} color="coral" />
        <StatCard title="Pendientes > 24 h" value={s?.stuck_pending ?? 0} icon={AlertTriangle} color="amber" />
      </div>

      {s && s.series.length > 0 && (
        <Card title="Cobros por día (30 días)" className="mb-6">
          <ul className="flex h-28 items-end gap-1" aria-label="Serie diaria de cobros">
            {(() => {
              const max = Math.max(...s.series.map((d) => Number(d.total)), 1);
              return s.series.map((d) => (
                <li key={d.date} className="group relative flex-1" title={`${d.date}: ${formatMXN(d.total)} (${d.count})`}>
                  <div className="w-full rounded-t bg-green/70 transition group-hover:bg-green" style={{ height: `${Math.max(4, (Number(d.total) / max) * 100)}%` }} />
                </li>
              ));
            })()}
          </ul>
          <p className="mt-2 text-xs text-subtle">Desde {s.since}. Pase el cursor sobre una barra para ver el día.</p>
        </Card>
      )}

      <Card title={`${count.toLocaleString('es-MX')} pagos`}>
        <DataTable<Payment>
          tableId="payments"
          columns={COLUMNS}
          rows={rows}
          rowKey={(p) => p.id}
          rowLabel={(p) => `pago ${p.id}${p.student_name ? ` de ${p.student_name}` : ''}`}
          caption="Pagos en línea"
          sort={sort}
          onSort={onSort}
          page={page}
          count={count}
          onPage={setPage}
          itemLabel="pagos"
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          columnControls
          resizable
          pinFirstColumn
          selection={selection}
          toolbar={(
            <FilterBar
              search={{ placeholder: 'Alumno, matrícula, correo o referencia…', label: 'Buscar pagos' }}
              tabs={{ paramKey: 'estado', options: STATUS_OPTIONS, allLabel: 'Todos', label: 'Filtrar por estado' }}
              selects={[{ key: 'pasarela', label: 'Pasarela', options: GATEWAY_OPTIONS, allLabel: 'Todas las pasarelas' }]}
              dateRange={{ idPrefix: 'pagos' }}
              extraChips={student ? [{ key: 'alumno', label: `Alumno: ${student}`, onClear: () => set({ alumno: null, page: null }) }] : []}
            />
          )}
          bulkBar={(
            <BulkActionBar
              count={selection.count}
              allMatching={selection.allMatching}
              allMatchingCount={count}
              onSelectAllMatching={selection.onSelectAllMatching}
              onClear={selection.onClear}
              itemLabel="pagos"
              exportMenu={<ExportMenu label="Exportar seleccionados" filenamePrefix="pagos" selectedCount={selection.count} forceSelected fetch={fetchExport} />}
            />
          )}
          empty={{ icon: CreditCard, title: 'Sin pagos', description: 'No hay pagos con esos filtros.' }}
        />
      </Card>
    </>
  );
}
