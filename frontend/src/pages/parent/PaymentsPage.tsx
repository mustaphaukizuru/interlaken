import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CreditCard, CheckCircle, Clock, XCircle, Plus } from 'lucide-react';
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

  const { data: payments, isLoading, isError, refetch } = useQuery<Payment[]>({
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-fluid-xl font-bold text-ink">Pagos</h1>
          <p className="mt-0.5 text-fluid-sm text-muted">Historial de pagos y colegiaturas.</p>
        </div>
        <Button onClick={() => setShowNew(true)} className="self-start min-h-[44px] focus-visible:ring-2 focus-visible:ring-purple/40">
          <Plus className="w-4 h-4" /> Nuevo pago
        </Button>
      </div>

      {/* New payment modal */}
      <Modal open={showNew} onClose={() => setShowNew(false)} title="Realizar pago">
        <div>
          <label className="label" htmlFor="payment-type">Tipo de pago</label>
          <select
            id="payment-type"
            className="input-field min-h-[44px] text-base"
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
            inputMode="decimal"
            className="input-field min-h-[44px] text-base"
            placeholder="0.00"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          />
        </div>
        <div>
          <label className="label" htmlFor="payment-description">Descripción (opcional)</label>
          <input
            id="payment-description"
            className="input-field min-h-[44px] text-base"
            placeholder="Ej. Colegiatura Agosto 2025"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="secondary" onClick={() => setShowNew(false)} className="min-h-[44px] flex-1 focus-visible:ring-2 focus-visible:ring-purple/40">Cancelar</Button>
          <Button
            loading={initiateMutation.isPending}
            onClick={() => initiateMutation.mutate()}
            disabled={!form.amount || parseFloat(form.amount) <= 0}
            className="min-h-[44px] flex-1 focus-visible:ring-2 focus-visible:ring-purple/40"
          >
            Pagar
          </Button>
        </div>
      </Modal>

      {/* Payments list */}
      <Card>
        {isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : isLoading ? (
          <ListSkeleton />
        ) : !payments?.length ? (
          <EmptyState icon={CreditCard} title="Sin pagos" description="Los pagos realizados aparecerán aquí." />
        ) : (
          <div className="divide-y divide-cream">
            {payments.map((p) => {
              const meta = statusMeta[p.status] ?? statusMeta.pending;
              const Icon = meta.icon;
              return (
                <div key={p.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-cream">
                      <Icon className="h-4 w-4 text-muted" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{paymentTypeLabel[p.payment_type] ?? p.payment_type}</p>
                      <p className="text-xs text-subtle">
                        {format(new Date(p.created_at), 'd MMM yyyy', { locale: es })}
                        {p.description ? ` · ${p.description}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center justify-between gap-3 pl-12 sm:block sm:pl-0 sm:text-right">
                    <p className="text-sm font-bold text-ink">${parseFloat(p.amount).toFixed(2)} {p.currency}</p>
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
