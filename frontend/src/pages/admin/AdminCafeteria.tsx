import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Coffee, RefreshCw, Search, Download, ChevronRight, ScrollText,
  Scale, AlertTriangle, CheckCircle2, Store, Users, Receipt,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { TableSkeleton } from '@/components/ui/TableSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Pagination } from '@/components/ui/Pagination';
import { ActiveFilterChips } from '@/components/admin/ActiveFilterChips';
import { BulkTopUpDialog } from '@/components/admin/BulkTopUpDialog';
import { cafeteriaApi, downloadBlob, type LoyverseCustomer, type LoyverseCustomerKind } from '@/services/api';
import { toPaged, ADMIN_PAGE_SIZE } from '@/lib/pagination';
import { useUrlFilters, useUrlPage, useUrlSyncedSearch } from '@/hooks/useUrlFilters';
import type { CafeteriaBalance, TopUpLogEntry, ReconcileRow } from '@/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { SyncHealthPanel } from '@/components/admin/SyncHealthPanel';
import { LIVE } from '@/lib/live';
import { LiveBadge } from '@/components/ui/LiveBadge';
import { DataTable } from '@/components/ui/DataTable';

type Tab = 'roster' | 'deposits' | 'pos' | 'reconcile' | 'low' | 'customers';

const TABS: { key: Tab; label: string; icon: typeof Coffee }[] = [
  { key: 'roster',    label: 'Saldos',         icon: Coffee },
  { key: 'deposits',  label: 'Depósitos',      icon: ScrollText },
  { key: 'pos',       label: 'POS Loyverse',   icon: Store },
  { key: 'reconcile', label: 'Reconciliación', icon: Scale },
  { key: 'low',       label: 'Saldo bajo',     icon: AlertTriangle },
  { key: 'customers', label: 'Clientes Loyverse', icon: Users },
];

const fmtDate = (d: string | null) =>
  d ? format(new Date(d), 'd MMM yyyy, HH:mm', { locale: es }) : '—';

