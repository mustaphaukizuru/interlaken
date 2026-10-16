import { Link } from 'react-router-dom';
import { AlertTriangle, CreditCard } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ErrorState } from '@/components/ui/ErrorState';
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
import { GATEWAY_LABELS, PAYMENT_STATUS_OPTIONS, gatewayLabel, paymentStatusMeta } from '@/lib/status/payment';

const STATUS_OPTIONS = PAYMENT_STATUS_OPTIONS;
// Banorte is the only gateway; Global Payments survives as a label for legacy rows.
const GATEWAY_OPTIONS = Object.entries(GATEWAY_LABELS).map(([value, label]) => ({ value, label }));
// Failures that are a real "no" from the bank or a set-up error. Cancelled,
// expired and superseded attempts are not counted as failed payments.
const HARD_FAILURES = ['declined', 'config_error'];

/** /admin/pagos — gateway ledger: every online top-up, filters, totals, export (BACKLOG P1-D9).
 *  Refunds and cash approvals stay in the Cafetería console (money moves in one place).
 *  Reference page of the Data Ops UI foundation: selection + "Solo seleccionados",
 *  FilterBar, column controls and the admin export endpoint through the hooks layer.
 *  Bulk actions are export-only: payment state belongs to Banorte's settled result. */
const COLUMNS: Column<Payment>[] = [
  {
    id: 'date', header: 'Fecha', sortKey: 'date', hideable: false, minWidth: 150, className: 'whitespace-nowrap text-muted',
    cell: (p) => new Date(p.created_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }),
  },
  {
    id: 'student', header: 'Alumno', sortKey: 'student', hideable: false, minWidth: 160, className: 'font-medium text-ink',
    cell: (p) => p.student_id
      ? <Link to={`/admin/cafeteria/${p.student_id}`} className="hover:text-purple hover:underline">{p.student_name}</Link>
      : '—',
  },
  {
    id: 'payer', header: 'Pagó', minWidth: 160, className: 'text-xs',
    cell: (p) => (p.payer_name || p.payer_email ? (
      <span className="block">
        <span className="block text-ink">{p.payer_name || p.payer_email}</span>
        {p.payer_name && p.payer_email && <span className="block text-subtle">{p.payer_email}</span>}
      </span>
    ) : '—'),
  },
  { id: 'amount', header: 'Monto', sortKey: 'amount', align: 'right', hideable: false, minWidth: 110, className: 'font-semibold text-ink', cell: (p) => formatMXN(p.amount) },
  { id: 'gateway', header: 'Pasarela', sortKey: 'gateway', minWidth: 130, className: 'text-muted', cell: (p) => p.gateway_label || gatewayLabel(p.gateway) || '—' },
  {
    // Número de control (what MultiCobros searches) plus the bank's referencia and autorización.
    id: 'reference', header: 'Referencia', minWidth: 170, defaultHidden: true, className: 'font-mono text-xs text-subtle',
    cell: (p) => (
      <span className="block leading-5">
        <span className="block">{p.control_number || p.gateway_tx_id || '—'}</span>
        {p.bank_reference && <span className="block">Ref. {p.bank_reference}{p.auth_code ? ` · Aut. ${p.auth_code}` : ''}</span>}
        {p.simulation && <span className="block font-sans">Simulación ({p.mode})</span>}
      </span>
    ),
  },
  {
    id: 'status', header: 'Estado', sortKey: 'status', minWidth: 120,
    cell: (p) => {
      const meta = paymentStatusMeta(p);
      return <Badge variant={meta.variant}>{meta.label}</Badge>;
    },
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
  // Tiles say "…" while loading; an error shows a retry, never fake zeros.
  const tile = (value: number | string | undefined) => (s ? value ?? 0 : '…');
  const failedBy = s?.failed_by_reason ?? {};
  const hardFailed = HARD_FAILURES.reduce((n, k) => n + (failedBy[k] ?? 0), 0);
  const softFailed = Object.entries(failedBy).filter(([k]) => !HARD_FAILURES.includes(k)).reduce((n, [, v]) => n + v, 0);
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

      {summary.isError ? (
        <Card className="mb-6">
          <ErrorState title="No se pudo cargar el resumen de pagos" onRetry={() => summary.refetch()} />
        </Card>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <StatCard title="Cobrado (30 días)" value={s ? formatMXN(s.by_status.success?.total ?? 0) : '…'} icon={CreditCard} color="green" />
          <StatCard title="Pagos completados" value={tile(s?.by_status.success?.count)} icon={CreditCard} color="purple" />
          <StatCard
            title="Rechazados / reembolsados"
            value={tile(s ? hardFailed + (s.by_status.refunded?.count ?? 0) : undefined)}
            icon={AlertTriangle}
            color="coral"
            subtitle={s && softFailed ? `${softFailed} cancelados, expirados o reemplazados (no cuentan)` : undefined}
          />
          <StatCard title="Pendientes > 24 h" value={tile(s?.stuck_pending)} icon={AlertTriangle} color="amber" />
        </div>
      )}

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
              gender="m"
              exportMenu={<ExportMenu label="Exportar seleccionados" filenamePrefix="pagos" selectedCount={selection.count} forceSelected fetch={fetchExport} />}
            />
          )}
          empty={{ icon: CreditCard, title: 'Sin pagos', description: 'No hay pagos con esos filtros.' }}
        />
      </Card>
    </>
  );
}
