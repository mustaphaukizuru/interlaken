import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Coffee, RefreshCw, ChevronRight, ScrollText, Scale, AlertTriangle, CheckCircle2, Store,
  Users, Receipt, ArrowLeftRight, RotateCcw, FileUp, Wallet,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { TableSkeleton } from '@/components/ui/TableSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { parseSort, serializeSort, type SortState } from '@/components/ui/SortableTh';
import { LiveBadge } from '@/components/ui/LiveBadge';
import { PageHeader } from '@/components/layout/PageHeader';
import { BulkTopUpDialog } from '@/components/admin/BulkTopUpDialog';
import { SyncHealthPanel } from '@/components/admin/SyncHealthPanel';
import { FilterBar } from '@/components/admin/FilterBar';
import { ExportMenu } from '@/components/admin/ExportMenu';
import { BulkActionBar } from '@/components/admin/BulkActionBar';
import { BulkConfirmDialog } from '@/components/admin/BulkConfirmDialog';
import { ImportDialog } from '@/components/admin/ImportDialog';
import { cafeteriaApi, downloadBlob, type LoyverseCustomer } from '@/services/api';
import { adjustmentImportApi, type AdminTransaction, type ReconcileRowV2, type TopUpBulkResult } from '@/services/cafeteriaAdmin';
import { exportFilename, idsParam, type BulkActionDef, type BulkRequest, type BulkResult, type ExportFormat, type ImportRow, type ListParams } from '@/services/dataOps';
import { useUrlFilters, useUrlPage } from '@/hooks/useUrlFilters';
import { useRowSelection, type RowKey } from '@/hooks/useRowSelection';
import { invalidateEntity } from '@/hooks/queries/keys';
import {
  CAF_BALANCES, CAF_MONEY_VIEWS, CAF_TOPUPS,
  useBalancesBulk, useBalancesExport, useBalancesList, useCustomersExport, useCustomersList,
  useLowBalanceExport, useLowBalanceList, useReconcileBulk, useReconcileExport, useReconcileList,
  useTopUpsBulk, useTopUpsExport, useTopUpsList, useTransactionsExport, useTransactionsList,
} from '@/hooks/queries/cafeteria';
import { apiErrorMessage } from '@/lib/apiErrors';
import { LIVE } from '@/lib/live';
import { GRADES } from '@/lib/rosterTable';
import { STUDENT_STATUS } from '@/lib/studentStatus';
import { CUSTOMER_KIND, TOPUP_METHOD, TOPUP_STATUS, TX_TYPE, options } from '@/lib/status/cafeteria';
import type { CafeteriaBalance, TopUpLogEntry } from '@/types';

type Tab = 'roster' | 'movements' | 'deposits' | 'pos' | 'reconcile' | 'low' | 'customers';

const TABS: { key: Tab; label: string; icon: typeof Coffee }[] = [
  { key: 'roster',    label: 'Saldos',         icon: Coffee },
  { key: 'movements', label: 'Movimientos',    icon: ArrowLeftRight },
  { key: 'deposits',  label: 'Depósitos',      icon: ScrollText },
  { key: 'pos',       label: 'POS Loyverse',   icon: Store },
  { key: 'reconcile', label: 'Reconciliación', icon: Scale },
  { key: 'low',       label: 'Saldo bajo',     icon: AlertTriangle },
  { key: 'customers', label: 'Clientes Loyverse', icon: Users },
];

/** Every per-tab URL param; switching tabs drops them all. */
const TAB_PARAMS = ['q', 'estado', 'tipo', 'page', 'orden', 'grado', 'grupo', 'desde', 'hasta', 'metodo', 'saldo', 'vinculo', 'alumno', 'solo'];

const fmtDate = (d: string | null | undefined) =>
  d ? format(new Date(d), 'd MMM yyyy, HH:mm', { locale: es }) : '—';
const mxn = (v: string | number | null | undefined) => `$${parseFloat(String(v ?? 0)).toFixed(2)}`;

/** Drop empty values so the API (and the query key) only carries real filters. */
function clean(params: Record<string, string | number | undefined | null>): ListParams {
  const out: ListParams = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') out[k] = v;
  return out;
}

const GRADE_OPTIONS = GRADES.map((g) => ({ value: g, label: g }));
const STUDENT_STATUS_OPTIONS = Object.entries(STUDENT_STATUS).map(([value, m]) => ({ value, label: m.label }));

/** Sort state in the URL (`orden`), like every other filter. */
function useUrlSort(): [SortState, (next: SortState) => void] {
  const { get, set } = useUrlFilters();
  return [parseSort(get('orden')), (next) => set({ orden: serializeSort(next), page: null })];
}

/** Export of the current view (or the selection) through ExportMenu v2. */
function exporter(
  run: (p: ListParams & { fmt: ExportFormat; ids?: string }) => Promise<Blob>,
  filters: ListParams,
  selection: { allMatching: boolean; ids: RowKey[] },
) {
  return (fmt: ExportFormat, { selectedOnly }: { selectedOnly: boolean }) =>
    run({ ...filters, fmt, ids: selectedOnly && !selection.allMatching ? idsParam(selection.ids) : undefined });
}

export default function AdminCafeteria() {
  // Active tab + per-tab filters live in the URL (shareable, survive refresh).
  const { get, set } = useUrlFilters();
  const tabParam = get('tab');
  const tab: Tab = TABS.some((t) => t.key === tabParam) ? (tabParam as Tab) : 'roster';
  const setTab = (key: Tab) =>
    set({ tab: key === 'roster' ? null : key, ...Object.fromEntries(TAB_PARAMS.map((k) => [k, null])) });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cafetería"
        subtitle="Saldos, movimientos, depósitos, carga/quita en POS, ajustes, devoluciones y reconciliación."
        actions={<HeaderActions />}
      />

      {/* One scrolling row on phones; -mx cancels the page gutter so the strip
          bleeds to the edge like a native tab bar. */}
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
              tab === key ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            <Icon className="w-4 h-4" aria-hidden="true" /> {label}
          </button>
        ))}
      </div>

      {tab === 'roster' && <RosterTab />}
      {tab === 'movements' && <MovementsTab />}
      {tab === 'deposits' && <DepositsTab />}
      {tab === 'pos' && <PosLoadTab />}
      {tab === 'reconcile' && <ReconcileTab />}
      {tab === 'low' && <LowBalanceTab />}
      {tab === 'customers' && <CustomersTab />}
    </div>
  );
}

