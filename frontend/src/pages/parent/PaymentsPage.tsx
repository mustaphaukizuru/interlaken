import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CreditCard, CheckCircle, Clock, XCircle, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { paymentsApi } from '@/services/api';
import type { Payment } from '@/types';

function RotateCcw({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10a9 9 0 1 0 2.636-6.364M3 10H9M3 10V4" />
    </svg>
  );
}

const statusMeta: Record<string, { label: string; variant: any; icon: any }> = {
  completed:  { label: 'Completado',  variant: 'success', icon: CheckCircle },
  pending:    { label: 'Pendiente',   variant: 'warning', icon: Clock },
  failed:     { label: 'Fallido',     variant: 'error',   icon: XCircle },
  processing: { label: 'Procesando',  variant: 'info',    icon: Clock },
  refunded:   { label: 'Reembolsado', variant: 'neutral', icon: RotateCcw },
};

const paymentTypeLabel: Record<string, string> = {
  tuition:    'Colegiatura',
  enrollment: 'Inscripción',
  cafeteria:  'Cafetería',
  other:      'Otro',
};

export default function PaymentsPage() {
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ amount: '', payment_type: 'tuition', description: '' });

  const { data: payments, isLoading } = useQuery<Payment[]>({
    queryKey: ['payments'],
    queryFn: async () => {
      const { data } = await paymentsApi.getMyPayments();
      return data.results ?? data;
    },
  });

  const initiateMutation = useMutation({
    mutationFn: () =>
      paymentsApi.initiatePayment({
        amount: parseFloat(form.amount),
        payment_type: form.payment_type,
        description: form.description || paymentTypeLabel[form.payment_type],
      }),
    onSuccess: () => {
      toast.success('Pago iniciado correctamente.');
      setShowNew(false);
      queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: () => toast.error('No fue posible iniciar el pago.'),
  });

  if (isLoading) return <LoadingSpinner size="lg" className="mt-20" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Pagos</h1>
          <p className="text-slate-500 text-sm mt-0.5">Historial de pagos y colegiaturas.</p>
        </div>
        <Button onClick={() => setShowNew(true)}>
          <Plus className="w-4 h-4" /> Nuevo pago
        </Button>
      </div>

      {/* New payment modal */}
      <Modal open={showNew} onClose={() => setShowNew(false)} title="Realizar pago">
        <div>
          <label className="label" htmlFor="payment-type">Tipo de pago</label>
          <select
            id="payment-type"
            className="input-field"
            value={form.payment_type}
            onChange={(e) => setForm((f) => ({ ...f, payment_type: e.target.value }))}
          >
            {Object.entries(paymentTypeLabel).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="payment-amount">Monto (MXN)</label>
          <input
            id="payment-amount"
            type="number"
            className="input-field"
            placeholder="0.00"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          />
        </div>
        <div>
          <label className="label" htmlFor="payment-description">Descripción (opcional)</label>
          <input
            id="payment-description"
            className="input-field"
            placeholder="Ej. Colegiatura Agosto 2025"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowNew(false)} className="flex-1">Cancelar</Button>
          <Button
            loading={initiateMutation.isPending}
            onClick={() => initiateMutation.mutate()}
            disabled={!form.amount || parseFloat(form.amount) <= 0}
            className="flex-1"
          >
            Pagar
          </Button>
        </div>
      </Modal>

      {/* Payments list */}
      <Card>
        {!payments?.length ? (
          <EmptyState icon={CreditCard} title="Sin pagos" description="Los pagos realizados aparecerán aquí." />
        ) : (
          <div className="divide-y divide-slate-100">
            {payments.map((p) => {
              const meta = statusMeta[p.status] ?? statusMeta.pending;
              const Icon = meta.icon;
              return (
                <div key={p.id} className="py-4 first:pt-0 last:pb-0 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-slate-100 rounded-xl flex items-center justify-center flex-shrink-0">
                      <CreditCard className="w-4 h-4 text-slate-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-900">{paymentTypeLabel[p.payment_type] ?? p.payment_type}</p>
                      <p className="text-xs text-slate-400">
                        {format(new Date(p.created_at), 'd MMM yyyy', { locale: es })}
                        {p.description ? ` · ${p.description}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-slate-900">${parseFloat(p.amount).toFixed(2)} {p.currency}</p>
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
