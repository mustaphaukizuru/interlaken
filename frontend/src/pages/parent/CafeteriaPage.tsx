import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import {
  Coffee, Plus, ArrowDownCircle, ArrowUpCircle, RotateCcw, RefreshCw,
  Search, X, Download,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Modal } from '@/components/ui/Modal';
import { PaymentMethodPicker } from '@/components/ui/PaymentMethodPicker';
import { Pagination } from '@/components/ui/Pagination';
import { cafeteriaApi, downloadBlob } from '@/services/api';
import type { CafeteriaBalance, CafeteriaTransaction } from '@/types';

const TX_PAGE_SIZE = 20;  // matches DRF PAGE_SIZE on MyTransactionsView
const TOPUP_MIN = 50;
const TOPUP_MAX = 2000;

const txIcon = (type: string) => {
  if (type === 'topup')   return <ArrowUpCircle className="w-4 h-4 text-green-600" />;
  if (type === 'refund')  return <RotateCcw className="w-4 h-4 text-purple" />;
  return <ArrowDownCircle className="w-4 h-4 text-subtle" />;
};

const txLabel = (type: string) => {
  if (type === 'topup')  return 'Recarga';
  if (type === 'refund') return 'Devolución';
  return 'Compra';
};

type TypeFilter = '' | 'purchase' | 'topup' | 'refund';

function topupErrorMessage(err: unknown): string {
  const data = (err as { response?: { data?: Record<string, unknown> } })?.response?.data;
  if (!data) return 'No fue posible procesar la recarga. Intente nuevamente.';
  if (typeof data.error === 'string') return data.error;
  const amount = data.amount;
  if (Array.isArray(amount) && typeof amount[0] === 'string') return amount[0];
  if (typeof amount === 'string') return amount;
  return 'No fue posible procesar la recarga. Revise el monto e intente nuevamente.';
}

