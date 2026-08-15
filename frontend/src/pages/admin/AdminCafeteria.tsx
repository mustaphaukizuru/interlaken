import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Coffee, RefreshCw, Search, Download, ChevronRight, ScrollText,
  Scale, AlertTriangle, CheckCircle2, Store,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { TableSkeleton } from '@/components/ui/TableSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Pagination } from '@/components/ui/Pagination';
import { cafeteriaApi, downloadBlob } from '@/services/api';
import { toPaged, ADMIN_PAGE_SIZE } from '@/lib/pagination';
import type { CafeteriaBalance, TopUpLogEntry, ReconcileRow } from '@/types';

type Tab = 'roster' | 'deposits' | 'pos' | 'reconcile' | 'low';

const TABS: { key: Tab; label: string; icon: typeof Coffee }[] = [
  { key: 'roster',    label: 'Saldos',         icon: Coffee },
  { key: 'deposits',  label: 'Depósitos',      icon: ScrollText },
  { key: 'pos',       label: 'POS Loyverse',   icon: Store },
  { key: 'reconcile', label: 'Reconciliación', icon: Scale },
  { key: 'low',       label: 'Saldo bajo',     icon: AlertTriangle },
];

const fmtDate = (d: string | null) =>
  d ? format(new Date(d), 'd MMM yyyy, HH:mm', { locale: es }) : '—';

export default function AdminCafeteria() {
  const [tab, setTab] = useState<Tab>('roster');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-head text-fluid-xl font-bold leading-tight tracking-[-0.3px] text-ink">Cafetería — Admin</h1>
          <p className="mt-1 text-sm text-muted">
            Saldos, depósitos, carga/quita en POS, ajustes, devoluciones y reconciliación.
          </p>
        </div>
        <SchoolExportButtons />
      </div>

      <div className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`inline-flex min-h-[44px] items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
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
    </div>
  );
}

function SchoolExportButtons() {
  const doExport = async (fmt: 'csv' | 'pdf') => {
    try {
      const { data } = await cafeteriaApi.exportSchool(fmt);
      downloadBlob(data, `saldos_cafeteria_escuela.${fmt}`);
    } catch {
      toast.error('No se pudo generar el archivo.');
    }
  };
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" onClick={() => doExport('csv')}>
        <Download className="w-3.5 h-3.5" /> CSV
      </Button>
      <Button size="sm" variant="secondary" onClick={() => doExport('pdf')}>
        <Download className="w-3.5 h-3.5" /> PDF
      </Button>
    </div>
  );
}

// ── Roster ───────────────────────────────────────────────────────────────────
function RosterTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-cafeteria-balances', page],
    queryFn: async () => toPaged<CafeteriaBalance>((await cafeteriaApi.getAllBalances({ page })).data),
    placeholderData: keepPreviousData,
  });

  const balances = data?.results;
  const count = data?.count ?? 0;

  const [lastSync, setLastSync] = useState<{
    receipts: number; purchases_created: number; balances_ok: number; balances_failed: number;
  } | null>(null);

  const syncAll = useMutation({
    mutationFn: () => cafeteriaApi.syncAll(),
    onSuccess: ({ data }) => {
      const created = data?.purchases_created ?? 0;
      const receipts = data?.receipts ?? 0;
      const ok = data?.balances_ok ?? 0;
      const failed = data?.balances_failed ?? 0;
      setLastSync({ receipts, purchases_created: created, balances_ok: ok, balances_failed: failed });
      toast.success(
        `Sincronización: ${ok} saldo(s) ok`
        + (failed ? `, ${failed} fallido(s)` : '')
        + `, ${receipts} recibo(s), ${created} compra(s) nueva(s).`,
      );
      queryClient.invalidateQueries({ queryKey: ['admin-cafeteria-balances'] });
    },
    onError: () => toast.error('Error al sincronizar.'),
  });

  const syncOne = useMutation({
    mutationFn: (studentId: number) => cafeteriaApi.syncBalance(studentId),
    onSuccess: () => {
      toast.success('Saldo sincronizado.');
      queryClient.invalidateQueries({ queryKey: ['admin-cafeteria-balances'] });
    },
    onError: () => toast.error('Error al sincronizar.'),
  });

  const filtered = balances?.filter((b) =>
    !search ||
    b.student.user.full_name.toLowerCase().includes(search.toLowerCase()) ||
    b.student.student_id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
          <input
            className="input-field pl-9"
            placeholder="Buscar alumno o matrícula…"
            aria-label="Buscar alumno o matrícula"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="secondary" size="sm" loading={syncAll.isPending} onClick={() => syncAll.mutate()}>
          <RefreshCw className="w-3.5 h-3.5" /> Sincronizar todos
        </Button>
      </div>
      {lastSync && (
        <p className="-mt-1 mb-3 text-xs text-subtle">
          Última sincronización — saldos ok: {lastSync.balances_ok}
          {lastSync.balances_failed > 0 ? `, fallidos: ${lastSync.balances_failed}` : ''}
          , recibos: {lastSync.receipts}, compras nuevas: {lastSync.purchases_created}.
        </p>
      )}
      <p className="-mt-2 mb-4 text-xs text-subtle">La búsqueda filtra la página actual.</p>

      {isLoading ? (
        <TableSkeleton />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : !filtered?.length ? (
        <EmptyState icon={Coffee} title={search ? 'Sin resultados' : 'Sin saldos registrados'} />
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
                      <span className="block text-xs font-normal text-subtle">{b.student.student_id}</span>
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
                        loading={syncOne.isPending}
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
          <div className="admin-table-wrap hidden md:block">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Alumno</th>
                  <th>Matrícula</th>
                  <th className="num">Saldo</th>
                  <th>Estado</th>
                  <th>Últ. sinc.</th>
                  <th className="num">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => {
                  const isLow = parseFloat(b.balance) <= parseFloat(b.low_balance_threshold ?? '50');
                  return (
                    <tr key={b.id}>
                      <td className="font-medium text-ink">
                        <Link to={`/admin/cafeteria/${b.student.id}`} className="hover:text-brand-700">
                          {b.student.user.full_name}
                        </Link>
                      </td>
                      <td className="text-muted">{b.student.student_id}</td>
                      <td className="num font-semibold text-ink">${parseFloat(b.balance).toFixed(2)}</td>
                      <td>
                        <Badge variant={isLow ? 'warning' : 'success'}>{isLow ? 'Saldo bajo' : 'Normal'}</Badge>
                      </td>
                      <td className="text-muted whitespace-nowrap">{fmtDate(b.last_synced)}</td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Sincronizar saldo de ${b.student.user.full_name}`}
                            title="Sincronizar saldo"
                            onClick={() => syncOne.mutate(b.student.id)}
                            loading={syncOne.isPending}
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} count={count} onChange={setPage} itemLabel="alumnos" />
    </Card>
  );
}