// ── Header: recarga masiva, ajuste masivo, "Toda la escuela" ────────────────
function HeaderActions() {
  const { get, set } = useUrlFilters();
  const exportBalances = useBalancesExport();
  const [importOpen, setImportOpen] = useState(false);
  const fetchSchool = (fmt: ExportFormat) => exportBalances.mutateAsync({ fmt });

  // Command-palette deep link: /admin/cafeteria?exportar=csv downloads the
  // whole-school balances, then consumes the param.
  const consumed = useRef(false);
  const exportParam = get('exportar');
  useEffect(() => {
    if (!exportParam || consumed.current) return;
    consumed.current = true;
    const fmt: ExportFormat = exportParam === 'pdf' ? 'pdf' : exportParam === 'xlsx' ? 'xlsx' : 'csv';
    exportBalances.mutate({ fmt }, {
      onSuccess: (blob) => downloadBlob(blob, exportFilename('saldos_cafeteria_escuela', fmt)),
      onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo generar el archivo.')),
    });
    set({ exportar: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportParam]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <BulkTopUpDialog />
      <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
        <FileUp className="w-3.5 h-3.5" aria-hidden="true" /> Ajuste masivo
      </Button>
      <ExportMenu label="Toda la escuela" filenamePrefix="saldos_cafeteria_escuela" fetch={(fmt) => fetchSchool(fmt)} />
      <AdjustmentImport open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

const ADJUSTMENT_COLUMNS: Column<ImportRow>[] = [
  { id: 'alumno', header: 'Alumno', cell: (r) => String(r.data.alumno ?? '—') },
  { id: 'monto', header: 'Monto', align: 'right', cell: (r) => (r.data.monto != null ? mxn(r.data.monto as string) : '—') },
  { id: 'saldo_actual', header: 'Saldo actual', align: 'right', className: 'text-muted', cell: (r) => (r.data.saldo_actual != null ? mxn(r.data.saldo_actual as string) : '—') },
  {
    id: 'saldo_resultante', header: 'Saldo resultante', align: 'right',
    cell: (r) => {
      if (r.data.saldo_resultante == null) return '—';
      const v = parseFloat(String(r.data.saldo_resultante));
      return <span className={v < 0 ? 'font-semibold text-coral-700' : 'font-semibold text-ink'}>{mxn(v)}</span>;
    },
  },
];

/** "Ajuste masivo": matricula, monto, motivo → one audited adjustment per row (C4). */
function AdjustmentImport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [notify, setNotify] = useState(true);
  const [mirror, setMirror] = useState(true);
  // Rebuilt when a box is ticked, so the commit posts the flags on screen.
  const api = useMemo(() => adjustmentImportApi({ notify, mirror }), [notify, mirror]);
  return (
    <ImportDialog
      open={open}
      onClose={onClose}
      title="Ajuste masivo de saldos"
      entity={CAF_BALANCES}
      related={CAF_MONEY_VIEWS}
      api={api}
      templatePrefix="ajustes_cafeteria"
      headers={[{ key: 'matricula', required: true }, { key: 'monto', required: true }, { key: 'motivo', required: true }]}
      extraColumns={ADJUSTMENT_COLUMNS}
      description={(
        <div className="space-y-2">
          <p>
            Una fila por alumno: <strong>monto</strong> positivo abona y negativo descuenta. La vista previa muestra el saldo
            resultante; una fila que dejaría el saldo en negativo se rechaza. Máximo 500 filas por archivo.
          </p>
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm text-ink">
            <input type="checkbox" className="h-4 w-4 rounded border-line text-purple focus:ring-purple/40" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Notificar a las familias
          </label>
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm text-ink">
            <input type="checkbox" className="h-4 w-4 rounded border-line text-purple focus:ring-purple/40" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
            Reflejar el saldo en Loyverse
          </label>
        </div>
      )}
    />
  );
}

// ── Saldos ───────────────────────────────────────────────────────────────────
const BALANCE_ACTIONS: BulkActionDef[] = [
  { name: 'sync', label: 'Sincronizar', planVerb: 'Se sincronizarán' },
  { name: 'set_threshold', label: 'Cambiar umbral', planVerb: 'Se cambiará el umbral de' },
];

function balanceColumns(name: string): Column<CafeteriaBalance>[] {
  return [
    {
      id: 'student', header: 'Alumno', sortKey: 'student', hideable: false, minWidth: 180, className: 'font-medium text-ink',
      cell: (b) => <Link to={`/admin/cafeteria/${b.student.id}`} className="hover:text-brand-700">{b.student.user.full_name}</Link>,
    },
    { id: 'matricula', header: 'Matrícula', className: 'text-muted', cell: (b) => b.student.student_id },
    { id: 'code', header: 'Código Loyverse', className: 'font-mono text-xs text-muted', cell: (b) => b.student.loyverse_code || b.student.student_id },
    { id: 'grade', header: 'Grado', sortKey: 'grade', className: 'text-muted whitespace-nowrap', cell: (b) => `${b.student.grade} ${b.student.group}`.trim() },
    { id: 'balance', header: name, sortKey: 'balance', align: 'right', hideable: false, className: 'font-semibold text-ink', cell: (b) => mxn(b.balance) },
    { id: 'threshold', header: 'Umbral', sortKey: 'threshold', align: 'right', defaultHidden: name === 'Saldo', className: 'text-muted', cell: (b) => mxn(b.low_balance_threshold ?? '50') },
    {
      id: 'state', header: 'Estado',
      cell: (b) => {
        const isLow = parseFloat(b.balance) <= parseFloat(b.low_balance_threshold ?? '50');
        return <Badge variant={isLow ? 'warning' : 'success'}>{isLow ? 'Saldo bajo' : 'Normal'}</Badge>;
      },
    },
    { id: 'last_synced', header: 'Últ. sinc.', sortKey: 'last_synced', className: 'text-muted whitespace-nowrap', cell: (b) => fmtDate(b.last_synced) },
  ];
}

function RosterTab() {
  const queryClient = useQueryClient();
  const { get } = useUrlFilters();
  const [page, setPage] = useUrlPage();
  const [sort, onSort] = useUrlSort();
  const saldo = get('saldo');
  const vinculo = get('vinculo');
  const filters = clean({
    q: get('q'), status: get('estado'), grade: get('grado'), group: get('grupo'),
    low_balance: saldo === 'bajo' ? 'true' : saldo === 'normal' ? 'false' : undefined,
    unlinked: vinculo === 'sin' ? 'true' : vinculo === 'con' ? 'false' : undefined,
    ordering: serializeSort(sort),
  });

  const { data, isLoading, isError, refetch, dataUpdatedAt, isFetching } = useBalancesList({ page, ...filters }, LIVE);
  const rows = data?.results;
  const count = data?.count ?? 0;
  const selection = useRowSelection(count, JSON.stringify(filters));
  const exportBalances = useBalancesExport();
  const bulk = useBalancesBulk();
  const [pending, setPending] = useState<BulkActionDef | null>(null);
  const [askThreshold, setAskThreshold] = useState(false);
  const [threshold, setThreshold] = useState('50');

  const [lastSync, setLastSync] = useState<{
    receipts: number; purchases_created: number; balances_ok: number; balances_failed: number;
    unmatched: number; skipped: number;
  } | null>(null);

  const refreshBalances = () => invalidateEntity(queryClient, CAF_BALANCES, CAF_MONEY_VIEWS);

  const syncAll = useMutation({
    mutationFn: () => cafeteriaApi.syncAll(),
    onSuccess: ({ data: d }) => {
      const created = d?.purchases_created ?? 0;
      const receipts = d?.receipts ?? 0;
      const failed = d?.balances_failed ?? 0;
      const unmatched = d?.unmatched ?? 0;
      const skipped = d?.skipped ?? 0;
      setLastSync({ receipts, purchases_created: created, balances_ok: d?.balances_ok ?? 0, balances_failed: failed, unmatched, skipped });
      // Say why a run moved nothing: "0 compras nuevas" alone looks identical
      // whether nobody is linked or there genuinely were no sales.
      const posTopups = d?.pos_topups_credited ?? 0;
      const deferred = d?.pos_topups_deferred ?? 0;
      toast.success(
        `Sincronización: ${receipts} recibo(s), ${created} compra(s) nueva(s)`
        + (posTopups ? `, ${posTopups} recarga(s) en caja por $${parseFloat(d?.pos_topups_total ?? '0').toFixed(2)}` : '')
        + (deferred ? `, ${deferred} recarga(s) en espera (monedero con movimientos recientes)` : '')
        + (skipped ? `, ${skipped} sin movimiento de monedero` : '')
        + (unmatched ? `, ${unmatched} sin alumno vinculado` : '')
        + (failed ? `, ${failed} saldo(s) fallido(s)` : '')
        + '.',
      );
      void refreshBalances();
    },
    onError: () => toast.error('Error al sincronizar.'),
  });

  const syncOne = useMutation({
    mutationFn: (studentId: number) => cafeteriaApi.syncBalance(studentId),
    onSuccess: ({ data: d }) => {
      const local = mxn(d.balance);
      if (d.in_sync === true) toast.success(`Saldo ${local}, coincide con Loyverse.`);
      else if (d.in_sync === false) {
        toast(
          `Saldo local ${local}, Loyverse ${mxn(d.loyverse_balance ?? '0')} `
          + `(diferencia ${mxn(d.drift ?? '0')}). Use Reconciliación para corregir.`,
          { icon: '⚠️', duration: 8000 },
        );
      } else toast.success(`Saldo ${local}. No se pudo consultar Loyverse.`);
      void refreshBalances();
    },
    onError: () => toast.error('Error al sincronizar.'),
  });

  const onAction = (a: BulkActionDef) => {
    if (a.name === 'set_threshold') setAskThreshold(true);
    else setPending(a);
  };
  const execute = (body: BulkRequest) =>
    bulk.mutateAsync(
      pending?.name === 'set_threshold' ? { ...body, payload: { ...body.payload, threshold } } : body,
    );
  const fetchExport = exporter((p) => exportBalances.mutateAsync(p), filters, selection);
  const validThreshold = threshold !== '' && Number(threshold) >= 0;

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-3">
        <LiveBadge updatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={() => refetch()} className="min-h-[44px]" />
        <Button variant="secondary" size="sm" loading={syncAll.isPending} onClick={() => syncAll.mutate()}>
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Sincronizar todos
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
              {lastSync.skipped > 0 && <>{lastSync.skipped} recibo(s) sin movimiento de monedero (venta en efectivo o tarjeta: el saldo no cambia). </>}
              {lastSync.unmatched > 0 && <>{lastSync.unmatched} recibo(s) de un cliente que no es un alumno vinculado — revise “Vincular Loyverse” en Alumnos.</>}
            </p>
          )}
        </div>
      )}

      <DataTable<CafeteriaBalance>
        tableId="cafeteria-balances"
        columns={balanceColumns('Saldo')}
        rows={rows}
        rowKey={(b) => b.id}
        rowLabel={(b) => b.student.user.full_name}
        caption="Saldos de cafetería"
        sort={sort}
        onSort={onSort}
        page={page}
        count={count}
        onPage={setPage}
        itemLabel="alumnos"
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        columnControls
        resizable
        pinFirstColumn
        selection={selection}
        toolbar={(
          <FilterBar
            search={{ placeholder: 'Alumno, matrícula, código Loyverse o correo del tutor…', label: 'Buscar alumno, matrícula o código Loyverse' }}
            selects={[
              { key: 'grado', label: 'Grado', options: GRADE_OPTIONS, allLabel: 'Todos los grados' },
              { key: 'estado', label: 'Estado del alumno', options: STUDENT_STATUS_OPTIONS, allLabel: 'Todos los estados' },
              { key: 'saldo', label: 'Saldo', options: [{ value: 'bajo', label: 'Saldo bajo' }, { value: 'normal', label: 'Normal' }], allLabel: 'Cualquier saldo' },
              { key: 'vinculo', label: 'Loyverse', options: [{ value: 'sin', label: 'Sin vincular' }, { value: 'con', label: 'Vinculados' }], allLabel: 'Vinculados o no' },
            ]}
          >
            <ExportMenu filenamePrefix="saldos_cafeteria" selectedCount={selection.count} fetch={fetchExport} />
          </FilterBar>
        )}
        bulkBar={(
          <BulkActionBar
            count={selection.count}
            allMatching={selection.allMatching}
            allMatchingCount={count}
            onSelectAllMatching={selection.onSelectAllMatching}
            onClear={selection.onClear}
            actions={BALANCE_ACTIONS}
            onAction={onAction}
            itemLabel="alumnos"
            gender="m"
            exportMenu={<ExportMenu label="Exportar seleccionados" filenamePrefix="saldos_cafeteria" selectedCount={selection.count} forceSelected fetch={fetchExport} />}
          />
        )}
        rowActions={(b) => (
          <>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Sincronizar saldo de ${b.student.user.full_name}`}
              title="Sincronizar saldo"
              onClick={() => syncOne.mutate(b.student.id)}
              loading={syncOne.isPending && syncOne.variables === b.student.id}
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            </Button>
            <Link
              to={`/admin/cafeteria/${b.student.id}`}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-muted hover:bg-cream md:min-h-[36px] md:min-w-[36px]"
              title="Ver detalle"
              aria-label={`Ver detalle de ${b.student.user.full_name}`}
            >
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </>
        )}
        empty={{ icon: Coffee, title: filters.q ? 'Sin resultados' : 'Sin saldos registrados', description: 'Ajuste la búsqueda o los filtros.' }}
      />

      <Modal open={askThreshold} onClose={() => setAskThreshold(false)} title="Umbral de saldo bajo" maxWidth={420}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!validThreshold) return;
            setAskThreshold(false);
            setPending(BALANCE_ACTIONS[1]);
          }}
        >
          <Input label="Nuevo umbral (MXN)" type="number" inputMode="decimal" min="0" step="1" required value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          <p className="text-xs text-muted">Se avisa a la familia cuando el saldo queda en este monto o menos.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setAskThreshold(false)}>Cancelar</Button>
            <Button type="submit" size="sm" disabled={!validThreshold}>Continuar</Button>
          </div>
        </form>
      </Modal>

      <BulkConfirmDialog
        open={!!pending}
        onClose={() => setPending(null)}
        action={pending}
        entityLabel="alumnos"
        gender="m"
        ids={selection.ids}
        allMatching={selection.allMatching}
        filters={filters}
        execute={execute}
        onDone={() => selection.onClear()}
        renderPlan={() => (pending?.name === 'set_threshold' ? <p className="text-xs">Nuevo umbral: {mxn(threshold)}.</p> : null)}
      />
    </Card>
  );
}

// ── Movimientos (every student's ledger) ─────────────────────────────────────
const TX_COLUMNS: Column<AdminTransaction>[] = [
  { id: 'date', header: 'Fecha', sortKey: 'date', hideable: false, minWidth: 150, className: 'whitespace-nowrap text-muted', cell: (t) => fmtDate(t.date) },
  {
    id: 'student', header: 'Alumno', sortKey: 'student', minWidth: 170, className: 'font-medium text-ink',
    cell: (t) => (
      <span className="block">
        <Link to={`/admin/cafeteria/${t.student_id}`} className="hover:text-brand-700">{t.student_name}</Link>
        <span className="block text-xs text-subtle">{t.student_code}</span>
      </span>
    ),
  },
  { id: 'type', header: 'Tipo', sortKey: 'type', cell: (t) => <Badge variant={TX_TYPE[t.transaction_type]?.variant ?? 'neutral'}>{TX_TYPE[t.transaction_type]?.label ?? t.type_display}</Badge> },
  { id: 'description', header: 'Descripción', className: 'text-muted', cell: (t) => <span className="block max-w-xs truncate" title={t.description}>{t.description || '—'}</span> },
  { id: 'amount', header: 'Monto', sortKey: 'amount', align: 'right', hideable: false, className: 'font-semibold text-ink', cell: (t) => mxn(t.amount) },
  { id: 'balance', header: 'Saldo', sortKey: 'balance', align: 'right', className: 'text-muted', cell: (t) => (t.balance_after !== null ? mxn(t.balance_after) : '—') },
  { id: 'receipt', header: 'Recibo', defaultHidden: true, className: 'font-mono text-xs text-subtle', cell: (t) => t.loyverse_receipt_id || '—' },
];

function MovementsTab() {
  const queryClient = useQueryClient();
  const { get, set } = useUrlFilters();
  const [page, setPage] = useUrlPage();
  const [sort, onSort] = useUrlSort();
  const student = get('alumno');
  const filters = clean({
    q: get('q'), type: get('tipo'), student, from: get('desde'), to: get('hasta'), ordering: serializeSort(sort),
  });
  const { data, isLoading, isError, refetch } = useTransactionsList({ page, ...filters });
  const count = data?.count ?? 0;
  const selection = useRowSelection(count, JSON.stringify(filters));
  const exportTx = useTransactionsExport();
  const fetchExport = exporter((p) => exportTx.mutateAsync(p), filters, selection);

  // Refund stays single-row with type-to-confirm: it moves money back.
  const [refundTx, setRefundTx] = useState<AdminTransaction | null>(null);
  const [reason, setReason] = useState('');
  const refund = useMutation({
    mutationFn: () => cafeteriaApi.refundTransaction(refundTx!.id, reason),
    onSuccess: () => {
      toast.success('Devolución procesada.');
      setRefundTx(null);
      setReason('');
      void invalidateEntity(queryClient, CAF_MONEY_VIEWS[0], CAF_MONEY_VIEWS);
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo procesar la devolución.')),
  });

  return (
    <Card>
      <DataTable<AdminTransaction>
        tableId="cafeteria-transactions"
        columns={TX_COLUMNS}
        rows={data?.results}
        rowKey={(t) => t.id}
        rowLabel={(t) => `movimiento ${t.id} de ${t.student_name}`}
        caption="Movimientos de cafetería"
        sort={sort}
        onSort={onSort}
        page={page}
        count={count}
        onPage={setPage}
        itemLabel="movimientos"
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        columnControls
        resizable
        pinFirstColumn
        selection={selection}
        toolbar={(
          <FilterBar
            search={{ placeholder: 'Alumno, matrícula, descripción o recibo…', label: 'Buscar movimientos' }}
            tabs={{ paramKey: 'tipo', options: options(TX_TYPE), allLabel: 'Todos', label: 'Filtrar por tipo' }}
            dateRange={{ idPrefix: 'caf-mov' }}
            extraChips={student ? [{ key: 'alumno', label: `Alumno: #${student}`, onClear: () => set({ alumno: null, page: null }) }] : []}
          >
            <ExportMenu filenamePrefix="movimientos_cafeteria" selectedCount={selection.count} fetch={fetchExport} />
          </FilterBar>
        )}
        bulkBar={(
          <BulkActionBar
            count={selection.count}
            allMatching={selection.allMatching}
            allMatchingCount={count}
            onSelectAllMatching={selection.onSelectAllMatching}
            onClear={selection.onClear}
            itemLabel="movimientos"
            gender="m"
            exportMenu={<ExportMenu label="Exportar seleccionados" filenamePrefix="movimientos_cafeteria" selectedCount={selection.count} forceSelected fetch={fetchExport} />}
          />
        )}
        rowActions={(t) => (t.transaction_type === 'purchase' || t.transaction_type === 'topup') ? (
          <Button size="sm" variant="ghost" onClick={() => { setRefundTx(t); setReason(''); }} aria-label={`Devolver movimiento ${t.id} de ${t.student_name}`}>
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Devolver
          </Button>
        ) : null}
        empty={{ icon: ArrowLeftRight, title: 'Sin movimientos', description: 'No hay movimientos con esos filtros.' }}
      />
      <ConfirmDialog
        open={!!refundTx}
        title="Confirmar devolución"
        confirmLabel="Procesar devolución"
        requireText="DEVOLVER"
        loading={refund.isPending}
        onClose={() => setRefundTx(null)}
        onConfirm={() => refund.mutate()}
        message={refundTx && (
          <>
            Se revertirá la {(TX_TYPE[refundTx.transaction_type]?.label ?? '').toLowerCase()} de{' '}
            <span className="font-semibold text-ink">{mxn(refundTx.amount)}</span> de {refundTx.student_name} del{' '}
            {fmtDate(refundTx.date)}. Se ajustará el saldo y se notificará a los tutores. Esta acción no se puede deshacer.
          </>
        )}
      >
        <Input label="Motivo (opcional)" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
    </Card>
  );
}