export default function CafeteriaPage() {
  const queryClient = useQueryClient();
  const [topupAmount, setTopupAmount] = useState('');
  const [topupMethod, setTopupMethod] = useState<'online' | 'office'>('online');
  const [topupGateway, setTopupGateway] = useState<'global_payments' | 'banorte'>('global_payments');
  const [selectedStudent, setSelectedStudent] = useState<number | null>(null);
  const [showTopup, setShowTopup] = useState(false);
  const [thresholdStudent, setThresholdStudent] = useState<CafeteriaBalance | null>(null);
  const [thresholdValue, setThresholdValue] = useState('');

  // History filters + pagination
  const [filterStudent, setFilterStudent] = useState<number | 'all'>('all');
  const [filterType, setFilterType] = useState<TypeFilter>('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [page, setPage] = useState(1);

  // Any filter change resets to the first page (stale page would show empty).
  useEffect(() => { setPage(1); }, [filterStudent, filterType, filterFrom, filterTo]);

  const { data: balances, isLoading: balancesLoading, isError: balancesError, refetch: refetchBalances } = useQuery<CafeteriaBalance[]>({
    queryKey: ['cafeteria-balances'],
    queryFn: async () => {
      const { data } = await cafeteriaApi.getMyBalance();
      return Array.isArray(data) ? data : [data];
    },
  });

  const { data: txData, isLoading: txLoading, isError: txError, refetch: refetchTx } = useQuery<{
    results: CafeteriaTransaction[]; count: number;
  }>({
    queryKey: ['cafeteria-transactions', filterStudent, filterType, filterFrom, filterTo, page],
    queryFn: async () => {
      const { data } = await cafeteriaApi.getTransactions({
        student: filterStudent === 'all' ? undefined : filterStudent,
        type: filterType || undefined,
        from: filterFrom || undefined,
        to: filterTo || undefined,
        page,
      });
      const results = data.results ?? data;
      return { results, count: data.count ?? results.length };
    },
    placeholderData: keepPreviousData,
  });
  const transactions = txData?.results;
  const txCount = txData?.count ?? 0;

  const topupAmountNum = parseFloat(topupAmount);
  const topupAmountValid =
    Number.isFinite(topupAmountNum)
    && topupAmountNum >= TOPUP_MIN
    && topupAmountNum <= TOPUP_MAX;

  const topupMutation = useMutation({
    mutationFn: () =>
      cafeteriaApi.requestTopUp(
        selectedStudent!,
        topupAmountNum,
        topupMethod,
        topupMethod === 'online' ? topupGateway : undefined,
      ),
    onSuccess: ({ data }) => {
      // Online payments hand off to the gateway's hosted page; the balance is
      // credited later by the confirmed webhook (see the return page).
      if (topupMethod === 'online' && data?.redirect_url) {
        toast.success('Listo. Te redirigimos a Global Payments / Banorte para completar el pago…');
        window.location.href = data.redirect_url;
        return;
      }
      toast.success(
        'Solicitud de recarga enviada. Paga en caja escolar y el colegio aplicará el saldo.',
      );
      setShowTopup(false);
      setTopupAmount('');
      queryClient.invalidateQueries({ queryKey: ['cafeteria-balances'] });
    },
    onError: (err) => toast.error(topupErrorMessage(err)),
  });

  // Family-set low-balance alert threshold (#12).
  const thresholdMutation = useMutation({
    mutationFn: () =>
      cafeteriaApi.updateLowBalanceThreshold(
        thresholdStudent!.student.id, parseFloat(thresholdValue)),
    onSuccess: () => {
      toast.success('Alerta de saldo bajo actualizada.');
      setThresholdStudent(null);
      queryClient.invalidateQueries({ queryKey: ['cafeteria-balances'] });
    },
    onError: () => toast.error('No se pudo actualizar la alerta. Intente nuevamente.'),
  });

  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const { data } = await cafeteriaApi.refreshFromLoyverse();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['cafeteria-balances'] }),
        queryClient.invalidateQueries({ queryKey: ['cafeteria-transactions'] }),
      ]);
      const created = data?.created ?? 0;
      toast.success(
        created > 0
          ? `Actualizado — ${created} compra(s) nueva(s) desde Loyverse.`
          : 'Saldos y movimientos actualizados desde Loyverse.',
      );
    } catch {
      toast.error('No se pudo sincronizar con Loyverse. Intente de nuevo.');
    } finally {
      setRefreshing(false);
    }
  };

  const exportMovements = async () => {
    setExporting(true);
    try {
      const { data } = await cafeteriaApi.exportMyTransactions();
      const stamp = format(new Date(), 'yyyyMMdd');
      downloadBlob(data, `movimientos_cafeteria_${stamp}.csv`);
      toast.success('Descarga de movimientos lista.');
    } catch {
      toast.error('No se pudo descargar los movimientos. Intente nuevamente.');
    } finally {
      setExporting(false);
    }
  };

  // History filters: track whether any is active so we can give feedback and a
  // one-tap reset (the list auto-applies filters, so without this a filter that
  // matches nothing looks like a dead end).
  const filtersActive =
    filterType !== '' || filterFrom !== '' || filterTo !== '' || filterStudent !== 'all';
  const clearFilters = () => {
    setFilterType('');
    setFilterFrom('');
    setFilterTo('');
    setFilterStudent('all');
  };

  if (balancesLoading) return <LoadingSpinner size="lg" className="mt-20" />;

  if (balancesError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-head text-fluid-xl font-bold leading-tight tracking-[-0.3px] text-ink">Cafetería</h1>
          <p className="mt-1 text-fluid-sm text-muted">Consulte el saldo y los movimientos del servicio de cafetería.</p>
        </div>
        <Card><ErrorState onRetry={() => refetchBalances()} /></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-head text-fluid-xl font-bold leading-tight tracking-[-0.3px] text-ink">Cafetería</h1>
          <p className="mt-1 text-fluid-sm text-muted">Consulte el saldo y los movimientos del servicio de cafetería.</p>
        </div>
        <div className="flex flex-wrap gap-2 self-start">
          {balances && balances.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              loading={exporting}
              onClick={exportMovements}
              className="min-h-[44px] focus-visible:ring-2 focus-visible:ring-purple/40"
            >
              <Download className="w-3 h-3" /> Descargar movimientos
            </Button>
          )}
          <Button variant="secondary" size="sm" loading={refreshing} onClick={refresh} className="min-h-[44px] focus-visible:ring-2 focus-visible:ring-purple/40">
            <RefreshCw className="w-3 h-3" /> Actualizar
          </Button>
        </div>
      </div>

      {/* Balance cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {balances?.map((b) => {
          // Prefer API flag (balance <= threshold); fall back to same inequality.
          const isLow = typeof b.is_low_balance === 'boolean'
            ? b.is_low_balance
            : parseFloat(b.balance) <= parseFloat(b.low_balance_threshold ?? '50');
          const notLinked = !b.student.loyverse_id;
          const bal = parseFloat(b.balance);
          return (
            <Card key={b.id} className="flex flex-col">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-green-50 text-green-700">
                  <Coffee className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{b.student.user.full_name}</p>
                  <p className="truncate text-xs text-muted">{b.student.grade} · Grupo {b.student.group}</p>
                </div>
                {isLow && <Badge variant="warning">Saldo bajo</Badge>}
              </div>

              <div className="mt-4 flex items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Saldo</p>
                  <p className={`font-head text-2xl font-bold ${isLow ? 'text-amber' : 'text-ink'}`}>
                    ${bal.toFixed(2)}
                  </p>
                </div>
                <p className="pb-1 text-right text-[11px] leading-tight text-subtle">
                  Actualizado<br />{b.last_synced ? format(new Date(b.last_synced), 'd MMM HH:mm', { locale: es }) : 'N/A'}
                </p>
              </div>

              {notLinked && (
                <p className="mt-3 rounded-lg border border-amber/30 bg-amber/5 px-3 py-2 text-xs leading-snug text-muted">
                  Este alumno aún no está vinculado a cafetería/Loyverse. Contacta al colegio para activar el servicio.
                </p>
              )}

              <Button
                variant="secondary"
                size="sm"
                onClick={() => { setSelectedStudent(b.student.id); setShowTopup(true); }}
                className="mt-4 min-h-[44px] w-full focus-visible:ring-2 focus-visible:ring-purple/40"
              >
                <Plus className="w-3.5 h-3.5" /> Recargar
              </Button>

              <button
                type="button"
                onClick={() => {
                  setThresholdStudent(b);
                  setThresholdValue(parseFloat(b.low_balance_threshold ?? '50').toFixed(0));
                }}
                className="mt-2 self-start rounded text-left text-[11.5px] font-medium text-subtle transition hover:text-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/30"
              >
                Alerta de saldo bajo: <span className="font-semibold">${parseFloat(b.low_balance_threshold ?? '50').toFixed(0)}</span> · Cambiar
              </button>
            </Card>
          );
        })}
      </div>

      {/* No cafeteria accounts — school must link children to Loyverse. */}
      {balances && balances.length === 0 && (
        <Card>
          <EmptyState
            icon={Coffee}
            title="Sin servicio de cafetería"
            description="El colegio debe vincular a tu hijo(a) con el servicio de cafetería (Loyverse) para ver saldo y movimientos aquí. Contacta a la administración escolar si crees que ya debería estar activo."
          />
        </Card>
      )}

      {/* Top-up modal */}
      <Modal open={showTopup} onClose={() => { setShowTopup(false); setTopupAmount(''); }} title="Solicitar recarga">
        <div>
          <label className="label" htmlFor="topup-amount">Monto (MXN)</label>
          <input
            id="topup-amount"
            type="number"
            inputMode="decimal"
            min={TOPUP_MIN}
            max={TOPUP_MAX}
            className="input-field min-h-[44px] text-base"
            placeholder="Ej. 200"
            value={topupAmount}
            onChange={(e) => setTopupAmount(e.target.value)}
          />
          <p className="mt-1 text-xs text-subtle">Mínimo ${TOPUP_MIN} · Máximo ${TOPUP_MAX.toLocaleString('es-MX')}</p>
          {topupAmount !== '' && Number.isFinite(topupAmountNum) && topupAmountNum > TOPUP_MAX && (
            <p className="mt-1 text-xs text-coral">El monto máximo por recarga es ${TOPUP_MAX.toLocaleString('es-MX')}.</p>
          )}
          {topupAmount !== '' && Number.isFinite(topupAmountNum) && topupAmountNum > 0 && topupAmountNum < TOPUP_MIN && (
            <p className="mt-1 text-xs text-coral">El monto mínimo por recarga es ${TOPUP_MIN}.</p>
          )}
          <div className="mt-2.5 flex flex-wrap gap-2">
            {[100, 200, 300, 500].map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => setTopupAmount(String(amt))}
                className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${
                  topupAmount === String(amt)
                    ? 'border-purple bg-purple text-white'
                    : 'border-line bg-white text-muted hover:border-purple/40 hover:text-purple'
                }`}
              >
                ${amt}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="topup-method">Método de pago</label>
          <select
            id="topup-method"
            className="input-field min-h-[44px] text-base"
            value={topupMethod}
            onChange={(e) => setTopupMethod(e.target.value as 'online' | 'office')}
          >
            <option value="online">Pago en línea (Global Payments / Banorte)</option>
            <option value="office">Pago en caja escolar</option>
          </select>
        </div>
        {topupMethod === 'online' && (
          <PaymentMethodPicker
            value={topupGateway}
            onChange={(v) => setTopupGateway(v as 'global_payments' | 'banorte')}
            disabled={topupMutation.isPending}
          />
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="secondary" onClick={() => { setShowTopup(false); setTopupAmount(''); }} className="min-h-[44px] flex-1 focus-visible:ring-2 focus-visible:ring-purple/40">Cancelar</Button>
          <Button
            variant="primary"
            loading={topupMutation.isPending}
            onClick={() => topupMutation.mutate()}
            disabled={!topupAmountValid}
            className="min-h-[44px] flex-1 focus-visible:ring-2 focus-visible:ring-purple/40"
          >
            {topupMethod === 'online' ? 'Continuar al pago' : 'Solicitar recarga'}
          </Button>
        </div>
      </Modal>

      {/* Low-balance alert threshold modal (#12) */}
      <Modal open={!!thresholdStudent} onClose={() => setThresholdStudent(null)} title="Alerta de saldo bajo">
        {thresholdStudent && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Te avisaremos cuando el saldo de{' '}
              <span className="font-semibold text-ink">{thresholdStudent.student.user.full_name}</span>{' '}
              baje de este monto.
            </p>
            <div>
              <label className="label" htmlFor="threshold-amount">Monto de alerta (MXN)</label>
              <input
                id="threshold-amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="10"
                className="input-field min-h-[44px] text-base"
                placeholder="Ej. 50"
                value={thresholdValue}
                onChange={(e) => setThresholdValue(e.target.value)}
              />
              <p className="mt-1 text-xs text-subtle">Predeterminado: $50</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="secondary" onClick={() => setThresholdStudent(null)} className="min-h-[44px] flex-1 focus-visible:ring-2 focus-visible:ring-purple/40">Cancelar</Button>
              <Button
                variant="primary"
                loading={thresholdMutation.isPending}
                onClick={() => thresholdMutation.mutate()}
                disabled={thresholdValue === '' || parseFloat(thresholdValue) < 0}
                className="min-h-[44px] flex-1 focus-visible:ring-2 focus-visible:ring-purple/40"
              >
                Guardar
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Transactions — only when the family actually has cafeteria accounts */}
      {balances && balances.length > 0 && (
      <Card title="Historial de movimientos">
        {/* Filters */}
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap">
          {(balances?.length ?? 0) > 1 && (
            <select
              className="input-field min-h-[44px] text-sm lg:w-auto"
              value={filterStudent}
              onChange={(e) => setFilterStudent(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              aria-label="Filtrar por alumno"
            >
              <option value="all">Todos los alumnos</option>
              {balances?.map((b) => (
                <option key={b.student.id} value={b.student.id}>{b.student.user.full_name}</option>
              ))}
            </select>
          )}
          <select
            className="input-field min-h-[44px] text-sm lg:w-auto"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as TypeFilter)}
            aria-label="Filtrar por tipo"
          >
            <option value="">Todos los tipos</option>
            <option value="purchase">Compras</option>
            <option value="topup">Recargas</option>
            <option value="refund">Devoluciones</option>
          </select>
          <input
            type="date"
            className="input-field min-h-[44px] text-sm lg:w-auto"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            aria-label="Desde"
          />
          <input
            type="date"
            className="input-field min-h-[44px] text-sm lg:w-auto"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            aria-label="Hasta"
          />
          {filtersActive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="min-h-[44px] text-muted lg:w-auto"
            >
              <X className="h-3.5 w-3.5" /> Limpiar filtros
            </Button>
          )}
        </div>

        {txError ? (
          <ErrorState onRetry={() => refetchTx()} />
        ) : txLoading ? (
          <ListSkeleton />
        ) : !transactions?.length ? (
          filtersActive ? (
            <EmptyState
              icon={Search}
              title="Sin resultados"
              description="Ningún movimiento coincide con los filtros seleccionados. Ajusta o limpia los filtros para ver más."
              action={<Button variant="secondary" size="sm" onClick={clearFilters}>Limpiar filtros</Button>}
            />
          ) : (
            <EmptyState icon={Coffee} title="Sin movimientos" description="Los movimientos de cafetería aparecerán aquí." />
          )
        ) : (
          <>
            <p className="mb-3 text-xs text-subtle">
              {txCount} movimiento{txCount === 1 ? '' : 's'}
              {filtersActive ? ' · filtros aplicados' : ''}
            </p>
            <div className="divide-y divide-cream">
            {transactions.map((tx) => (
              <div key={tx.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex-shrink-0">{txIcon(tx.transaction_type)}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{txLabel(tx.transaction_type)}</p>
                    <p className="text-xs text-subtle">
                      {format(new Date(tx.date), 'd MMM yyyy · HH:mm', { locale: es })}
                    </p>
                    {tx.items?.length > 0 ? (
                      <ul className="mt-1 space-y-0.5 text-xs text-muted">
                        {tx.items.map((it, i) => (
                          <li key={i}>{it.quantity}× {it.name}</li>
                        ))}
                      </ul>
                    ) : tx.description ? (
                      <p className="mt-1 text-xs text-muted">{tx.description}</p>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-baseline justify-between gap-2 pl-7 sm:block sm:pl-0 sm:text-right">
                  <span className={`text-sm font-semibold ${
                    tx.transaction_type === 'purchase' ? 'text-ink' : 'text-green-700'
                  }`}>
                    {tx.transaction_type === 'purchase' ? '-' : '+'}${parseFloat(tx.amount).toFixed(2)}
                  </span>
                  {tx.balance_after != null && (
                    <p className="text-xs text-subtle sm:mt-0.5">Saldo ${parseFloat(tx.balance_after).toFixed(2)}</p>
                  )}
                </div>
              </div>
            ))}
            </div>
            <Pagination page={page} pageSize={TX_PAGE_SIZE} count={txCount}
                        onChange={setPage} itemLabel="movimientos" />
          </>
        )}
      </Card>
      )}
    </div>
  );
}
