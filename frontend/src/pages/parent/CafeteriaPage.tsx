import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Coffee, CreditCard, Plus, ArrowDownCircle, ArrowUpCircle, RotateCcw,
  Search, X, Download, Wallet,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Modal } from '@/components/ui/Modal';
import { BanortePaymentNotice } from '@/components/ui/BanortePaymentNotice';
import { Pagination } from '@/components/ui/Pagination';
import { ChildSwitcher } from '@/components/portal/ChildSwitcher';
import CafeteriaCategoriesCard from '@/components/portal/CafeteriaCategoriesCard';
import { PendingTopUps } from '@/components/portal/PendingTopUps';
import { useSelectedChildStore } from '@/store/selectedChildStore';
import { useAuthStore } from '@/store/authStore';
import { cafeteriaApi, downloadBlob, paymentsApi } from '@/services/api';
import type { CafeteriaBalance, CafeteriaTransaction, CheckoutStart } from '@/types';
import { closeBanorteLightbox, openBanorteLightbox, type BanorteEvent } from '@/lib/banorteCheckout';
import { DateRangeFilter } from '@/components/ui/DateRangeFilter';
import { parseSort, serializeSort, type SortState } from '@/components/ui/SortableTh';
import { SortChips, type SortOption } from '@/components/portal/SortChips';
import { PortalExportButtons } from '@/components/portal/PortalExportButtons';
import { useUrlFilters, useUrlPage } from '@/hooks/useUrlFilters';
import { LIVE } from '@/lib/live';
import { LiveBadge } from '@/components/ui/LiveBadge';
import { fieldErrorsOrNull } from '@/lib/apiErrors';
import { applyNotice, applyPhrase, DEFAULT_WHATSAPP, isScheduled, sentence } from '@/lib/topupApply';

const TX_PAGE_SIZE = 20;  // matches DRF PAGE_SIZE on MyTransactionsView
const TX_TYPES = ['purchase', 'topup', 'refund'] as const;
/** The four keys `TRANSACTION_ORDERING` whitelists (apps/cafeteria/views.py). */
const TX_SORT_OPTIONS: SortOption[] = [
  { key: 'date', label: 'Fecha' },
  { key: 'amount', label: 'Monto' },
  { key: 'type', label: 'Tipo' },
  { key: 'balance', label: 'Saldo' },
];
const TOPUP_MIN = 20;
const TOPUP_MAX = 2000;
// Quick amounts in the top-up form ($20 and $50 for a snack or a lunch).
const TOPUP_PRESETS = [20, 50, 100, 200, 300, 500];

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
  const fields = fieldErrorsOrNull(err);
  if (!fields) return 'No fue posible procesar la recarga. Intente nuevamente.';
  return fields.detail || fields.amount || 'No fue posible procesar la recarga. Revise el monto e intente nuevamente.';
}