// ── Depósitos ────────────────────────────────────────────────────────────────
const TOPUP_ACTIONS: BulkActionDef[] = [
  { name: 'apply', label: 'Aplicar', planVerb: 'Se aplicarán' },
  { name: 'pos_loaded', label: 'Cargadas en POS', planVerb: 'Se marcarán como cargadas en el POS' },
  { name: 'pos_unloaded', label: 'Quitadas del POS', planVerb: 'Se marcarán como quitadas del POS' },
];

const posBadge = (d: TopUpLogEntry) =>
  d.needs_pos_unload ? <Badge variant="error">Quitar del POS</Badge>
    : d.needs_pos_load ? <Badge variant="warning">Pendiente POS</Badge>
    : d.pos_loaded_at ? <Badge variant="success">En POS</Badge>
    : <span className="text-subtle">—</span>;

const studentCell = (d: TopUpLogEntry) => (
  <span className="block">
    <Link to={`/admin/cafeteria/${d.student_id}`} className="hover:text-brand-700">{d.student_name}</Link>
    <span className="block text-xs text-subtle">{d.student_code}</span>
  </span>
);

const TOPUP_COLUMNS: Column<TopUpLogEntry>[] = [
  { id: 'created_at', header: 'Fecha', sortKey: 'created_at', hideable: false, minWidth: 150, className: 'whitespace-nowrap text-muted', cell: (d) => fmtDate(d.created_at) },
  { id: 'student', header: 'Alumno', sortKey: 'student', minWidth: 170, className: 'font-medium text-ink', cell: studentCell },
  { id: 'amount', header: 'Monto', sortKey: 'amount', align: 'right', hideable: false, className: 'font-semibold text-ink', cell: (d) => mxn(d.amount) },
  { id: 'method', header: 'Método', sortKey: 'method', className: 'text-muted', cell: (d) => d.method_display },
  { id: 'gateway', header: 'Pasarela', className: 'text-muted', cell: (d) => d.gateway || '—' },
  { id: 'status', header: 'Estado', sortKey: 'status', cell: (d) => <Badge variant={TOPUP_STATUS[d.status]?.variant ?? 'neutral'}>{d.status_display}</Badge> },
  { id: 'pos', header: 'POS', cell: posBadge },
  { id: 'reference', header: 'Referencia', defaultHidden: true, className: 'text-subtle text-xs font-mono', cell: (d) => d.gateway_tx_id || '—' },
];

