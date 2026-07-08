import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Coffee, Plus, ArrowDownCircle, ArrowUpCircle, RotateCcw, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { cafeteriaApi } from '@/services/api';
import type { CafeteriaBalance, CafeteriaTransaction } from '@/types';

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

export default function CafeteriaPage() {
  const queryClient = useQueryClient();
  const [topupAmount, setTopupAmount] = useState('');
  const [topupMethod, setTopupMethod] = useState<'online' | 'office'>('online');
  const [topupGateway, setTopupGateway] = useState<'global_payments' | 'banorte'>('global_payments');
  const [selectedStudent, setSelectedStudent] = useState<number | null>(null);
  const [showTopup, setShowTopup] = useState(false);

  // History filters
  const [filterStudent, setFilterStudent] = useState<number | 'all'>('all');
  const [filterType, setFilterType] = useState<TypeFilter>('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  const { data: balances, isLoading: balancesLoading } = useQuery<CafeteriaBalance[]>({
    queryKey: ['cafeteria-balances'],
    queryFn: async () => {
      const { data } = await cafeteriaApi.getMyBalance();
      return Array.isArray(data) ? data : [data];
    },
  });

  const { data: transactions, isLoading: txLoading } = useQuery<CafeteriaTransaction[]>({
    queryKey: ['cafeteria-transactions', filterStudent, filterType, filterFrom, filterTo],
    queryFn: async () => {
      const { data } = await cafeteriaApi.getTransactions({
        student: filterStudent === 'all' ? undefined : filterStudent,
        type: filterType || undefined,
        from: filterFrom || undefined,
        to: filterTo || undefined,
      });
      return data.results ?? data;
    },
  });

  const topupMutation = useMutation({
    mutationFn: () =>
      cafeteriaApi.requestTopUp(
        selectedStudent!,
        parseFloat(topupAmount),
        topupMethod,
        topupMethod === 'online' ? topupGateway : undefined,
      ),
    onSuccess: ({ data }) => {
      // Online payments hand off to the gateway's hosted page; the balance is
      // credited later by the confirmed webhook (see the return page).
      if (topupMethod === 'online' && data?.redirect_url) {
        toast.success('Redirigiendo a la pasarela de pago…');
        window.location.href = data.redirect_url;
        return;
      }
      toast.success('Solicitud de recarga enviada correctamente.');
      setShowTopup(false);
      setTopupAmount('');
      queryClient.invalidateQueries({ queryKey: ['cafeteria-balances'] });
    },
    onError: () => toast.error('No fue posible procesar la recarga. Intente nuevamente.'),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['cafeteria-balances'] });
    queryClient.invalidateQueries({ queryKey: ['cafeteria-transactions'] });
    toast.success('Actualizando saldos y movimientos…');
  };

  if (balancesLoading) return <LoadingSpinner size="lg" className="mt-20" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-fluid-xl font-bold text-ink">Cafetería</h1>
          <p className="mt-0.5 text-fluid-sm text-muted">Consulte el saldo y los movimientos del servicio de cafetería.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={refresh} className="self-start min-h-[44px] focus-visible:ring-2 focus-visible:ring-purple/40">
          <RefreshCw className="w-3 h-3" /> Actualizar
        </Button>
      </div>

      {/* Balance cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {balances?.map((b) => (
          <Card key={b.id} className="relative">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-green-50">
                <Coffee className="h-5 w-5 text-green-700" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{b.student.user.full_name}</p>
                <p className="text-xs text-muted">{b.student.grade} · Grupo {b.student.group}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-fluid-2xl font-bold text-ink">${parseFloat(b.balance).toFixed(2)}</span>
                  {parseFloat(b.balance) < parseFloat(b.low_balance_threshold ?? '50') && (
                    <Badge variant="warning">Saldo bajo</Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-subtle">
                  Actualizado {b.last_synced ? format(new Date(b.last_synced), 'd MMM HH:mm', { locale: es }) : 'N/A'}
                </p>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => { setSelectedStudent(b.student.id); setShowTopup(true); }}
                className="min-h-[44px] flex-1 focus-visible:ring-2 focus-visible:ring-purple/40"
              >
                <Plus className="w-3 h-3" /> Recargar
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {/* Top-up modal */}
      <Modal open={showTopup} onClose={() => setShowTopup(false)} title="Solicitar recarga">
        <div>
          <label className="label" htmlFor="topup-amount">Monto (MXN)</label>
          <input
            id="topup-amount"
            type="number"
            inputMode="decimal"
            min="50"
            max="2000"
            className="input-field min-h-[44px] text-base"
            placeholder="Ej. 200"
            value={topupAmount}
            onChange={(e) => setTopupAmount(e.target.value)}
          />
          <p className="mt-1 text-xs text-subtle">Mínimo $50 · Máximo $2,000</p>
        </div>
        <div>
          <label className="label" htmlFor="topup-method">Método de pago</label>
          <select
            id="topup-method"
            className="input-field min-h-[44px] text-base"
            value={topupMethod}
            onChange={(e) => setTopupMethod(e.target.value as any)}
          >
            <option value="online">Pago en línea (tarjeta)</option>
            <option value="office">Pago en caja escolar</option>
          </select>
        </div>
        {topupMethod === 'online' && (
          <div>
            <label className="label" htmlFor="topup-gateway">Pasarela de pago</label>
            <select
              id="topup-gateway"
              className="input-field min-h-[44px] text-base"
              value={topupGateway}
              onChange={(e) => setTopupGateway(e.target.value as any)}
            >
              <option value="global_payments">Global Payments (tarjeta)</option>
              <option value="banorte">Banorte (tarjeta / SPEI)</option>
            </select>
            <p className="mt-1 text-xs text-subtle">
              Será redirigido a la página segura de la pasarela para completar el pago.
            </p>
          </div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="secondary" onClick={() => setShowTopup(false)} className="min-h-[44px] flex-1 focus-visible:ring-2 focus-visible:ring-purple/40">Cancelar</Button>
          <Button
            variant="primary"
            loading={topupMutation.isPending}
            onClick={() => topupMutation.mutate()}
            disabled={!topupAmount || parseFloat(topupAmount) < 50}
            className="min-h-[44px] flex-1 focus-visible:ring-2 focus-visible:ring-purple/40"
          >
            {topupMethod === 'online' ? 'Continuar al pago' : 'Solicitar recarga'}
          </Button>
        </div>
      </Modal>

      {/* Transactions */}
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
        </div>

        {txLoading ? (
          <LoadingSpinner />
        ) : !transactions?.length ? (
          <EmptyState icon={Coffee} title="Sin movimientos" description="Los movimientos de cafetería aparecerán aquí." />
        ) : (
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
        )}
      </Card>
    </div>
  );
}