export default function AdminCafeteria() {
  // Active tab + per-tab filters live in the URL (shareable, survive refresh).
  // Switching tabs drops the other tab's filter/page params.
  const { get, set } = useUrlFilters();
  const tabParam = get('tab');
  const tab: Tab = TABS.some((t) => t.key === tabParam) ? (tabParam as Tab) : 'roster';
  const setTab = (key: Tab) =>
    set({ tab: key === 'roster' ? null : key, q: null, estado: null, tipo: null, page: null });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cafetería"
        subtitle="Saldos, depósitos, carga/quita en POS, ajustes, devoluciones y reconciliación."
        actions={<SchoolExportButtons />}
      />

      {/* One scrolling row on phones (the five tabs used to wrap into two rows,
          pushing content down and hiding which tab was active); -mx cancels the
          page gutter so the strip bleeds to the edge like a native tab bar. */}
      <div
        role="tablist"
        aria-label="Secciones de cafetería"
        className="scrollbar-none -mx-4 flex snap-x gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
      >
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`inline-flex min-h-[44px] shrink-0 snap-start items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'roster' && <RosterTab />}
      {tab === 'deposits' && <DepositsTab />}
      {tab === 'pos' && <PosLoadTab />}
      {tab === 'reconcile' && <ReconcileTab />}
      {tab === 'low' && <LowBalanceTab />}
      {tab === 'customers' && <CustomersTab />}
    </div>
  );
}

function SchoolExportButtons() {
  const { get, set } = useUrlFilters();
  const [busy, setBusy] = useState<'csv' | 'pdf' | null>(null);

  const doExport = async (fmt: 'csv' | 'pdf') => {
    setBusy(fmt);
    try {
      const { data } = await cafeteriaApi.exportSchool(fmt);
      downloadBlob(data, `saldos_cafeteria_escuela.${fmt}`);
    } catch {
      toast.error('No se pudo generar el archivo.');
    } finally {
      setBusy(null);
    }
  };

  // Command-palette deep link: /admin/cafeteria?exportar=csv triggers the same
  // school-balances export the button runs, then consumes the param.
  const consumed = useRef(false);
  const exportParam = get('exportar');
  useEffect(() => {
    if (!exportParam || consumed.current) return;
    consumed.current = true;
    void doExport(exportParam === 'pdf' ? 'pdf' : 'csv');
    set({ exportar: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportParam]);

  return (
    <div className="flex items-center gap-2">
      <BulkTopUpDialog />
      <Button size="sm" variant="secondary" loading={busy === 'csv'} onClick={() => doExport('csv')}>
        <Download className="w-3.5 h-3.5" /> CSV
      </Button>
      <Button size="sm" variant="secondary" loading={busy === 'pdf'} onClick={() => doExport('pdf')}>
        <Download className="w-3.5 h-3.5" /> PDF
      </Button>
    </div>
  );
}

// ── Roster ───────────────────────────────────────────────────────────────────
function RosterTab() {
  const queryClient = useQueryClient();
  // URL-synced (debounced 300 ms) so a filtered roster is shareable. The
  // search runs server-side over the whole roster (name, matrícula, Código
  // Loyverse in either spelling), not over the current page.
  const { input: search, setInput: setSearch, search: debouncedSearch } = useUrlSyncedSearch('q');
  const [page, setPage] = useUrlPage();

  const { data, isLoading, isError, refetch, dataUpdatedAt, isFetching } = useQuery({
    queryKey: ['admin-cafeteria-balances', page, debouncedSearch],
    ...LIVE,
    queryFn: async () => toPaged<CafeteriaBalance>(
      (await cafeteriaApi.getAllBalances({ page, q: debouncedSearch || undefined })).data),
    placeholderData: keepPreviousData,
  });

  const balances = data?.results;
  const count = data?.count ?? 0;

  const [lastSync, setLastSync] = useState<{
    receipts: number; purchases_created: number; balances_ok: number; balances_failed: number;
    unmatched: number; skipped: number;
  } | null>(null);

  const syncAll = useMutation({
    mutationFn: () => cafeteriaApi.syncAll(),
    onSuccess: ({ data }) => {
      const created = data?.purchases_created ?? 0;
      const receipts = data?.receipts ?? 0;
      const ok = data?.balances_ok ?? 0;
      const failed = data?.balances_failed ?? 0;
      const unmatched = data?.unmatched ?? 0;
      const skipped = data?.skipped ?? 0;
      setLastSync({ receipts, purchases_created: created, balances_ok: ok, balances_failed: failed, unmatched, skipped });
      // Say why a run moved nothing. "0 compras nuevas" on its own looks
      // identical whether the POS charged the wallet some other way, nobody is
      // linked, or there genuinely were no sales.
      const posTopups = data?.pos_topups_credited ?? 0;
      const deferred = data?.pos_topups_deferred ?? 0;
      toast.success(
        `Sincronización: ${receipts} recibo(s), ${created} compra(s) nueva(s)`
        + (posTopups ? `, ${posTopups} recarga(s) en caja por $${parseFloat(data?.pos_topups_total ?? '0').toFixed(2)}` : '')
        + (deferred ? `, ${deferred} recarga(s) en espera (monedero con movimientos recientes)` : '')
        + (skipped ? `, ${skipped} sin movimiento de monedero` : '')
        + (unmatched ? `, ${unmatched} sin alumno vinculado` : '')
        + (failed ? `, ${failed} saldo(s) fallido(s)` : '')
        + '.',
      );
      queryClient.invalidateQueries({ queryKey: ['admin-cafeteria-balances'] });
    },
    onError: () => toast.error('Error al sincronizar.'),
  });

  const syncOne = useMutation({
    mutationFn: (studentId: number) => cafeteriaApi.syncBalance(studentId),
    onSuccess: ({ data }) => {
      // Don't claim "saldo sincronizado" when the seed-once rule made this a
      // no-op — say what the wallet is actually worth and whether it agrees
      // with Loyverse, which is the question being asked.
      const local = `$${parseFloat(data.balance).toFixed(2)}`;
      if (data.in_sync === true) toast.success(`Saldo ${local}, coincide con Loyverse.`);
      else if (data.in_sync === false) {
        toast(
          `Saldo local ${local}, Loyverse $${parseFloat(data.loyverse_balance ?? '0').toFixed(2)} `
          + `(diferencia $${parseFloat(data.drift ?? '0').toFixed(2)}). Use Reconciliación para corregir.`,
          { icon: '⚠️', duration: 8000 },
        );
      } else toast.success(`Saldo ${local}. No se pudo consultar Loyverse.`);
      queryClient.invalidateQueries({ queryKey: ['admin-cafeteria-balances'] });
    },
    onError: () => toast.error('Error al sincronizar.'),
  });

  const filtered = balances;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
          <input
            className="input-field pl-9"
            placeholder="Buscar alumno, matrícula o código Loyverse…"
            aria-label="Buscar alumno, matrícula o código Loyverse"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <LiveBadge updatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={() => refetch()} className="min-h-[44px]" />
        <Button variant="secondary" size="sm" loading={syncAll.isPending} onClick={() => syncAll.mutate()}>
          <RefreshCw className="w-3.5 h-3.5" /> Sincronizar todos
        </Button>
      </div>
      <SyncHealthPanel />
      {lastSync && (
        <div className="-mt-1 mb-3 text-xs text-subtle">
          <p>
            Última sincronización — recibos: {lastSync.receipts}, compras nuevas:{' '}
            {lastSync.purchases_created}, saldos sembrados: {lastSync.balances_ok}
            {lastSync.balances_failed > 0 ? `, fallidos: ${lastSync.balances_failed}` : ''}.
          </p>
          {(lastSync.skipped > 0 || lastSync.unmatched > 0) && (
            <p className="mt-0.5 text-muted">
              {lastSync.skipped > 0 && (
                <>
                  {lastSync.skipped} recibo(s) sin movimiento de monedero (venta en efectivo o
                  tarjeta: el saldo no cambia).{' '}
                </>
              )}
              {lastSync.unmatched > 0 && (
                <>
                  {lastSync.unmatched} recibo(s) de un cliente que no es un alumno vinculado —
                  revise “Vincular Loyverse” en Alumnos.
                </>
              )}
            </p>
          )}
        </div>
      )}

      <ActiveFilterChips
        chips={debouncedSearch
          ? [{ key: 'q', label: `Búsqueda: “${debouncedSearch}”`, onClear: () => setSearch('') }]
          : []}
        onClearAll={() => setSearch('')}
      />

      {isLoading ? (
        <TableSkeleton />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : !filtered?.length ? (
        <EmptyState icon={Coffee} title={debouncedSearch ? 'Sin resultados' : 'Sin saldos registrados'} />
      ) : (
        <>
          {/* Mobile: stacked cards (mobile-priority workflow) */}
          <ul className="space-y-3 md:hidden">
            {filtered.map((b) => {
              const isLow = parseFloat(b.balance) <= parseFloat(b.low_balance_threshold ?? '50');
              return (
                <li key={b.id} className="rounded-xl2 border border-line p-4">
                  <div className="flex items-start justify-between gap-3">
                    <Link to={`/admin/cafeteria/${b.student.id}`} className="min-w-0 font-medium text-ink hover:text-brand-700">
                      {b.student.user.full_name}
                      <span className="block text-xs font-normal text-subtle">
                        {b.student.student_id} · Código Loyverse <span className="font-mono">{b.student.loyverse_code || b.student.student_id}</span>
                      </span>
                    </Link>
                    <Badge variant={isLow ? 'warning' : 'success'}>{isLow ? 'Saldo bajo' : 'Normal'}</Badge>
                  </div>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-xs text-muted">Saldo</p>
                      <p className="text-lg font-bold text-ink">${parseFloat(b.balance).toFixed(2)}</p>
                      <p className="text-xs text-subtle">Sinc. {fmtDate(b.last_synced)}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Sincronizar saldo de ${b.student.user.full_name}`}
                        title="Sincronizar saldo"
                        onClick={() => syncOne.mutate(b.student.id)}
                        loading={syncOne.isPending && syncOne.variables === b.student.id}
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </Button>
                      <Link
                        to={`/admin/cafeteria/${b.student.id}`}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-cream"
                        title="Ver detalle"
                        aria-label={`Ver detalle de ${b.student.user.full_name}`}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Desktop: dense table */}
          <DataTable
            wrapClassName="hidden md:block"
            rows={filtered}
            rowKey={(b) => b.id}
            columns={[
              {
                header: 'Alumno', className: 'font-medium text-ink',
                cell: (b) => <Link to={`/admin/cafeteria/${b.student.id}`} className="hover:text-brand-700">{b.student.user.full_name}</Link>,
              },
              { header: 'Matrícula', className: 'text-muted', cell: (b) => b.student.student_id },
              { header: 'Código Loyverse', className: 'font-mono text-xs text-muted', cell: (b) => b.student.loyverse_code || b.student.student_id },
              { header: 'Saldo', align: 'right', className: 'font-semibold text-ink', cell: (b) => `$${parseFloat(b.balance).toFixed(2)}` },
              {
                header: 'Estado',
                cell: (b) => {
                  const isLow = parseFloat(b.balance) <= parseFloat(b.low_balance_threshold ?? '50');
                  return <Badge variant={isLow ? 'warning' : 'success'}>{isLow ? 'Saldo bajo' : 'Normal'}</Badge>;
                },
              },
              { header: 'Últ. sinc.', className: 'text-muted whitespace-nowrap', cell: (b) => fmtDate(b.last_synced) },
              {
                header: 'Acciones', align: 'right',
                cell: (b) => (
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Sincronizar saldo de ${b.student.user.full_name}`}
                      title="Sincronizar saldo"
                      onClick={() => syncOne.mutate(b.student.id)}
                      loading={syncOne.isPending && syncOne.variables === b.student.id}
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </Button>
                    <Link
                      to={`/admin/cafeteria/${b.student.id}`}
                      className="inline-flex items-center rounded-lg p-1.5 text-muted hover:bg-cream"
                      title="Ver detalle"
                      aria-label={`Ver detalle de ${b.student.user.full_name}`}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </div>
                ),
              },
            ]}
          />
        </>
      )}

      <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} count={count} onChange={setPage} itemLabel="alumnos" />
    </Card>
  );
}

// ── Deposits log ─────────────────────────────────────────────────────────────
function DepositsTab() {
  // URL-synced filter + page (shareable, survive refresh).
  const { get, set } = useUrlFilters();
  const status = get('estado');
  const setStatus = (value: string) => set({ estado: value || null, page: null });
  const [page, setPage] = useUrlPage();

  const { data: paged, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-cafeteria-topups', status, page],
    queryFn: async () =>
      toPaged<TopUpLogEntry>((await cafeteriaApi.getTopUpLog({ status: status || undefined, page })).data),
    placeholderData: keepPreviousData,
  });

  const data = paged?.results;
  const count = paged?.count ?? 0;

  const statusVariant = (s: string) =>
    s === 'completed' ? 'success' : s === 'failed' ? 'error' : 'warning';

  return (
    <Card>
      <div className="flex items-center gap-2 mb-4">
        <label htmlFor="deposit-status" className="text-sm text-muted">Estado:</label>
        <select
          id="deposit-status"
          className="input-field w-auto"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Todos</option>
          <option value="pending">Pendiente</option>
          <option value="completed">Completado</option>
          <option value="failed">Fallido</option>
        </select>
      </div>

      <ActiveFilterChips
        chips={status
          ? [{
              key: 'estado',
              label: `Estado: ${status === 'pending' ? 'Pendiente' : status === 'completed' ? 'Completado' : 'Fallido'}`,
              onClear: () => setStatus(''),
            }]
          : []}
        onClearAll={() => setStatus('')}
      />

      {isLoading ? (
        <TableSkeleton />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : !data?.length ? (
        <EmptyState icon={ScrollText} title="Sin depósitos registrados" />
      ) : (
        <DataTable
          rows={data}
          rowKey={(d) => d.id}
          columns={[
            { header: 'Fecha', className: 'whitespace-nowrap text-muted', cell: (d) => fmtDate(d.created_at) },
            { header: 'Alumno', className: 'font-medium text-ink', cell: (d) => (
                <span className="block">
                  <Link to={`/admin/cafeteria/${d.student_id}`} className="hover:text-brand-700">{d.student_name}</Link>
                  <span className="block text-xs text-subtle">{d.student_code}</span>
                </span>
              ) },
            { header: 'Monto', align: 'right', className: 'font-semibold text-ink', cell: (d) => `$${parseFloat(d.amount).toFixed(2)}` },
            { header: 'Método', className: 'text-muted', cell: (d) => d.method_display },
            { header: 'Pasarela', className: 'text-muted', cell: (d) => d.gateway || '—' },
            { header: 'Estado', cell: (d) => <Badge variant={statusVariant(d.status)}>{d.status_display}</Badge> },
            {
              header: 'POS',
              cell: (d) => d.needs_pos_unload ? <Badge variant="error">Quitar del POS</Badge>
                : d.needs_pos_load ? <Badge variant="warning">Pendiente POS</Badge>
                : d.pos_loaded_at ? <Badge variant="success">En POS</Badge>
                : <span className="text-subtle">—</span>,
            },
            { header: 'Referencia', className: 'text-subtle text-xs font-mono', cell: (d) => d.gateway_tx_id || '—' },
          ]}
        />
      )}

      <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} count={count} onChange={setPage} itemLabel="depósitos" />
    </Card>
  );
}

// ── Loyverse POS load + unload queues ────────────────────────────────────────
function PosLoadTab() {
  return (
    <div className="space-y-6">
      <PosLoadQueue />
      <PosUnloadQueue />
    </div>
  );
}

function PosLoadQueue() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  const { data: paged, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-cafeteria-pos-queue', page],
    queryFn: async () =>
      toPaged<TopUpLogEntry>(
        (await cafeteriaApi.getTopUpLog({ needs_pos: 1, page })).data,
      ),
    placeholderData: keepPreviousData,
  });

  const mark = useMutation({
    mutationFn: (id: number) => cafeteriaApi.markTopUpPosLoaded(id),
    onSuccess: () => {
      toast.success('Marcado como cargado en Loyverse POS.');
      queryClient.invalidateQueries({ queryKey: ['admin-cafeteria-pos-queue'] });
      queryClient.invalidateQueries({ queryKey: ['admin-cafeteria-topups'] });
    },
    onError: () => toast.error('No se pudo marcar la recarga.'),
  });

  const data = paged?.results;
  const count = paged?.count ?? 0;

  return (
    <Card>
      <div className="mb-4 max-w-2xl">
        <h2 className="font-head text-base font-semibold text-ink">Cargar en POS</h2>
        <p className="mt-1 text-sm text-muted">
          Recargas en línea ya acreditadas en el saldo local. Cargue el monto en el
          POS de Loyverse y márquelo aquí para que el alumno pueda gastar.
        </p>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : !data?.length ? (
        <EmptyState
          icon={CheckCircle2}
          title="Sin pendientes de carga en POS"
          description="Todas las recargas en línea ya fueron marcadas como cargadas."
        />
      ) : (
        <DataTable
          rows={data}
          rowKey={(d) => d.id}
          columns={[
            { header: 'Acreditada', className: 'whitespace-nowrap text-muted', cell: (d) => fmtDate(d.processed_at || d.created_at) },
            { header: 'Alumno', className: 'font-medium text-ink', cell: (d) => (
                <span className="block">
                  <Link to={`/admin/cafeteria/${d.student_id}`} className="hover:text-brand-700">{d.student_name}</Link>
                  <span className="block text-xs text-subtle">{d.student_code}</span>
                </span>
              ) },
            { header: 'Monto', align: 'right', className: 'font-semibold text-ink', cell: (d) => `$${parseFloat(d.amount).toFixed(2)}` },
            { header: 'Pasarela', className: 'text-muted', cell: (d) => d.gateway || '—' },
            { header: 'Referencia', className: 'text-subtle text-xs font-mono', cell: (d) => d.gateway_tx_id || '—' },
            {
              header: 'Acción', align: 'right',
              cell: (d) => (
                <Button size="sm" loading={mark.isPending && mark.variables === d.id} onClick={() => mark.mutate(d.id)}>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Cargado en Loyverse
                </Button>
              ),
            },
          ]}
        />
      )}

      <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} count={count} onChange={setPage} itemLabel="recargas" />
    </Card>
  );
}

function PosUnloadQueue() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  const { data: paged, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-cafeteria-pos-unload', page],
    queryFn: async () =>
      toPaged<TopUpLogEntry>(
        (await cafeteriaApi.getTopUpLog({ needs_unload: 1, page })).data,
      ),
    placeholderData: keepPreviousData,
  });

  const mark = useMutation({
    mutationFn: (id: number) => cafeteriaApi.markTopUpPosUnloaded(id),
    onSuccess: () => {
      toast.success('Marcado como quitado del POS de Loyverse.');
      queryClient.invalidateQueries({ queryKey: ['admin-cafeteria-pos-unload'] });
      queryClient.invalidateQueries({ queryKey: ['admin-cafeteria-topups'] });
    },
    onError: () => toast.error('No se pudo marcar la recarga.'),
  });

  const data = paged?.results;
  const count = paged?.count ?? 0;

  return (
    <Card>
      <div className="mb-4 max-w-2xl">
        <h2 className="font-head text-base font-semibold text-ink">Quitar del POS</h2>
        <p className="mt-1 text-sm text-muted">
          Recargas ya cargadas en Loyverse que fueron reembolsadas. Quite el monto
          del POS y márquelo aquí para evitar que el alumno siga gastando crédito
          devuelto.
        </p>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : !data?.length ? (
        <EmptyState
          icon={CheckCircle2}
          title="Sin pendientes de quitar del POS"
          description="No hay recargas reembolsadas esperando descarga en Loyverse."
        />
      ) : (
        <DataTable
          rows={data}
          rowKey={(d) => d.id}
          columns={[
            { header: 'Reembolso', className: 'whitespace-nowrap text-muted', cell: (d) => fmtDate(d.pos_unload_needed_at) },
            { header: 'Alumno', className: 'font-medium text-ink', cell: (d) => (
                <span className="block">
                  <Link to={`/admin/cafeteria/${d.student_id}`} className="hover:text-brand-700">{d.student_name}</Link>
                  <span className="block text-xs text-subtle">{d.student_code}</span>
                </span>
              ) },
            { header: 'Monto', align: 'right', className: 'font-semibold text-ink', cell: (d) => `$${parseFloat(d.amount).toFixed(2)}` },
            { header: 'Pasarela', className: 'text-muted', cell: (d) => d.gateway || '—' },
            { header: 'Referencia', className: 'text-subtle text-xs font-mono', cell: (d) => d.gateway_tx_id || '—' },
            {
              header: 'Acción', align: 'right',
              cell: (d) => (
                <Button size="sm" variant="secondary" loading={mark.isPending && mark.variables === d.id} onClick={() => mark.mutate(d.id)}>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Quitado de Loyverse
                </Button>
              ),
            },
          ]}
        />
      )}

      <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} count={count} onChange={setPage} itemLabel="recargas" />
    </Card>
  );
}

// ── Reconciliation ───────────────────────────────────────────────────────────
function ReconcileTab() {
  const [onlyDrift, setOnlyDrift] = useState(true);
  const RECONCILE_LIMIT = 50;

  type ReconcileResult = {
    count: number; drift_count: number; checked: number; total: number;
    offset: number; limit: number; has_more: boolean; results: ReconcileRow[];
  };

  const reconcile = useMutation({
    mutationFn: async (offset: number) =>
      (await cafeteriaApi.reconcile(onlyDrift, { limit: RECONCILE_LIMIT, offset })).data as ReconcileResult,
  });
  const data = reconcile.data;

  // Seeing a $25 gap and having to re-type the arithmetic into the manual
  // adjustment form is how a reconciliation becomes a second discrepancy.
  const [toFix, setToFix] = useState<ReconcileRow | null>(null);
  const fix = useMutation({
    mutationFn: (studentId: number) => cafeteriaApi.reconcileFix(studentId),
    onSuccess: ({ data: res }) => {
      toast.success(res.adjusted
        ? `Saldo reconciliado: $${parseFloat(res.balance).toFixed(2)}.`
        : 'Ya estaban sincronizados.');
      setToFix(null);
      reconcile.mutate(data?.offset ?? 0);
    },
    onError: (e: unknown) => {
      const d = (e as { response?: { data?: { error?: string } } })?.response?.data;
      toast.error(d?.error ?? 'No se pudo reconciliar.');
    },
  });

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-sm text-muted">
          Compara el saldo local contra los puntos de Loyverse y detecta diferencias
          (lotes de {RECONCILE_LIMIT} alumnos).
        </p>
        <div className="flex items-center gap-3">
          <label className="inline-flex min-h-[44px] items-center gap-2 text-sm text-muted">
            <input type="checkbox" className="h-4 w-4" checked={onlyDrift} onChange={(e) => setOnlyDrift(e.target.checked)} />
            Solo diferencias
          </label>
          <Button size="sm" loading={reconcile.isPending} onClick={() => reconcile.mutate(0)}>
            <Scale className="w-3.5 h-3.5" /> Reconciliar
          </Button>
        </div>
      </div>

      {reconcile.isPending ? (
        <TableSkeleton />
      ) : reconcile.isError ? (
        <ErrorState onRetry={() => reconcile.mutate(0)} />
      ) : !data ? (
        <EmptyState icon={Scale} title="Ejecuta la reconciliación" description="Presiona «Reconciliar» para comparar con Loyverse." />
      ) : (
        <>
          <div className="mb-3 space-y-1 text-sm text-muted">
            {data.drift_count > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-amber">
                <AlertTriangle className="w-4 h-4" /> {data.drift_count} diferencia(s) en este lote
                ({data.checked} revisadas de {data.total}).
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-green-700">
                <CheckCircle2 className="w-4 h-4" /> Todo en orden en este lote
                ({data.checked} revisadas de {data.total}).
              </span>
            )}
            {data.has_more && (
              <p className="text-xs text-subtle">
                Resultados parciales — quedan {data.total - (data.offset + data.checked)} alumno(s).{' '}
                <button
                  type="button"
                  className="font-semibold text-brand-700 hover:underline"
                  onClick={() => reconcile.mutate(data.offset + data.checked)}
                >
                  Revisar siguientes
                </button>
              </p>
            )}
          </div>
          {!data.results.length ? (
            <EmptyState icon={CheckCircle2} title="Sin diferencias" />
          ) : (
            <DataTable
              rows={data.results}
              rowKey={(r) => r.student_id}
              columns={[
                {
                  header: 'Alumno', className: 'font-medium text-ink',
                  cell: (r) => (
                    <span className="block">
                      <Link to={`/admin/cafeteria/${r.student_id}`} className="hover:text-brand-700">{r.student_name}</Link>
                      <span className="block text-xs text-subtle">{r.student_code}</span>
                    </span>
                  ),
                },
                { header: 'Saldo local', align: 'right', className: 'text-ink', cell: (r) => `$${parseFloat(r.local_balance).toFixed(2)}` },
                { header: 'Loyverse', align: 'right', className: 'text-muted', cell: (r) => (r.loyverse_balance !== null ? `$${parseFloat(r.loyverse_balance).toFixed(2)}` : '—') },
                { header: 'Diferencia', align: 'right', className: 'font-medium text-ink', cell: (r) => (r.drift !== null ? `$${parseFloat(r.drift).toFixed(2)}` : '—') },
                {
                  header: 'Estado',
                  cell: (r) => r.error ? <Badge variant="error">Error</Badge>
                    : r.in_sync ? <Badge variant="success">En orden</Badge>
                    : <Badge variant="warning">Diferencia</Badge>,
                },
                {
                  header: 'Acción', align: 'right',
                  cell: (r) => !r.error && !r.in_sync && (
                    <Button size="sm" variant="secondary" onClick={() => setToFix(r)}>
                      <RefreshCw className="h-3.5 w-3.5" /> Corregir
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </>
      )}

      <ConfirmDialog
        open={!!toFix}
        onClose={() => setToFix(null)}
        onConfirm={() => toFix && fix.mutate(toFix.student_id)}
        loading={fix.isPending}
        title="Reconciliar con Loyverse"
        confirmLabel="Aplicar ajuste"
        message={toFix
          ? `Se ajustará el saldo de ${toFix.student_name} de $${parseFloat(toFix.local_balance).toFixed(2)} `
            + `a $${parseFloat(toFix.loyverse_balance ?? '0').toFixed(2)} (el valor de Loyverse). `
            + 'Queda registrado en Auditoría y no se notifica a la familia.'
          : ''}
      />
    </Card>
  );
}

// ── Low balance ──────────────────────────────────────────────────────────────
function LowBalanceTab() {
  const [page, setPage] = useUrlPage();

  const { data: paged, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-cafeteria-low-balance', page],
    queryFn: async () => toPaged<CafeteriaBalance>((await cafeteriaApi.getLowBalance({ page })).data),
    placeholderData: keepPreviousData,
  });

  const data = paged?.results;
  const count = paged?.count ?? 0;

  return (
    <Card>
      {isLoading ? (
        <TableSkeleton />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : !data?.length ? (
        <EmptyState icon={CheckCircle2} title="Ningún alumno con saldo bajo" />
      ) : (
        <>
          <p className="text-sm text-muted mb-3">{count} alumno(s) por debajo del umbral.</p>
          <DataTable
            rows={data}
            rowKey={(b) => b.id}
            columns={[
              {
                header: 'Alumno', className: 'font-medium text-ink',
                cell: (b) => <Link to={`/admin/cafeteria/${b.student.id}`} className="hover:text-brand-700">{b.student.user.full_name}</Link>,
              },
              { header: 'Matrícula', className: 'text-muted', cell: (b) => b.student.student_id },
              { header: 'Código Loyverse', className: 'font-mono text-xs text-muted', cell: (b) => b.student.loyverse_code || b.student.student_id },
              { header: 'Saldo', align: 'right', className: 'font-semibold text-amber', cell: (b) => `$${parseFloat(b.balance).toFixed(2)}` },
              { header: 'Umbral', align: 'right', className: 'text-muted', cell: (b) => `$${parseFloat(b.low_balance_threshold ?? '50').toFixed(2)}` },
              { header: 'Últ. sinc.', className: 'text-muted whitespace-nowrap', cell: (b) => fmtDate(b.last_synced) },
            ]}
          />
          <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} count={count} onChange={setPage} itemLabel="alumnos" />
        </>
      )}
    </Card>
  );
}


// ── Every Loyverse customer (pupils, staff cards, tests) ─────────────────────

const KIND_BADGE: Record<LoyverseCustomerKind, { label: string; variant: 'success' | 'info' | 'warning' | 'neutral' }> = {
  student: { label: 'Alumno', variant: 'success' },
  staff:   { label: 'Personal', variant: 'info' },
  test:    { label: 'Prueba', variant: 'warning' },
  other:   { label: 'Otro', variant: 'neutral' },
};

const KIND_FILTERS: { key: string; label: string }[] = [
  { key: '', label: 'Todos' },
  { key: 'nonstudent', label: 'Sin alumno' },
  { key: 'student', label: 'Alumnos' },
  { key: 'staff', label: 'Personal' },
  { key: 'test', label: 'Prueba' },
  { key: 'other', label: 'Otros' },
];

/**
 * The whole Loyverse store, one row per card. Until 2026-09-23 only the cards
 * linked to a pupil existed in the app; the 44 staff, office and test cards
 * were invisible and read as "missing students". Every card now has a row,
 * refreshed on each sync pass, so the office can see exactly what Loyverse
 * holds, including cards Loyverse has since deleted.
 */
function CustomersTab() {
  const { get, set } = useUrlFilters();
  const [page, setPage] = useUrlPage();
  const { input: search, setInput: setSearch, search: debouncedSearch } = useUrlSyncedSearch('q');
  const kind = get('tipo') ?? '';
  const [receiptsFor, setReceiptsFor] = useState<LoyverseCustomer | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-cafeteria-customers', page, kind, debouncedSearch],
    queryFn: async () => (await cafeteriaApi.getLoyverseCustomers({
      page, ...(kind ? { kind } : {}), ...(debouncedSearch ? { q: debouncedSearch } : {}),
    })).data,
    placeholderData: keepPreviousData,
    ...LIVE,
  });

  const rows = data?.results ?? [];
  const summary = data?.summary;
  const total = summary ? summary.student + summary.staff + summary.test + summary.other : 0;

  return (
    <Card>
      <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, código o correo..."
            aria-label="Buscar cliente de Loyverse"
            className="w-full rounded-xl border border-line bg-white py-2 pl-9 pr-3 text-sm text-ink placeholder:text-subtle focus:border-brand-500 focus:outline-none"
          />
        </div>
        <div role="group" aria-label="Filtrar por tipo" className="flex flex-wrap gap-1">
          {KIND_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={kind === f.key}
              onClick={() => set({ tipo: f.key || null, page: null })}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                kind === f.key ? 'bg-brand-600 text-white' : 'bg-cream text-muted hover:text-ink'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {summary && (
        <p className="mb-3 text-sm text-muted">
          {total} tarjeta(s) en Loyverse: {summary.student} alumno(s), {summary.staff} de personal,
          {' '}{summary.test} de prueba, {summary.other} otra(s)
          {summary.missing > 0 ? `; ${summary.missing} ya no existe(n) en Loyverse.` : '.'}
        </p>
      )}
      {isLoading ? (
        <TableSkeleton />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : !rows.length ? (
        <EmptyState icon={Users} title="Sin clientes que coincidan" description="Las tarjetas se llenan en la siguiente pasada de sincronización (cada 5 minutos)." />
      ) : (
        <>
          <DataTable
            rows={rows}
            rowKey={(c) => c.loyverse_id}
            columns={[
              {
                header: 'Nombre', className: 'font-medium text-ink',
                cell: (c) => c.student
                  ? <Link to={`/admin/cafeteria/${c.student.id}`} className="hover:text-brand-700">{c.name || c.student.name}</Link>
                  : (c.name || '—'),
              },
              { header: 'Código', className: 'font-mono text-xs text-muted', cell: (c) => c.customer_code || '—' },
              { header: 'Tipo', cell: (c) => <Badge variant={KIND_BADGE[c.kind].variant}>{KIND_BADGE[c.kind].label}</Badge> },
              { header: 'Correo', className: 'text-muted', cell: (c) => c.email || '—' },
              { header: 'Saldo', align: 'right', className: 'font-semibold text-ink', cell: (c) => `$${parseFloat(c.total_points).toFixed(2)}` },
              { header: 'Visitas', align: 'right', className: 'text-muted', cell: (c) => c.total_visits },
              { header: 'Última visita', className: 'whitespace-nowrap text-muted', cell: (c) => fmtDate(c.last_visit) },
              {
                header: 'Estado',
                cell: (c) => c.missing_since
                  ? <Badge variant="error">Eliminado en Loyverse</Badge>
                  : <Badge variant="success">Activo</Badge>,
              },
              {
                header: 'Compras', align: 'right',
                cell: (c) => c.student
                  ? <Link to={`/admin/cafeteria/${c.student.id}`} className="text-xs font-semibold text-brand-700 hover:underline">Ver alumno</Link>
                  : (
                    <Button size="sm" variant="ghost" onClick={() => setReceiptsFor(c)} aria-label={`Ver compras de ${c.name}`}>
                      <Receipt className="h-3.5 w-3.5" /> {c.receipts}
                    </Button>
                  ),
              },
            ]}
          />
          <Pagination page={page} pageSize={50} count={data?.count ?? 0} onChange={setPage} itemLabel="clientes" />
        </>
      )}
      <CustomerReceiptsModal customer={receiptsFor} onClose={() => setReceiptsFor(null)} />
    </Card>
  );
}

function CustomerReceiptsModal({ customer, onClose }: { customer: LoyverseCustomer | null; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-cafeteria-customer-receipts', customer?.loyverse_id],
    queryFn: async () => (await cafeteriaApi.getLoyverseCustomerReceipts(customer!.loyverse_id)).data,
    enabled: !!customer,
  });
  return (
    <Modal open={!!customer} onClose={onClose} title={customer ? `Compras: ${customer.name}` : 'Compras'} maxWidth={640}>
      {isLoading ? (
        <TableSkeleton />
      ) : isError ? (
        <ErrorState />
      ) : !data?.results.length ? (
        <EmptyState icon={Receipt} title="Sin compras registradas" description="Solo se conservan las compras cobradas al monedero desde que la app empezó a guardarlas." />
      ) : (
        <DataTable
          rows={data.results}
          rowKey={(r) => r.receipt_number}
          columns={[
            { header: 'Fecha', className: 'whitespace-nowrap text-muted', cell: (r) => fmtDate(r.receipt_date) },
            { header: 'Recibo', className: 'font-mono text-xs text-subtle', cell: (r) => r.receipt_number },
            { header: 'Artículos', className: 'text-muted', cell: (r) => r.items || '—' },
            { header: 'Monto', align: 'right', className: 'font-medium text-ink', cell: (r) => `${r.receipt_type === 'REFUND' ? '+' : '−'}$${parseFloat(r.points).toFixed(2)}` },
          ]}
        />
      )}
    </Modal>
  );
}