/** Plan line of a bulk apply: the MXN the processed rows will credit. */
const applyTotal = (plan: BulkResult) => {
  const total = (plan as TopUpBulkResult).total;
  return total ? <p className="text-xs">Total a acreditar: <strong className="text-ink">{mxn(total)}</strong>.</p> : null;
};

function DepositsTab() {
  const { get } = useUrlFilters();
  const [page, setPage] = useUrlPage();
  const [sort, onSort] = useUrlSort();
  const filters = clean({
    q: get('q'), status: get('estado'), method: get('metodo'), from: get('desde'), to: get('hasta'), ordering: serializeSort(sort),
  });
  const { data, isLoading, isError, refetch } = useTopUpsList({ page, ...filters });
  const count = data?.count ?? 0;
  const selection = useRowSelection(count, JSON.stringify(filters));
  const exportTopups = useTopUpsExport();
  const bulk = useTopUpsBulk();
  const [pending, setPending] = useState<{ action: BulkActionDef; ids: RowKey[] | null } | null>(null);
  const fetchExport = exporter((p) => exportTopups.mutateAsync(p), filters, selection);

  return (
    <Card>
      <DataTable<TopUpLogEntry>
        tableId="cafeteria-topups"
        columns={TOPUP_COLUMNS}
        rows={data?.results}
        rowKey={(d) => d.id}
        rowLabel={(d) => `depósito ${d.id} de ${d.student_name}`}
        caption="Depósitos de cafetería"
        sort={sort}
        onSort={onSort}
        page={page}
        count={count}
        onPage={setPage}
        itemLabel="depósitos"
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        columnControls
        resizable
        pinFirstColumn
        selection={selection}
        toolbar={(
          <FilterBar
            search={{ placeholder: 'Alumno, matrícula o referencia de pago…', label: 'Buscar depósitos' }}
            tabs={{ paramKey: 'estado', options: options(TOPUP_STATUS), allLabel: 'Todos', label: 'Filtrar por estado' }}
            selects={[{ key: 'metodo', label: 'Método', options: options(TOPUP_METHOD), allLabel: 'Todos los métodos' }]}
            dateRange={{ idPrefix: 'caf-dep' }}
          >
            <ExportMenu filenamePrefix="depositos_cafeteria" selectedCount={selection.count} fetch={fetchExport} />
          </FilterBar>
        )}
        bulkBar={(
          <BulkActionBar
            count={selection.count}
            allMatching={selection.allMatching}
            allMatchingCount={count}
            onSelectAllMatching={selection.onSelectAllMatching}
            onClear={selection.onClear}
            actions={TOPUP_ACTIONS}
            onAction={(a) => setPending({ action: a, ids: null })}
            itemLabel="depósitos"
            gender="m"
            exportMenu={<ExportMenu label="Exportar seleccionados" filenamePrefix="depositos_cafeteria" selectedCount={selection.count} forceSelected fetch={fetchExport} />}
          />
        )}
        rowActions={(d) => (d.method === 'office' && d.status === 'pending') ? (
          <Button size="sm" onClick={() => setPending({ action: TOPUP_ACTIONS[0], ids: [d.id] })} aria-label={`Aplicar depósito de ${d.student_name}`}>
            <Wallet className="w-3.5 h-3.5" aria-hidden="true" /> Aplicar
          </Button>
        ) : null}
        empty={{ icon: ScrollText, title: 'Sin depósitos registrados', description: 'No hay depósitos con esos filtros.' }}
      />
      <BulkConfirmDialog
        open={!!pending}
        onClose={() => setPending(null)}
        action={pending?.action ?? null}
        entityLabel="depósitos"
        gender="m"
        ids={pending?.ids ?? selection.ids}
        allMatching={!pending?.ids && selection.allMatching}
        filters={filters}
        execute={(body) => bulk.mutateAsync(body)}
        onDone={() => { if (!pending?.ids) selection.onClear(); }}
        renderPlan={pending?.action.name === 'apply' ? applyTotal : undefined}
      />
    </Card>
  );
}

