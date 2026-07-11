import { useQuery } from '@tanstack/react-query';
import { Coffee, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card } from '@/components/ui/Card';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { cafeteriaApi } from '@/services/api';
import type { CafeteriaBalance, CafeteriaTransaction } from '@/types';

export default function StudentCafeteria() {
  const { data: balanceData, isLoading: balanceLoading, isError: balanceError, refetch: refetchBalance } = useQuery<CafeteriaBalance>({
    queryKey: ['cafeteria-balance-student'],
    queryFn: async () => {
      const { data } = await cafeteriaApi.getMyBalance();
      return data;
    },
  });

  const { data: transactions, isLoading: txLoading, isError: txError, refetch: refetchTx } = useQuery<CafeteriaTransaction[]>({
    queryKey: ['cafeteria-transactions-student'],
    queryFn: async () => {
      const { data } = await cafeteriaApi.getTransactions();
      return data.results ?? data;
    },
  });

  if (balanceLoading) return <LoadingSpinner size="lg" className="mt-20" />;

  if (balanceError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Mi Cafetería</h1>
          <p className="text-slate-500 text-sm mt-0.5">Saldo y movimientos de su cuenta de cafetería.</p>
        </div>
        <Card><ErrorState onRetry={() => refetchBalance()} /></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Mi Cafetería</h1>
        <p className="text-slate-500 text-sm mt-0.5">Saldo y movimientos de su cuenta de cafetería.</p>
      </div>

      {/* Balance */}
      <div className="card bg-gradient-to-br from-brand-600 to-brand-700 text-white">
        <div className="flex items-center gap-3 mb-3">
          <Coffee className="w-5 h-5 text-brand-200" />
          <p className="text-brand-100 text-sm">Saldo disponible</p>
        </div>
        <p className="text-4xl font-bold">${parseFloat(balanceData?.balance ?? '0').toFixed(2)}</p>
        <p className="text-brand-200 text-xs mt-1">MXN · 1 punto Loyverse = $1.00</p>
        {balanceData && parseFloat(balanceData.balance) < 50 && (
          <div className="mt-3 bg-amber-400/30 rounded-lg px-3 py-2 text-xs text-amber-100">
            Saldo bajo. Solicita a tu tutor que recargue tu cuenta.
          </div>
        )}
      </div>

      {/* Transactions */}
      <Card title="Últimos movimientos">
        {txError ? (
          <ErrorState onRetry={() => refetchTx()} />
        ) : txLoading ? (
          <LoadingSpinner />
        ) : !transactions?.length ? (
          <EmptyState icon={Coffee} title="Sin movimientos" description="Sus compras y recargas aparecerán aquí." />
        ) : (
          <div className="divide-y divide-slate-100">
            {transactions.map((tx) => (
              <div key={tx.id} className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <span className="mt-0.5">
                    {tx.transaction_type === 'topup'
                      ? <ArrowUpCircle className="w-4 h-4 text-brand-500 flex-shrink-0" />
                      : <ArrowDownCircle className="w-4 h-4 text-slate-400 flex-shrink-0" />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-slate-900">{tx.description || (tx.transaction_type === 'topup' ? 'Recarga' : 'Compra en cafetería')}</p>
                    <p className="text-xs text-slate-400">{format(new Date(tx.date), "d MMM yyyy · HH:mm", { locale: es })}</p>
                    {tx.items?.length > 0 && (
                      <ul className="mt-1 text-xs text-slate-500 space-y-0.5">
                        {tx.items.map((it, i) => (
                          <li key={i}>{it.quantity}× {it.name}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <span className={`text-sm font-semibold ${tx.transaction_type !== 'purchase' ? 'text-brand-600' : 'text-slate-700'}`}>
                    {tx.transaction_type !== 'purchase' ? '+' : '-'}${parseFloat(tx.amount).toFixed(2)}
                  </span>
                  {tx.balance_after != null && (
                    <p className="text-xs text-slate-400 mt-0.5">Saldo ${parseFloat(tx.balance_after).toFixed(2)}</p>
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
