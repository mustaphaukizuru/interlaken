import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CreditCard, FileDown, Search, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/ui/StatCard';
import { TableSkeleton } from '@/components/ui/TableSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Pagination } from '@/components/ui/Pagination';
import { ActiveFilterChips } from '@/components/admin/ActiveFilterChips';
import { ADMIN_PAGE_SIZE, toPaged } from '@/lib/pagination';
import { formatMXN } from '@/lib/format';
import { useUrlFilters, useUrlPage, useUrlSyncedSearch } from '@/hooks/useUrlFilters';
import { paymentsApi, downloadBlob } from '@/services/api';
import type { Payment } from '@/types';
import { DateRangeFilter } from '@/components/ui/DateRangeFilter';
import { SortableTh, parseSort, serializeSort, type SortState } from '@/components/ui/SortableTh';

const STATUS: Record<string, { label: string; variant: 'success' | 'warning' | 'error' | 'info' | 'neutral' }> = {
  success: { label: 'Completado', variant: 'success' },
  pending: { label: 'Pendiente', variant: 'warning' },
  processing: { label: 'Procesando', variant: 'info' },
  failed: { label: 'Fallido', variant: 'error' },
  refunded: { label: 'Reembolsado', variant: 'neutral' },
};
const GATEWAYS: Record<string, string> = { global_payments: 'Global Payments', banorte: 'Banorte', sandbox: 'Sandbox' };

/** /admin/pagos — gateway ledger: every online top-up, filters, totals, CSV (BACKLOG P1-D9).
 *  Refunds and cash approvals stay in the Cafetería console (money moves in one place). */
export default function AdminPayments() {
  const { input: q, setInput: setQ, search: debouncedQ } = useUrlSyncedSearch('q');
  const [page, setPage] = useUrlPage();
  const { get, set } = useUrlFilters();
  const status = get('estado');
  const gateway = get('pasarela');
  const from = get('desde');
  const to = get('hasta');
  const sort = parseSort(get('orden'));
  const params = {
    page, q: debouncedQ || undefined, status: status || undefined, gateway: gateway || undefined,
    from: from || undefined, to: to || undefined, ordering: serializeSort(sort) || undefined,
  };

  const summary = useQuery({ queryKey: ['admin-payments-summary'], queryFn: async () => (await paymentsApi.adminSummary(30)).data });
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-payments', params],
    queryFn: async () => toPaged<Payment>((await paymentsApi.adminList(params)).data),
    placeholderData: keepPreviousData,
  });
  const exportCsv = useMutation({
    mutationFn: async () => (await paymentsApi.exportMyPayments({ status: params.status, from: params.from, to: params.to })).data as Blob,
    onSuccess: (blob) => downloadBlob(blob, 'pagos.csv'),
    onError: () => toast.error('No se pudo generar el archivo.'),
  });

  const rows = data?.results ?? [];
  const count = data?.count ?? 0;
  const s = summary.data;
  // Sorting lives in the URL like every other filter, so a sorted view is
  // shareable and survives a reload.
  const onSort = (next: SortState) => set({ orden: serializeSort(next), page: null });
  const chips = [
    ...(debouncedQ ? [{ key: 'q', label: `Búsqueda: “${debouncedQ}”`, onClear: () => setQ('') }] : []),
    ...(status ? [{ key: 'estado', label: `Estado: ${STATUS[status]?.label ?? status}`, onClear: () => set({ estado: null, page: null }) }] : []),
    ...(gateway ? [{ key: 'pasarela', label: `Pasarela: ${GATEWAYS[gateway] ?? gateway}`, onClear: () => set({ pasarela: null, page: null }) }] : []),
    ...(from || to ? [{ key: 'fecha', label: `Fechas: ${from || '…'} a ${to || '…'}`, onClear: () => set({ desde: null, hasta: null, page: null }) }] : []),
  ];

  return (
    <>
      <PageHeader
        title="Pagos en línea"
        subtitle="Ledger de la pasarela: recargas de cafetería pagadas con tarjeta. Reembolsos y pagos en caja se gestionan en Cafetería."
        actions={<Button variant="secondary" loading={exportCsv.isPending} onClick={() => exportCsv.mutate()}><FileDown size={16} aria-hidden="true" /> Exportar CSV</Button>}
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

      <Card title={`${count} pagos`}>
        <div className="mb-3 grid gap-3 lg:grid-cols-4">
          <div className="relative lg:col-span-2">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
            <input className="input-field pl-9" placeholder="Alumno, matrícula, correo o referencia…" aria-label="Buscar pagos" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input-field" aria-label="Estado" value={status} onChange={(e) => set({ estado: e.target.value || null, page: null })}>
            <option value="">Todos los estados</option>
            {Object.entries(STATUS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
          <select className="input-field" aria-label="Pasarela" value={gateway} onChange={(e) => set({ pasarela: e.target.value || null, page: null })}>
            <option value="">Todas las pasarelas</option>
            {Object.entries(GATEWAYS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <DateRangeFilter
          idPrefix="pagos"
          className="mb-3"
          value={{ from, to }}
          onChange={(r) => set({ desde: r.from || null, hasta: r.to || null, page: null })}
        />
        <ActiveFilterChips chips={chips} onClearAll={() => { setQ(''); set({ estado: null, pasarela: null, desde: null, hasta: null, page: null }); }} />

        {isError ? <ErrorState onRetry={() => refetch()} /> : isLoading ? <TableSkeleton /> : !rows.length ? (
          <EmptyState icon={CreditCard} title="Sin pagos" description="No hay pagos con esos filtros." />
        ) : (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <SortableTh columnKey="date" sort={sort} onSort={onSort}>Fecha</SortableTh>
                    <th>Alumno</th>
                    <th>Pagó</th>
                    <SortableTh columnKey="amount" sort={sort} onSort={onSort} align="right" className="num">Monto</SortableTh>
                    <SortableTh columnKey="gateway" sort={sort} onSort={onSort}>Pasarela</SortableTh>
                    <th>Referencia</th>
                    <SortableTh columnKey="status" sort={sort} onSort={onSort}>Estado</SortableTh>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td data-label="Fecha" className="whitespace-nowrap text-muted">{new Date(p.created_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                      <td data-label="Alumno" className="font-medium text-ink">
                        {p.student_id ? <Link to={`/admin/cafeteria/${p.student_id}`} className="hover:text-purple hover:underline">{p.student_name}</Link> : '—'}
                      </td>
                      <td data-label="Pagó" className="text-xs text-subtle">{p.description || '—'}</td>
                      <td data-label="Monto" className="num font-semibold text-ink">{formatMXN(p.amount)}</td>
                      <td data-label="Pasarela" className="text-muted">{p.gateway_label ?? GATEWAYS[p.gateway ?? ''] ?? p.gateway}</td>
                      <td data-label="Referencia" className="font-mono text-xs text-subtle">{p.gateway_tx_id || p.gateway_ref || '—'}</td>
                      <td data-label="Estado"><Badge variant={STATUS[p.status]?.variant ?? 'neutral'}>{STATUS[p.status]?.label ?? p.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} count={count} onChange={setPage} itemLabel="pagos" />
          </>
        )}
      </Card>
    </>
  );
}