// ── POS Loyverse: load + unload queues ───────────────────────────────────────
function PosLoadTab() {
  return (
    <div className="space-y-6">
      <PosQueue
        kind="load"
        title="Cargar en POS"
        intro="Recargas en línea ya acreditadas en el saldo local. Cargue el monto en el POS de Loyverse y márquelo aquí para que el alumno pueda gastar."
        emptyTitle="Sin pendientes de carga en POS"
        emptyText="Todas las recargas en línea ya fueron marcadas como cargadas."
      />
      <PosQueue
        kind="unload"
        title="Quitar del POS"
        intro="Recargas ya cargadas en Loyverse que fueron reembolsadas. Quite el monto del POS y márquelo aquí para evitar que el alumno siga gastando crédito devuelto."
        emptyTitle="Sin pendientes de quitar del POS"
        emptyText="No hay recargas reembolsadas esperando descarga en Loyverse."
      />
    </div>
  );
}

function PosQueue({ kind, title, intro, emptyTitle, emptyText }: { kind: 'load' | 'unload'; title: string; intro: string; emptyTitle: string; emptyText: string }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const filters = kind === 'load' ? { needs_pos: 1 } : { needs_unload: 1 };
  const { data, isLoading, isError, refetch } = useTopUpsList({ page, ...filters });
  const count = data?.count ?? 0;
  const selection = useRowSelection(count, kind);
  const bulk = useTopUpsBulk();
  const action = TOPUP_ACTIONS[kind === 'load' ? 1 : 2];
  const [confirming, setConfirming] = useState(false);

  const mark = useMutation({
    mutationFn: (id: number) => (kind === 'load' ? cafeteriaApi.markTopUpPosLoaded(id) : cafeteriaApi.markTopUpPosUnloaded(id)),
    onSuccess: () => {
      toast.success(kind === 'load' ? 'Marcado como cargado en Loyverse POS.' : 'Marcado como quitado del POS de Loyverse.');
      void invalidateEntity(queryClient, CAF_TOPUPS);
    },
    onError: () => toast.error('No se pudo marcar la recarga.'),
  });

  const columns: Column<TopUpLogEntry>[] = [
    {
      id: 'when', header: kind === 'load' ? 'Acreditada' : 'Reembolso', hideable: false, className: 'whitespace-nowrap text-muted',
      cell: (d) => fmtDate(kind === 'load' ? d.processed_at || d.created_at : d.pos_unload_needed_at),
    },
    { id: 'student', header: 'Alumno', className: 'font-medium text-ink', cell: studentCell },
    { id: 'amount', header: 'Monto', align: 'right', className: 'font-semibold text-ink', cell: (d) => mxn(d.amount) },
    { id: 'gateway', header: 'Pasarela', className: 'text-muted', cell: (d) => d.gateway || '—' },
    { id: 'reference', header: 'Referencia', className: 'text-subtle text-xs font-mono', cell: (d) => d.gateway_tx_id || '—' },
  ];

  return (
    <Card>
      <div className="mb-4 max-w-2xl">
        <h2 className="font-head text-base font-semibold text-ink">{title}</h2>
        <p className="mt-1 text-sm text-muted">{intro}</p>
      </div>
      <DataTable<TopUpLogEntry>
        tableId={`cafeteria-pos-${kind}`}
        columns={columns}
        rows={data?.results}
        rowKey={(d) => d.id}
        rowLabel={(d) => `recarga de ${d.student_name}`}
        caption={title}
        page={page}
        count={count}
        onPage={setPage}
        itemLabel="recargas"
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        selection={selection}
        bulkBar={(
          <BulkActionBar
            count={selection.count}
            allMatching={selection.allMatching}
            allMatchingCount={count}
            onSelectAllMatching={selection.onSelectAllMatching}
            onClear={selection.onClear}
            actions={[action]}
            onAction={() => setConfirming(true)}
            itemLabel="recargas"
          />
        )}
        rowActions={(d) => (
          <Button
            size="sm"
            variant={kind === 'load' ? 'primary' : 'secondary'}
            loading={mark.isPending && mark.variables === d.id}
            onClick={() => mark.mutate(d.id)}
          >
            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
            {kind === 'load' ? 'Cargado en Loyverse' : 'Quitado de Loyverse'}
          </Button>
        )}
        empty={{ icon: CheckCircle2, title: emptyTitle, description: emptyText }}
      />
      <BulkConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        action={confirming ? action : null}
        entityLabel="recargas"
        ids={selection.ids}
        allMatching={selection.allMatching}
        filters={filters}
        execute={(body) => bulk.mutateAsync(body)}
        onDone={() => selection.onClear()}
      />
    </Card>
  );
}

