import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Coffee, Plus, ArrowDownCircle, ArrowUpCircle, RotateCcw } from 'lucide-react';
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
  if (type === 'topup')   return <ArrowUpCircle className="w-4 h-4 text-brand-500" />;
  if (type === 'refund')  return <RotateCcw className="w-4 h-4 text-blue-500" />;
  return <ArrowDownCircle className="w-4 h-4 text-slate-400" />;
};

const txLabel = (type: string) => {
  if (type === 'topup')  return 'Recarga';
  if (type === 'refund') return 'Devolución';
  return 'Compra';
};

export default function CafeteriaPage() {
  const queryClient = useQueryClient();
  const [topupAmount, setTopupAmount] = useState('');
  const [topupMethod, setTopupMethod] = useState<'online' | 'office'>('online');
  const [selectedStudent, setSelectedStudent] = useState<number | null>(null);
  const [showTopup, setShowTopup] = useState(false);

  const { data: balances, isLoading: balancesLoading } = useQuery<CafeteriaBalance[]>({
    queryKey: ['cafeteria-balances'],
    queryFn: async () => {
      const { data } = await cafeteriaApi.getMyBalance();
      return Array.isArray(data) ? data : [data];
    },
  });

  const { data: transactions, isLoading: txLoading } = useQuery<CafeteriaTransaction[]>({
    queryKey: ['cafeteria-transactions', selectedStudent],
    queryFn: async () => {
      const { data } = await cafeteriaApi.getTransactions(
        selectedStudent ? { page: 1 } : undefined
      );
      return data.results ?? data;
    },
  });

  const topupMutation = useMutation({
    mutationFn: () =>
      cafeteriaApi.requestTopUp(selectedStudent!, parseFloat(topupAmount), topupMethod),
    onSuccess: () => {
      toast.success('Solicitud de recarga enviada correctamente.');
      setShowTopup(false);
      setTopupAmount('');
      queryClient.invalidateQueries({ queryKey: ['cafeteria-balances'] });
    },
    onError: () => toast.error('No fue posible procesar la recarga. Intente nuevamente.'),
  });

  const isLoading = balancesLoading || txLoading;
  if (isLoading) return <LoadingSpinner size="lg" className="mt-20" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Cafetería</h1>
        <p className="text-slate-500 text-sm mt-0.5">Consulte el saldo y los movimientos del servicio de cafetería.</p>
      </div>

      {/* Balance cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {balances?.map((b) => (
          <Card key={b.id} className="relative">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <Coffee className="w-5 h-5 text-brand-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">{b.student.user.full_name}</p>
                <p className="text-xs text-slate-500">{b.student.grade} · Grupo {b.student.group}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-2xl font-bold text-slate-900">${parseFloat(b.balance).toFixed(2)}</span>
                  {parseFloat(b.balance) < parseFloat(b.low_balance_threshold ?? '50') && (
                    <Badge variant="warning">Saldo bajo</Badge>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Actualizado {b.last_synced ? format(new Date(b.last_synced), 'd MMM HH:mm', { locale: es }) : 'N/A'}
                </p>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => { setSelectedStudent(b.student.id); setShowTopup(true); }}
                className="flex-1"
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
            min="50"
            max="2000"
            className="input-field"
            placeholder="Ej. 200"
            value={topupAmount}
            onChange={(e) => setTopupAmount(e.target.value)}
          />
          <p className="text-xs text-slate-400 mt-1">Mínimo $50 · Máximo $2,000</p>
        </div>
        <div>
          <label className="label" htmlFor="topup-method">Método de pago</label>
          <select
            id="topup-method"
            className="input-field"
            value={topupMethod}
            onChange={(e) => setTopupMethod(e.target.value as any)}
          >
            <option value="online">Pago en línea (tarjeta)</option>
            <option value="office">Pago en caja escolar</option>
          </select>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowTopup(false)} className="flex-1">Cancelar</Button>
          <Button
            variant="primary"
            loading={topupMutation.isPending}
            onClick={() => topupMutation.mutate()}
            disabled={!topupAmount || parseFloat(topupAmount) < 50}
            className="flex-1"
          >
            Solicitar recarga
          </Button>
        </div>
      </Modal>

      {/* Transactions */}
      <Card title="Historial de movimientos">
        {txLoading ? (
          <LoadingSpinner />
        ) : !transactions?.length ? (
          <EmptyState icon={Coffee} title="Sin movimientos" description="Los movimientos de cafetería aparecerán aquí." />
        ) : (
          <div className="divide-y divide-slate-100">
            {transactions.map((tx) => (
              <div key={tx.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {txIcon(tx.transaction_type)}
                  <div>
                    <p className="text-sm font-medium text-slate-900">{txLabel(tx.transaction_type)}</p>
                    <p className="text-xs text-slate-400">
                      {format(new Date(tx.date), 'd MMM yyyy', { locale: es })}
                      {tx.description ? ` · ${tx.description}` : ''}
                    </p>
                  </div>
                </div>
                <span className={`text-sm font-semibold ${
                  tx.transaction_type === 'purchase' ? 'text-slate-700' : 'text-brand-600'
                }`}>
                  {tx.transaction_type === 'purchase' ? '-' : '+'}${parseFloat(tx.amount).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