export default function CafeteriaPage() {
  const queryClient = useQueryClient();
  const childId = useSelectedChildStore((s) => s.childId);
  const setChildId = useSelectedChildStore((s) => s.setChildId);
  const [topupAmount, setTopupAmount] = useState('');
  // Card payment is offered only when the server allows it for this family
  // (live, or a listed tester while Banorte runs its simulation).
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data: availability } = useQuery({
    // Per user: the answer depends on who is logged in (test accounts first).
    queryKey: ['payments-availability', userId],
    queryFn: () => paymentsApi.getAvailability().then((r) => r.data),
    staleTime: 60_000,
  });
  const onlineAvailable = availability?.online ?? false;
  // Test accounts may top up $1 to try the checkout; families keep $20.
  const topupMin = Math.max(Number(availability?.min_amount ?? TOPUP_MIN) || TOPUP_MIN, TOPUP_MIN);
  const topupPresets = TOPUP_PRESETS;
  // Families pay by card only; there is no "pago en caja escolar" request.
  const topupMethod = 'online' as const;
  // Card top-ups reach the balance at the school's next POS load (7:30 on
  // school days) unless the server says they are credited on payment.
  const policy = availability?.topup_policy;
  const scheduled = isScheduled(policy);
  const whatsapp = policy?.whatsapp ?? DEFAULT_WHATSAPP;
  const [selectedStudent, setSelectedStudent] = useState<number | null>(null);
  // Recarga wizard step (BACKLOG P1-D1): 1 alumno+monto, 2 método, 3 revisión.
  const [topupStep, setTopupStep] = useState<1 | 2 | 3>(1);
  const [showTopup, setShowTopup] = useState(false);
  const [thresholdStudent, setThresholdStudent] = useState<CafeteriaBalance | null>(null);
  const [thresholdValue, setThresholdValue] = useState('');
  const [budgetStudent, setBudgetStudent] = useState<CafeteriaBalance | null>(null);
  const [budgetDaily, setBudgetDaily] = useState('');
  const [budgetWeekly, setBudgetWeekly] = useState('');

  // History filters, sort and page live in the URL (Data Ops Phase 9), so a
  // filtered view survives refresh and Back: ?alumno= ?tipo= ?desde= ?hasta=
  // ?orden= ?page=. Any filter or sort change goes back to page 1.
  const { get, set } = useUrlFilters();
  const [page, setPage] = useUrlPage();
  const rawType = get('tipo');
  const filterType: TypeFilter = (TX_TYPES as readonly string[]).includes(rawType) ? (rawType as TypeFilter) : '';
  const filterFrom = get('desde');
  const filterTo = get('hasta');
  const rawSort = parseSort(get('orden'));
  const sort: SortState = TX_SORT_OPTIONS.some((o) => o.key === rawSort.key) ? rawSort : { key: '', dir: 'desc' };
  const ordering = serializeSort(sort) ?? undefined;

  const { data: balances, isLoading: balancesLoading, isError: balancesError, refetch: refetchBalances, dataUpdatedAt: balancesUpdatedAt, isFetching: balancesFetching } = useQuery<CafeteriaBalance[]>({
    queryKey: ['cafeteria-balances'],
    ...LIVE,
    queryFn: async () => {
      const { data } = await cafeteriaApi.getMyBalance();
      return Array.isArray(data) ? data : [data];
    },
  });

  // The alumno filter IS the portal child switcher (shared store), kept in
  // step with ?alumno= by the effect below. A valid ?alumno= (one of this
  // family's children) wins during render, so a shared link or Back never
  // fetches the wrong child's page first.
  const urlAlumno = get('alumno');
  const urlChild = balances?.some((b) => String(b.student.id) === urlAlumno) ? Number(urlAlumno) : null;
  const filterStudent: number | 'all' = urlChild ?? childId ?? 'all';
  // One param set for the list and its export, so the file is the list.
  const historyParams = {
    student: filterStudent === 'all' ? undefined : filterStudent,
    type: filterType || undefined,
    from: filterFrom || undefined,
    to: filterTo || undefined,
    ordering,
  };

  const { data: txData, isLoading: txLoading, isError: txError, refetch: refetchTx } = useQuery<{
    results: CafeteriaTransaction[]; count: number;
  }>({
    queryKey: ['cafeteria-transactions', filterStudent, filterType, filterFrom, filterTo, ordering, page],
    ...LIVE,
    // The history only renders once balances are known (and ?alumno= can be
    // validated against them).
    enabled: !!balances,
    queryFn: async () => {
      const { data } = await cafeteriaApi.getTransactions({
        ...historyParams,
        page,
      });
      const results = data.results ?? data;
      return { results, count: data.count ?? results.length };
    },
    placeholderData: keepPreviousData,
  });
  const transactions = txData?.results;
  const txCount = txData?.count ?? 0;

  // ?alumno= ↔ child switcher, whichever side moved last wins: a new
  // selection in the switcher or the select is written to the URL (and resets
  // ?page=); a URL change (shared link, refresh, Back) naming one of this
  // family's children selects it in the store; an empty or foreign ?alumno=
  // just mirrors the store. Declared before the one-shot ?hijo= and ?recarga=
  // effects so their URL writes land last in the same pass.
  const lastSync = useRef({ childId, urlAlumno });
  useEffect(() => {
    if (!balances) return;
    const prev = lastSync.current;
    lastSync.current = { childId, urlAlumno };
    const want = childId == null ? '' : String(childId);
    if (urlAlumno === want) return;
    if (childId !== prev.childId) set({ alumno: want || null, page: null });
    else if (urlChild != null) setChildId(urlChild);
    else set({ alumno: want || null });
  }, [balances, childId, urlAlumno, urlChild, set, setChildId]);

  // Quick top-up deep link from the dashboard chips (`?recarga=200`): prefill
  // the amount and open the top-up modal for the active (or first Loyverse-
  // linked) student. The param is consumed immediately (replace, so Back does
  // not re-trigger) and out-of-range amounts are ignored. No payment logic
  // lives here — this only pre-selects what the existing modal already does.
  const [searchParams, setSearchParams] = useSearchParams();
  // ?hijo=<id> (profile page per-child button) selects that child once.
  useEffect(() => {
    const raw = searchParams.get('hijo');
    if (raw == null || !balances) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('hijo');
      return next;
    }, { replace: true });
    const id = Number(raw);
    if (balances.some((b) => b.student.id === id)) setChildId(id);
  }, [searchParams, setSearchParams, balances, setChildId]);
  useEffect(() => {
    const raw = searchParams.get('recarga');
    if (raw == null || !balances) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('recarga');
      return next;
    }, { replace: true });
    const amount = Number(raw);
    const target =
      balances.find((b) => b.student.id === childId && !!b.student.loyverse_id)
      ?? balances.find((b) => !!b.student.loyverse_id);
    if (!target || !Number.isFinite(amount) || amount < TOPUP_MIN || amount > TOPUP_MAX) return;
    // Suppressed: one-shot URL command — the param is external navigation
    // state consumed (deleted) right above, so the modal state cannot be
    // derived from it and these one-time writes cannot cascade.
    /* eslint-disable react-hooks/set-state-in-effect */
    setSelectedStudent(target.student.id);
    setTopupAmount(String(amount));
    setShowTopup(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [searchParams, setSearchParams, balances, childId]);

  const topupAmountNum = parseFloat(topupAmount);
  const topupAmountValid =
    Number.isFinite(topupAmountNum)
    && topupAmountNum >= topupMin
    && topupAmountNum <= TOPUP_MAX;

  const navigate = useNavigate();
  const [paying, setPaying] = useState(false);

  // Banorte lightbox: every callback goes to the backend (which decrypts the
  // result with a key this page never sees); the return page then shows the
  // settled outcome.
  const payWithBanorte = async (
    paymentId: number,
    checkout: Extract<CheckoutStart, { kind: 'lightbox' }>,
  ) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setPaying(false);
      closeBanorteLightbox();
      navigate(`/portal/cafeteria/recarga/retorno?payment_id=${paymentId}`);
    };
    const onEvent = async (event: BanorteEvent, response: unknown) => {
      let status = '';
      let failureReason = '';
      try {
        ({ data: { status, failure_reason: failureReason = '' } } =
          await paymentsApi.reportBanorteResult(paymentId, event, response));
      } catch {
        /* the return page polls the payment either way */
      }
      if (done) return;
      if (event === 'success' || event === 'cancel') return finish();
      if (event === 'error') {
        // Cancelled in the 3D Secure step (status3D 423): the return page says so.
        if (status === 'failed' && failureReason === 'cancelled') return finish();
        if (status === 'failed') {
          done = true;
          setPaying(false);
          toast.error('El pago en línea no está disponible en este momento. Intente más tarde o recargue en efectivo en la caja de cafetería.');
        }
        return; // Banorte keeps its window open on other errors
      }
      // Window closed without a result.
      done = true;
      setPaying(false);
      void queryClient.invalidateQueries({ queryKey: ['cafeteria-balances'] });
      toast(scheduled
        ? 'Cerraste la ventana de pago. Si completaste el pago, aparecerá como «Recarga por aplicar» en unos minutos.'
        : 'Cerraste la ventana de pago. Si completaste el pago, lo verás reflejado en unos minutos.');
    };
    setPaying(true);
    try {
      await openBanorteLightbox(checkout, (event, response) => { void onEvent(event, response); });
    } catch (err) {
      setPaying(false);
      toast.error(err instanceof Error ? err.message : 'No se pudo abrir la ventana de pago de Banorte.');
    }
  };

  const topupMutation = useMutation({
    mutationFn: () => cafeteriaApi.requestTopUp(selectedStudent!, topupAmountNum, topupMethod),
    onSuccess: ({ data }) => {
      if (data?.checkout) {
        const checkout = data.checkout;
        setShowTopup(false);
        setTopupAmount('');
        setTopupStep(1);
        if (checkout.kind === 'lightbox' && data.payment_id) {
          void payWithBanorte(data.payment_id, checkout);
        } else if (checkout.kind === 'redirect') {
          // Local development without Banorte credentials: the mock page.
          window.location.href = checkout.url;
        }
        return;
      }
      toast.error('No se pudo abrir el pago con tarjeta. Intente de nuevo.');
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

  // Family-set daily/weekly spending budget (#13). Empty field → 0 (disabled).
  const budgetMutation = useMutation({
    mutationFn: () =>
      cafeteriaApi.updateSpendLimits(budgetStudent!.student.id, {
        daily_spend_limit: budgetDaily === '' ? 0 : parseFloat(budgetDaily),
        weekly_spend_limit: budgetWeekly === '' ? 0 : parseFloat(budgetWeekly),
      }),
    onSuccess: () => {
      toast.success('Presupuesto de cafetería actualizado.');
      setBudgetStudent(null);
      queryClient.invalidateQueries({ queryKey: ['cafeteria-balances'] });
    },
    onError: () => toast.error('No se pudo actualizar el presupuesto. Intente nuevamente.'),
  });

  const openBudget = (b: CafeteriaBalance) => {
    setBudgetStudent(b);
    const d = parseFloat(b.daily_spend_limit ?? '0');
    const w = parseFloat(b.weekly_spend_limit ?? '0');
    setBudgetDaily(d > 0 ? d.toFixed(0) : '');
    setBudgetWeekly(w > 0 ? w.toFixed(0) : '');
  };

  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const { data } = await cafeteriaApi.refreshFromLoyverse();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['cafeteria-balances'] }),
        queryClient.invalidateQueries({ queryKey: ['cafeteria-transactions'] }),
        queryClient.invalidateQueries({ queryKey: ['cafeteria-spending-categories'] }),
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

  const downloadStatement = async () => {
    if (!selectedStudent) return;
    try {
      const month = format(new Date(), 'yyyy-MM');
      const { data } = await cafeteriaApi.statementPdf(selectedStudent, month);
      downloadBlob(data, `estado-cuenta-cafeteria-${month}.pdf`);
    } catch {
      toast.error('No se pudo generar el estado de cuenta.');
    }
  };

  // The download is the list on screen: same alumno, tipo, fechas and orden.
  const exportMovements = async (fmt: 'csv' | 'xlsx') =>
    (await cafeteriaApi.exportMyTransactions({ fmt, ...historyParams })).data as Blob;

  // History filters: track whether any is active so we can give feedback and a
  // one-tap reset (the list auto-applies filters, so without this a filter that
  // matches nothing looks like a dead end).
  const filtersActive =
    filterType !== '' || filterFrom !== '' || filterTo !== '' || filterStudent !== 'all';
  const clearFilters = () => {
    set({ tipo: null, desde: null, hasta: null, alumno: null, page: null });
    setChildId(null);
  };

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

  const switcherStudents = (balances ?? []).map((b) => ({
    id: b.student.id,
    name: b.student.user.full_name,
    grade: b.student.grade,
    group: b.student.group,
  }));

  const visibleBalances = childId == null
    ? (balances ?? [])
    : (balances ?? []).filter((b) => b.student.id === childId);

  // Only offer the "Recargar saldo" shortcut when some child is actually
  // linked to Loyverse (otherwise there is no top-up section to jump to).
  const anyLinked = (balances ?? []).some((b) => !!b.student.loyverse_id);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-head text-fluid-xl font-bold leading-tight tracking-[-0.3px] text-ink">Cafetería</h1>
          <p className="mt-1 text-fluid-sm text-muted">
            {scheduled
              ? 'Consulte el saldo y los movimientos. Una recarga con tarjeta se suma al saldo cuando el colegio la carga en la caja de cafetería (días hábiles, 7:30 a.m.).'
              : 'Consulte el saldo y los movimientos. Tras una recarga en línea, el saldo aparece aquí al confirmar el pago; el colegio lo carga en el POS para compras en cafetería.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start">
          {selectedStudent && (
            <Button variant="secondary" size="sm" onClick={downloadStatement} className="min-h-[44px] focus-visible:ring-2 focus-visible:ring-purple/40">
              <Download className="w-3 h-3" /> Estado de cuenta (PDF)
            </Button>
          )}
          <LiveBadge
            updatedAt={balancesUpdatedAt}
            isFetching={balancesFetching || refreshing}
            onRefresh={refresh}
            className="min-h-[44px] px-1"
          />
        </div>
      </div>

      {balancesLoading ? (
        <div className="space-y-4" aria-busy="true" aria-label="Cargando cafetería">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1].map((i) => <div key={i} className="skeleton h-[200px] rounded-xl2" />)}
          </div>
          <Card><ListSkeleton rows={4} /></Card>
        </div>
      ) : null}

      {!balancesLoading && switcherStudents.length > 1 && (
        <ChildSwitcher
          students={switcherStudents}
          allowAll
          className="mb-1"
        />
      )}

      {/* Balance cards */}
      {!balancesLoading && (
      <div id="saldos-cafeteria" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleBalances.map((b) => {
          // Prefer API flag (balance <= threshold); fall back to same inequality.
          const isLow = typeof b.is_low_balance === 'boolean'
            ? b.is_low_balance
            : parseFloat(b.balance) <= parseFloat(b.low_balance_threshold ?? '50');
          const notLinked = !b.student.loyverse_id;
          const bal = parseFloat(b.balance);
          const isSelected = childId === b.student.id;
          return (
            <Card
              key={b.id}
              className={`flex flex-col ${isSelected ? 'ring-2 ring-purple/35' : ''}`}
            >
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

              <PendingTopUps items={b.pending_topups ?? []} whatsapp={whatsapp} />

              {notLinked && (
                <p className="mt-3 rounded-lg border border-amber/30 bg-amber/5 px-3 py-2 text-xs leading-snug text-muted">
                  Este alumno aún no está vinculado a cafetería/Loyverse. Contacta al colegio para activar el servicio.
                </p>
              )}

              {!notLinked && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => { setSelectedStudent(b.student.id); setShowTopup(true); }}
                  loading={paying}
                  disabled={paying}
                  className="mt-4 min-h-[44px] w-full focus-visible:ring-2 focus-visible:ring-purple/40"
                >
                  <Plus className="w-3.5 h-3.5" /> {paying ? 'Abriendo pago seguro…' : 'Recargar'}
                </Button>
              )}

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

              {/* Spending budget (#13): progress vs the parent-set daily/weekly cap.
                  Render a bar for EACH active limit so a weekly overspend isn't
                  hidden behind an under-budget daily bar. */}
              {(() => {
                const dailyLimit = parseFloat(b.daily_spend_limit ?? '0');
                const weeklyLimit = parseFloat(b.weekly_spend_limit ?? '0');
                if (dailyLimit <= 0 && weeklyLimit <= 0) {
                  return (
                    <button
                      type="button"
                      onClick={() => openBudget(b)}
                      className="mt-2 flex items-center gap-1 self-start rounded text-left text-[11.5px] font-medium text-subtle transition hover:text-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/30"
                    >
                      <Wallet className="h-3 w-3" /> Establecer presupuesto
                    </button>
                  );
                }
                const bars = [
                  { on: dailyLimit > 0, label: 'hoy', limit: dailyLimit, spent: parseFloat(b.today_spend ?? '0') },
                  { on: weeklyLimit > 0, label: 'esta semana', limit: weeklyLimit, spent: parseFloat(b.week_spend ?? '0') },
                ].filter((x) => x.on);
                return (
                  <div className="mt-3 space-y-2.5">
                    {bars.map(({ label, limit, spent }) => {
                      const pct = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
                      const over = limit > 0 && spent > limit;
                      return (
                        <div key={label}>
                          <div className="mb-1 flex items-baseline justify-between text-[11.5px]">
                            <span className="font-medium text-subtle">Presupuesto {label}</span>
                            <span className={over ? 'font-semibold text-coral' : 'text-muted'}>
                              ${spent.toFixed(0)} / ${limit.toFixed(0)}
                            </span>
                          </div>
                          <div
                            className="h-2 w-full overflow-hidden rounded-full bg-cream"
                            role="progressbar"
                            aria-label={`Presupuesto ${label}`}
                            aria-valuenow={Math.round(pct)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          >
                            <div
                              className={`h-full rounded-full ${over ? 'bg-coral' : 'bg-green-500'}`}
                              style={{ width: `${Math.max(pct, 3)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => openBudget(b)}
                      className="self-start rounded text-left text-[11px] font-medium text-subtle transition hover:text-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/30"
                    >
                      Cambiar presupuesto
                    </button>
                  </div>
                );
              })()}
            </Card>
          );
        })}
      </div>
      )}

      {/* Spend-by-category breakdown (#14) — follows the child switcher selection. */}
      {!balancesLoading && balances && balances.length > 0 && (
        <CafeteriaCategoriesCard student={childId ?? 'all'} />
      )}

      {/* No cafeteria accounts — school must link children to Loyverse. */}
      {!balancesLoading && balances && balances.length === 0 && (
        <Card>
          <EmptyState
            icon={Coffee}
            title="Sin servicio de cafetería"
            description="El colegio debe vincular a tu hijo(a) con el servicio de cafetería (Loyverse) para ver saldo y movimientos aquí. Contacta a la administración escolar si crees que ya debería estar activo."
            action={
              <Link to="/contacto" className="btn-secondary text-sm">
                Contactar al colegio
              </Link>
            }
          />
        </Card>
      )}

      {/* Top-up modal — 3-step wizard (BACKLOG P1-D1) */}
      <Modal
        open={showTopup}
        onClose={() => { setShowTopup(false); setTopupAmount(''); setTopupStep(1); }}
        title="Recargar cafetería"
        maxWidth={520}
      >
        <ol className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide" aria-label="Pasos">
          {(['Alumno y monto', 'Método de pago', 'Revisar'] as const).map((label, i) => {
            const n = (i + 1) as 1 | 2 | 3;
            const state = n < topupStep ? 'done' : n === topupStep ? 'current' : 'todo';
            return (
              <li key={label} className="flex items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${state === 'todo' ? 'bg-cream-2 text-subtle' : 'bg-purple text-white'}`}>{n}</span>
                <span className={`hidden sm:inline ${state === 'current' ? 'text-ink' : 'text-subtle'}`}>{label}</span>
                {n < 3 && <span className="h-px w-4 bg-line" aria-hidden="true" />}
              </li>
            );
          })}
        </ol>

        {topupStep === 1 && (
          <>
            <div>
              <label className="label" htmlFor="topup-student">Alumno</label>
              <select
                id="topup-student"
                className="input-field min-h-[44px] text-base"
                value={selectedStudent ?? ''}
                onChange={(e) => setSelectedStudent(Number(e.target.value) || null)}
              >
                {(balances ?? []).filter((b) => !!b.student.loyverse_id).map((b) => (
                  <option key={b.student.id} value={b.student.id}>
                    {b.student.user.full_name} · saldo ${parseFloat(b.balance).toFixed(2)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="topup-amount">Monto (MXN)</label>
              <input
                id="topup-amount"
                type="number"
                inputMode="decimal"
                min={topupMin}
                max={TOPUP_MAX}
                className="input-field min-h-[44px] text-base"
                placeholder="Ej. 200"
                value={topupAmount}
                onChange={(e) => setTopupAmount(e.target.value)}
              />
              <p className="mt-1 text-xs text-subtle">Mínimo ${topupMin} · Máximo ${TOPUP_MAX.toLocaleString('es-MX')}</p>
              {topupAmount !== '' && Number.isFinite(topupAmountNum) && topupAmountNum > TOPUP_MAX && (
                <p className="mt-1 text-xs text-coral">El monto máximo por recarga es ${TOPUP_MAX.toLocaleString('es-MX')}.</p>
              )}
              {topupAmount !== '' && Number.isFinite(topupAmountNum) && topupAmountNum > 0 && topupAmountNum < topupMin && (
                <p className="mt-1 text-xs text-coral">El monto mínimo por recarga es ${topupMin}.</p>
              )}
              <div className="mt-2.5 flex flex-wrap gap-2">
                {topupPresets.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setTopupAmount(String(amt))}
                    className={`min-h-[40px] rounded-full border px-4 text-sm font-semibold transition ${
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
          </>
        )}

        {topupStep === 2 && (
          <>
            {/* Card is the only method for families (owner, 2026-10-20): cash
                recargas are made directly at the cafetería POS. */}
            <p className="label">Método de pago</p>
            <div
              className={`flex min-h-[56px] items-start gap-3 rounded-xl border p-3 ${
                onlineAvailable ? 'border-purple bg-purple/[0.04]' : 'border-line bg-cream/60 opacity-70'}`}
            >
              <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-purple" aria-hidden="true" />
              <span>
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                  Pago en línea con tarjeta (Visa y Mastercard)
                  {!onlineAvailable && (
                    <span className="rounded-full bg-amber/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-amber">
                      Próximamente
                    </span>
                  )}
                </span>
                <span className="block text-xs text-muted">
                  {!onlineAvailable
                    ? 'Muy pronto podrá pagar con tarjeta desde el portal. Mientras tanto, recargue en efectivo en la caja de cafetería.'
                    : scheduled
                      ? sentence(`El saldo se aplica ${applyPhrase(policy?.next_apply_at)}`)
                      : 'El saldo se aplica en minutos.'}
                </span>
                {onlineAvailable && (
                  <span className="mt-1 block text-xs font-semibold text-coral">No se acepta American Express.</span>
                )}
              </span>
            </div>
            {onlineAvailable && availability?.test_mode && (
              <p className="rounded-xl border border-amber/40 bg-amber/10 px-3 py-2 text-xs text-ink">
                <strong>Modo de prueba Banorte:</strong> no se realiza ningún cargo real.
              </p>
            )}
            {onlineAvailable && availability?.certification && (
              <p className="rounded-xl border border-coral/40 bg-coral-50 px-3 py-2 text-xs text-ink">
                <strong>Certificación Banorte: cargo real a la tarjeta.</strong> Solo cuentas de prueba
                ven esta opción; el pago puede devolverse desde MultiCobros.
              </p>
            )}
            {onlineAvailable && scheduled && (
              <p role="note" className="rounded-xl border border-amber/40 bg-amber/[0.07] px-3 py-2.5 text-xs leading-relaxed text-ink">
                {applyNotice(policy)}
              </p>
            )}
            {onlineAvailable && <BanortePaymentNotice />}
          </>
        )}

        {topupStep === 3 && (
          <dl className="divide-y divide-line rounded-xl border border-line text-sm">
            <div className="flex justify-between gap-3 px-4 py-3"><dt className="text-muted">Alumno</dt><dd className="font-medium text-ink">{(balances ?? []).find((b) => b.student.id === selectedStudent)?.student.user.full_name ?? '—'}</dd></div>
            <div className="flex justify-between gap-3 px-4 py-3"><dt className="text-muted">Monto</dt><dd className="font-bold text-ink">${topupAmountNum.toFixed(2)} MXN</dd></div>
            <div className="flex justify-between gap-3 px-4 py-3"><dt className="text-muted">Método</dt><dd className="font-medium text-ink">Tarjeta Visa o Mastercard</dd></div>
            {scheduled && (
              <div className="flex justify-between gap-3 px-4 py-3"><dt className="whitespace-nowrap text-muted">Se aplica</dt><dd className="text-right font-medium text-ink">{applyPhrase(policy?.next_apply_at)}</dd></div>
            )}
            <div className="px-4 py-3 text-xs text-muted">
              {scheduled
                ? `Al continuar se abrirá la ventana segura de Banorte. No se acepta American Express. ${applyNotice(policy)}`
                : 'Al continuar se abrirá la ventana segura de Banorte. No se acepta American Express. Cuando el banco confirme, verá el saldo en el portal.'}
            </div>
          </dl>
        )}

        <div className="sticky bottom-0 -mx-1 flex flex-col gap-2 bg-white pt-2 sm:flex-row">
          {topupStep > 1 ? (
            <Button variant="secondary" onClick={() => setTopupStep((s) => (s - 1) as 1 | 2 | 3)} className="min-h-[44px] flex-1">Atrás</Button>
          ) : (
            <Button variant="secondary" onClick={() => { setShowTopup(false); setTopupAmount(''); setTopupStep(1); }} className="min-h-[44px] flex-1">Cancelar</Button>
          )}
          {topupStep < 3 ? (
            <Button
              variant="primary"
              onClick={() => setTopupStep((s) => (s + 1) as 1 | 2 | 3)}
              disabled={(topupStep === 1 && (!topupAmountValid || !selectedStudent)) || (topupStep === 2 && !onlineAvailable)}
              className="min-h-[44px] flex-1"
            >
              Continuar
            </Button>
          ) : (
            <Button
              variant="primary"
              loading={topupMutation.isPending}
              onClick={() => topupMutation.mutate()}
              disabled={!topupAmountValid || !selectedStudent || !onlineAvailable}
              className="min-h-[44px] flex-1"
            >
              Ir a pagar
            </Button>
          )}
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

      {/* Spending budget modal (#13) */}
      <Modal open={!!budgetStudent} onClose={() => setBudgetStudent(null)} title="Presupuesto de cafetería">
        {budgetStudent && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Establece cuánto puede gastar{' '}
              <span className="font-semibold text-ink">{budgetStudent.student.user.full_name}</span>{' '}
              en cafetería. Te avisaremos cuando una compra supere el límite. Deja un
              campo vacío o en 0 para desactivarlo.
            </p>
            <div>
              <label className="label" htmlFor="budget-daily">Límite diario (MXN)</label>
              <input
                id="budget-daily"
                type="number"
                inputMode="decimal"
                min="0"
                step="10"
                className="input-field min-h-[44px] text-base"
                placeholder="Sin límite"
                value={budgetDaily}
                onChange={(e) => setBudgetDaily(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="budget-weekly">Límite semanal (MXN)</label>
              <input
                id="budget-weekly"
                type="number"
                inputMode="decimal"
                min="0"
                step="50"
                className="input-field min-h-[44px] text-base"
                placeholder="Sin límite"
                value={budgetWeekly}
                onChange={(e) => setBudgetWeekly(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="secondary" onClick={() => setBudgetStudent(null)} className="min-h-[44px] flex-1 focus-visible:ring-2 focus-visible:ring-purple/40">Cancelar</Button>
              <Button
                variant="primary"
                loading={budgetMutation.isPending}
                onClick={() => budgetMutation.mutate()}
                disabled={
                  (budgetDaily !== '' && parseFloat(budgetDaily) < 0)
                  || (budgetWeekly !== '' && parseFloat(budgetWeekly) < 0)
                }
                className="min-h-[44px] flex-1 focus-visible:ring-2 focus-visible:ring-purple/40"
              >
                Guardar
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Transactions — only when the family actually has cafeteria accounts */}
      {!balancesLoading && balances && balances.length > 0 && (
      <Card title="Historial de movimientos">
        {/* Filters */}
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap">
          {(balances?.length ?? 0) > 1 && (
            <select
              className="input-field min-h-[44px] text-base sm:text-sm lg:w-auto"
              value={filterStudent}
              onChange={(e) => {
                // The sync effect mirrors this into ?alumno= and resets ?page=.
                setChildId(e.target.value === 'all' ? null : Number(e.target.value));
              }}
              aria-label="Filtrar por alumno"
            >
              <option value="all">Todos los alumnos</option>
              {balances?.map((b) => (
                <option key={b.student.id} value={b.student.id}>{b.student.user.full_name}</option>
              ))}
            </select>
          )}
          <select
            className="input-field min-h-[44px] text-base sm:text-sm lg:w-auto"
            value={filterType}
            onChange={(e) => set({ tipo: e.target.value || null, page: null })}
            aria-label="Filtrar por tipo"
          >
            <option value="">Todos los tipos</option>
            <option value="purchase">Compras</option>
            <option value="topup">Recargas</option>
            <option value="refund">Devoluciones</option>
          </select>
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

        {/* Presets first: "este mes" is what a parent actually wants to see, and
            on a phone it used to cost two native date pickers. */}
        <DateRangeFilter
          idPrefix="mov"
          className="mb-4"
          value={{ from: filterFrom, to: filterTo }}
          onChange={(r) => set({ desde: r.from || null, hasta: r.to || null, page: null })}
        />

        {/* Sort (server-side, whole history) + download of exactly this view. */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SortChips
            options={TX_SORT_OPTIONS}
            sort={sort}
            onSort={(next) => set({ orden: serializeSort(next), page: null })}
          />
          <PortalExportButtons
            what="movimientos"
            filenamePrefix="movimientos_cafeteria"
            fetch={exportMovements}
          />
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
            <EmptyState
              icon={Coffee}
              title="Sin movimientos"
              description="Los movimientos de cafetería aparecerán aquí."
              action={anyLinked ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    document.getElementById('saldos-cafeteria')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                >
                  <Plus className="h-3.5 w-3.5" /> Recargar saldo
                </Button>
              ) : undefined}
            />
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
                  {tx.applied === false && (
                    <p className="text-xs text-subtle sm:mt-0.5">Incluida en el saldo inicial</p>
                  )}
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