// ── Reconciliación ───────────────────────────────────────────────────────────
const RECONCILE_ACTIONS: BulkActionDef[] = [
  { name: 'fix', label: 'Corregir', planVerb: 'Se ajustará al saldo de Loyverse el monedero de' },
];

function ReconcileTab() {
  const queryClient = useQueryClient();
  const { get, set } = useUrlFilters();
  const [page, setPage] = useUrlPage();
  const [sort, onSort] = useUrlSort();
  const onlyDrift = get('solo', 'diferencias') === 'diferencias';
  const [started, setStarted] = useState(false);
  const filters = clean({
    q: get('q'), grade: get('grado'), group: get('grupo'), ordering: serializeSort(sort), only: onlyDrift ? 'drift' : undefined,
  });
  const { data, isFetching, isError, refetch } = useReconcileList({ page, ...filters }, started);
  const total = data?.total ?? 0;
  const selection = useRowSelection(total, JSON.stringify(filters));
  const exportReconcile = useReconcileExport();
  const bulk = useReconcileBulk();
  const [pending, setPending] = useState<BulkActionDef | null>(null);
  const fetchExport = exporter((p) => exportReconcile.mutateAsync(p), filters, selection);

  // Seeing a $25 gap and re-typing the arithmetic into the manual adjustment
  // form is how a reconciliation becomes a second discrepancy.
  const [toFix, setToFix] = useState<ReconcileRowV2 | null>(null);
  const fix = useMutation({
    mutationFn: (studentId: number) => cafeteriaApi.reconcileFix(studentId),
    onSuccess: ({ data: res }) => {
      toast.success(res.adjusted ? `Saldo reconciliado: ${mxn(res.balance)}.` : 'Ya estaban sincronizados.');
      setToFix(null);
      void invalidateEntity(queryClient, CAF_MONEY_VIEWS[0], CAF_MONEY_VIEWS);
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo reconciliar.')),
  });

  const columns: Column<ReconcileRowV2>[] = [
    {
      id: 'student', header: 'Alumno', sortKey: 'student', hideable: false, minWidth: 170, className: 'font-medium text-ink',
      cell: (r) => <Link to={`/admin/cafeteria/${r.student_id}`} className="hover:text-brand-700">{r.student_name}</Link>,
    },
    { id: 'matricula', header: 'Matrícula', sortKey: 'matricula', className: 'text-muted', cell: (r) => r.student_code },
    { id: 'local', header: 'Saldo local', sortKey: 'local_balance', align: 'right', className: 'text-ink', cell: (r) => mxn(r.local_balance) },
    { id: 'loyverse', header: 'Loyverse', align: 'right', className: 'text-muted', cell: (r) => (r.loyverse_balance !== null ? mxn(r.loyverse_balance) : '—') },
    { id: 'drift', header: 'Diferencia', align: 'right', className: 'font-medium text-ink', cell: (r) => (r.drift !== null ? mxn(r.drift) : '—') },
    {
      id: 'state', header: 'Estado',
      cell: (r) => r.error ? <Badge variant="error">Error</Badge>
        : r.in_sync ? <Badge variant="success">En orden</Badge>
        : <Badge variant="warning">Diferencia</Badge>,
    },
  ];

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Compara el saldo local contra los puntos de Loyverse, página por página (una consulta a Loyverse por alumno).
        </p>
        <div className="flex items-center gap-3">
          <label className="inline-flex min-h-[44px] items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-line text-purple focus:ring-purple/40"
              checked={onlyDrift}
              onChange={(e) => set({ solo: e.target.checked ? null : 'todos', page: null })}
            />
            Solo diferencias
          </label>
          <Button size="sm" loading={isFetching} onClick={() => (started ? refetch() : setStarted(true))}>
            <Scale className="w-3.5 h-3.5" aria-hidden="true" /> Reconciliar
          </Button>
        </div>
      </div>

      {!started ? (
        <EmptyState icon={Scale} title="Ejecuta la reconciliación" description="Presiona «Reconciliar» para comparar con Loyverse." />
      ) : (
        <>
          {data && (
            <p className="mb-3 text-sm text-muted" role="status">
              {data.drift_count > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-amber">
                  <AlertTriangle className="w-4 h-4" aria-hidden="true" /> {data.drift_count} diferencia(s) en esta página ({data.checked} revisadas de {data.total}).
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-green-700">
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Todo en orden en esta página ({data.checked} revisadas de {data.total}).
                </span>
              )}
            </p>
          )}
          <DataTable<ReconcileRowV2>
            tableId="cafeteria-reconcile"
            columns={columns}
            rows={data?.results}
            rowKey={(r) => r.student_id}
            rowLabel={(r) => r.student_name}
            caption="Reconciliación con Loyverse"
            sort={sort}
            onSort={onSort}
            page={page}
            count={total}
            onPage={setPage}
            itemLabel="alumnos"
            isLoading={!data && isFetching}
            isError={isError}
            onRetry={() => refetch()}
            columnControls
            selection={{ selected: selection.selected, onChange: selection.onChange }}
            toolbar={(
              <FilterBar
                search={{ placeholder: 'Alumno, matrícula o código Loyverse…', label: 'Buscar en la reconciliación' }}
                selects={[{ key: 'grado', label: 'Grado', options: GRADE_OPTIONS, allLabel: 'Todos los grados' }]}
              >
                <ExportMenu filenamePrefix="reconciliacion_cafeteria" selectedCount={selection.count} fetch={fetchExport} />
              </FilterBar>
            )}
            bulkBar={(
              <BulkActionBar
                count={selection.count}
                onClear={selection.onClear}
                actions={RECONCILE_ACTIONS}
                onAction={(a) => setPending(a)}
                itemLabel="alumnos"
                gender="m"
              />
            )}
            rowActions={(r) => (!r.error && !r.in_sync ? (
              <Button size="sm" variant="secondary" onClick={() => setToFix(r)} aria-label={`Corregir saldo de ${r.student_name}`}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Corregir
              </Button>
            ) : null)}
            empty={{ icon: CheckCircle2, title: 'Sin diferencias', description: 'Ningún alumno de esta página tiene diferencias.' }}
          />
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
          ? `Se ajustará el saldo de ${toFix.student_name} de ${mxn(toFix.local_balance)} `
            + `a ${mxn(toFix.loyverse_balance ?? '0')} (el valor de Loyverse). `
            + 'Queda registrado en Auditoría y no se notifica a la familia.'
          : ''}
      />
      <BulkConfirmDialog
        open={!!pending}
        onClose={() => setPending(null)}
        action={pending}
        entityLabel="alumnos"
        gender="m"
        ids={selection.ids}
        execute={(body) => bulk.mutateAsync(body)}
        onDone={() => selection.onClear()}
      />
    </Card>
  );
}