// ── Deposits log ─────────────────────────────────────────────────────────────
function DepositsTab() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

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
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
        >
          <option value="">Todos</option>
          <option value="pending">Pendiente</option>
          <option value="completed">Completado</option>
          <option value="failed">Fallido</option>
        </select>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : !data?.length ? (
        <EmptyState icon={ScrollText} title="Sin depósitos registrados" />
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Alumno</th>
                <th className="num">Monto</th>
                <th>Método</th>
                <th>Pasarela</th>
                <th>Estado</th>
                <th>POS</th>
                <th>Referencia</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id}>
                  <td data-label="Fecha" className="whitespace-nowrap text-muted">{fmtDate(d.created_at)}</td>
                  <td data-label="Alumno" className="font-medium text-ink">
                    <span className="block">
                      <Link to={`/admin/cafeteria/${d.student_id}`} className="hover:text-brand-700">
                        {d.student_name}
                      </Link>
                      <span className="block text-xs text-subtle">{d.student_code}</span>
                    </span>
                  </td>
                  <td data-label="Monto" className="num font-semibold text-ink">${parseFloat(d.amount).toFixed(2)}</td>
                  <td data-label="Método" className="text-muted">{d.method_display}</td>
                  <td data-label="Pasarela" className="text-muted">{d.gateway || '—'}</td>
                  <td data-label="Estado"><Badge variant={statusVariant(d.status)}>{d.status_display}</Badge></td>
                  <td data-label="POS">
                    {d.needs_pos_unload ? (
                      <Badge variant="error">Quitar del POS</Badge>
                    ) : d.needs_pos_load ? (
                      <Badge variant="warning">Pendiente POS</Badge>
                    ) : d.pos_loaded_at ? (
                      <Badge variant="success">En POS</Badge>
                    ) : (
                      <span className="text-subtle">—</span>
                    )}
                  </td>
                  <td data-label="Referencia" className="text-subtle text-xs font-mono">{d.gateway_tx_id || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Acreditada</th>
                <th>Alumno</th>
                <th className="num">Monto</th>
                <th>Pasarela</th>
                <th>Referencia</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id}>
                  <td data-label="Acreditada" className="whitespace-nowrap text-muted">
                    {fmtDate(d.processed_at || d.created_at)}
                  </td>
                  <td data-label="Alumno" className="font-medium text-ink">
                    <span className="block">
                      <Link to={`/admin/cafeteria/${d.student_id}`} className="hover:text-brand-700">
                        {d.student_name}
                      </Link>
                      <span className="block text-xs text-subtle">{d.student_code}</span>
                    </span>
                  </td>
                  <td data-label="Monto" className="num font-semibold text-ink">
                    ${parseFloat(d.amount).toFixed(2)}
                  </td>
                  <td data-label="Pasarela" className="text-muted">{d.gateway || '—'}</td>
                  <td data-label="Referencia" className="text-subtle text-xs font-mono">
                    {d.gateway_tx_id || '—'}
                  </td>
                  <td data-label="Acción" className="text-right">
                    <Button
                      size="sm"
                      loading={mark.isPending && mark.variables === d.id}
                      onClick={() => mark.mutate(d.id)}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Cargado en Loyverse
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Reembolso</th>
                <th>Alumno</th>
                <th className="num">Monto</th>
                <th>Pasarela</th>
                <th>Referencia</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id}>
                  <td data-label="Reembolso" className="whitespace-nowrap text-muted">
                    {fmtDate(d.pos_unload_needed_at)}
                  </td>
                  <td data-label="Alumno" className="font-medium text-ink">
                    <span className="block">
                      <Link to={`/admin/cafeteria/${d.student_id}`} className="hover:text-brand-700">
                        {d.student_name}
                      </Link>
                      <span className="block text-xs text-subtle">{d.student_code}</span>
                    </span>
                  </td>
                  <td data-label="Monto" className="num font-semibold text-ink">
                    ${parseFloat(d.amount).toFixed(2)}
                  </td>
                  <td data-label="Pasarela" className="text-muted">{d.gateway || '—'}</td>
                  <td data-label="Referencia" className="text-subtle text-xs font-mono">
                    {d.gateway_tx_id || '—'}
                  </td>
                  <td data-label="Acción" className="text-right">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={mark.isPending && mark.variables === d.id}
                      onClick={() => mark.mutate(d.id)}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Quitado de Loyverse
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Alumno</th>
                    <th className="num">Saldo local</th>
                    <th className="num">Loyverse</th>
                    <th className="num">Diferencia</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.results.map((r) => (
                    <tr key={r.student_id}>
                      <td data-label="Alumno" className="font-medium text-ink">
                        <span className="block">
                          <Link to={`/admin/cafeteria/${r.student_id}`} className="hover:text-brand-700">{r.student_name}</Link>
                          <span className="block text-xs text-subtle">{r.student_code}</span>
                        </span>
                      </td>
                      <td data-label="Saldo local" className="num text-ink">${parseFloat(r.local_balance).toFixed(2)}</td>
                      <td data-label="Loyverse" className="num text-muted">
                        {r.loyverse_balance !== null ? `$${parseFloat(r.loyverse_balance).toFixed(2)}` : '—'}
                      </td>
                      <td data-label="Diferencia" className="num font-medium text-ink">
                        {r.drift !== null ? `$${parseFloat(r.drift).toFixed(2)}` : '—'}
                      </td>
                      <td data-label="Estado">
                        {r.error ? (
                          <Badge variant="error">Error</Badge>
                        ) : r.in_sync ? (
                          <Badge variant="success">En orden</Badge>
                        ) : (
                          <Badge variant="warning">Diferencia</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ── Low balance ──────────────────────────────────────────────────────────────
function LowBalanceTab() {
  const [page, setPage] = useState(1);

  const { data: paged, isLoading } = useQuery({
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
      ) : !data?.length ? (
        <EmptyState icon={CheckCircle2} title="Ningún alumno con saldo bajo" />
      ) : (
        <>
          <p className="text-sm text-muted mb-3">{count} alumno(s) por debajo del umbral.</p>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Alumno</th>
                  <th>Matrícula</th>
                  <th className="num">Saldo</th>
                  <th className="num">Umbral</th>
                  <th>Últ. sinc.</th>
                </tr>
              </thead>
              <tbody>
                {data.map((b) => (
                  <tr key={b.id}>
                    <td data-label="Alumno" className="font-medium text-ink">
                      <Link to={`/admin/cafeteria/${b.student.id}`} className="hover:text-brand-700">
                        {b.student.user.full_name}
                      </Link>
                    </td>
                    <td data-label="Matrícula" className="text-muted">{b.student.student_id}</td>
                    <td data-label="Saldo" className="num font-semibold text-amber">${parseFloat(b.balance).toFixed(2)}</td>
                    <td data-label="Umbral" className="num text-muted">${parseFloat(b.low_balance_threshold ?? '50').toFixed(2)}</td>
                    <td data-label="Últ. sinc." className="text-muted whitespace-nowrap">{fmtDate(b.last_synced)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} count={count} onChange={setPage} itemLabel="alumnos" />
        </>
      )}
    </Card>
  );
}