// ── Saldo bajo ───────────────────────────────────────────────────────────────
function LowBalanceTab() {
  const { get } = useUrlFilters();
  const [page, setPage] = useUrlPage();
  const [sort, onSort] = useUrlSort();
  const filters = clean({ q: get('q'), grade: get('grado'), group: get('grupo'), ordering: serializeSort(sort) });
  const { data, isLoading, isError, refetch } = useLowBalanceList({ page, ...filters });
  const count = data?.count ?? 0;
  const selection = useRowSelection(count, JSON.stringify(filters));
  const exportLow = useLowBalanceExport();
  const fetchExport = exporter((p) => exportLow.mutateAsync(p), filters, selection);

  return (
    <Card>
      {count > 0 && <p className="mb-3 text-sm text-muted">{count} alumno(s) por debajo del umbral.</p>}
      <DataTable<CafeteriaBalance>
        tableId="cafeteria-low-balance"
        columns={balanceColumns('Saldo').map((c) => (c.id === 'threshold' ? { ...c, defaultHidden: false } : c.id === 'balance' ? { ...c, className: 'font-semibold text-amber' } : c))}
        rows={data?.results}
        rowKey={(b) => b.id}
        rowLabel={(b) => b.student.user.full_name}
        caption="Alumnos con saldo bajo"
        sort={sort}
        onSort={onSort}
        page={page}
        count={count}
        onPage={setPage}
        itemLabel="alumnos"
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        columnControls
        pinFirstColumn
        selection={selection}
        toolbar={(
          <FilterBar
            search={{ placeholder: 'Alumno, matrícula o correo del tutor…', label: 'Buscar alumnos con saldo bajo' }}
            selects={[{ key: 'grado', label: 'Grado', options: GRADE_OPTIONS, allLabel: 'Todos los grados' }]}
          >
            <ExportMenu filenamePrefix="saldo_bajo_cafeteria" selectedCount={selection.count} fetch={fetchExport} />
          </FilterBar>
        )}
        bulkBar={(
          <BulkActionBar
            count={selection.count}
            allMatching={selection.allMatching}
            allMatchingCount={count}
            onSelectAllMatching={selection.onSelectAllMatching}
            onClear={selection.onClear}
            itemLabel="alumnos"
            gender="m"
            exportMenu={<ExportMenu label="Exportar seleccionados" filenamePrefix="saldo_bajo_cafeteria" selectedCount={selection.count} forceSelected fetch={fetchExport} />}
          />
        )}
        empty={{ icon: CheckCircle2, title: 'Ningún alumno con saldo bajo' }}
      />
    </Card>
  );
}

// ── Clientes Loyverse (pupils, staff cards, tests) ───────────────────────────
const CUSTOMER_PAGE_SIZE = 50;

const CUSTOMER_TABS = [{ value: 'nonstudent', label: 'Sin alumno' }, ...options(CUSTOMER_KIND)];

/**
 * The whole Loyverse store, one row per card. Until 2026-09-23 only the cards
 * linked to a pupil existed in the app; every card now has a row, refreshed on
 * each sync pass, including cards Loyverse has since deleted.
 */
function CustomersTab() {
  const { get } = useUrlFilters();
  const [page, setPage] = useUrlPage();
  const [sort, onSort] = useUrlSort();
  const filters = clean({ q: get('q'), kind: get('tipo'), ordering: serializeSort(sort) });
  const [receiptsFor, setReceiptsFor] = useState<LoyverseCustomer | null>(null);
  const { data, isLoading, isError, refetch } = useCustomersList({ page, page_size: CUSTOMER_PAGE_SIZE, ...filters }, LIVE);
  const count = data?.count ?? 0;
  const summary = data?.summary;
  const totalCards = summary ? summary.student + summary.staff + summary.test + summary.other : 0;
  const exportCustomers = useCustomersExport();
  // Cards are keyed by loyverse_id, not by the pk `?ids=` expects, so this
  // list has no selection: "Exportar" sends the current view (filters, q, sort).
  const fetchExport = (fmt: ExportFormat) => exportCustomers.mutateAsync({ ...filters, fmt });

  const columns: Column<LoyverseCustomer>[] = [
    {
      id: 'name', header: 'Nombre', sortKey: 'name', hideable: false, minWidth: 180, className: 'font-medium text-ink',
      cell: (c) => c.student
        ? <Link to={`/admin/cafeteria/${c.student.id}`} className="hover:text-brand-700">{c.name || c.student.name}</Link>
        : (c.name || '—'),
    },
    { id: 'code', header: 'Código', sortKey: 'code', className: 'font-mono text-xs text-muted', cell: (c) => c.customer_code || '—' },
    { id: 'kind', header: 'Tipo', sortKey: 'kind', cell: (c) => <Badge variant={CUSTOMER_KIND[c.kind].variant}>{CUSTOMER_KIND[c.kind].label}</Badge> },
    { id: 'email', header: 'Correo', className: 'text-muted', cell: (c) => c.email || '—' },
    { id: 'points', header: 'Saldo', sortKey: 'points', align: 'right', className: 'font-semibold text-ink', cell: (c) => mxn(c.total_points) },
    { id: 'visits', header: 'Visitas', sortKey: 'visits', align: 'right', className: 'text-muted', cell: (c) => c.total_visits },
    { id: 'last_visit', header: 'Última visita', sortKey: 'last_visit', className: 'whitespace-nowrap text-muted', cell: (c) => fmtDate(c.last_visit) },
    {
      id: 'state', header: 'Estado',
      cell: (c) => c.missing_since ? <Badge variant="error">Eliminado en Loyverse</Badge> : <Badge variant="success">Activo</Badge>,
    },
    {
      id: 'receipts', header: 'Compras', align: 'right',
      cell: (c) => c.student
        ? <Link to={`/admin/cafeteria/${c.student.id}`} className="text-xs font-semibold text-brand-700 hover:underline">Ver alumno</Link>
        : (
          <Button size="sm" variant="ghost" onClick={() => setReceiptsFor(c)} aria-label={`Ver compras de ${c.name}`}>
            <Receipt className="h-3.5 w-3.5" aria-hidden="true" /> {c.receipts}
          </Button>
        ),
    },
  ];

  return (
    <Card>
      {summary && (
        <p className="mb-3 text-sm text-muted">
          {totalCards} tarjeta(s) en Loyverse: {summary.student} alumno(s), {summary.staff} de personal,
          {' '}{summary.test} de prueba, {summary.other} otra(s)
          {summary.missing > 0 ? `; ${summary.missing} ya no existe(n) en Loyverse.` : '.'}
        </p>
      )}
      <DataTable<LoyverseCustomer>
        tableId="cafeteria-customers"
        columns={columns}
        rows={data?.results}
        rowKey={(c) => c.loyverse_id}
        rowLabel={(c) => c.name || c.customer_code}
        caption="Clientes de Loyverse"
        sort={sort}
        onSort={onSort}
        page={page}
        pageSize={CUSTOMER_PAGE_SIZE}
        count={count}
        onPage={setPage}
        itemLabel="clientes"
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        columnControls
        pinFirstColumn
        toolbar={(
          <FilterBar
            search={{ placeholder: 'Buscar por nombre, código o correo…', label: 'Buscar cliente de Loyverse' }}
            tabs={{ paramKey: 'tipo', options: CUSTOMER_TABS, allLabel: 'Todos', label: 'Filtrar por tipo' }}
          >
            <ExportMenu filenamePrefix="clientes_loyverse" fetch={fetchExport} />
          </FilterBar>
        )}
        empty={{ icon: Users, title: 'Sin clientes que coincidan', description: 'Las tarjetas se llenan en la siguiente pasada de sincronización (cada 5 minutos).' }}
      />
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
            { id: 'date', header: 'Fecha', className: 'whitespace-nowrap text-muted', cell: (r) => fmtDate(r.receipt_date) },
            { id: 'receipt', header: 'Recibo', className: 'font-mono text-xs text-subtle', cell: (r) => r.receipt_number },
            { id: 'items', header: 'Artículos', className: 'text-muted', cell: (r) => r.items || '—' },
            { id: 'amount', header: 'Monto', align: 'right', className: 'font-medium text-ink', cell: (r) => `${r.receipt_type === 'REFUND' ? '+' : '−'}${mxn(r.points)}` },
          ]}
        />
      )}
    </Modal>
  );
}
