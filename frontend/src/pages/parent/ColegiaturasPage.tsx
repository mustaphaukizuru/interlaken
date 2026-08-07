import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Receipt, CheckCircle, Clock, AlertTriangle, XCircle, Download, CreditCard,
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
import { PaymentMethodPicker } from '@/components/ui/PaymentMethodPicker';
import { financeApi, downloadBlob } from '@/services/api';
import type { Invoice } from '@/types';

const statusMeta: Record<string, { label: string; variant: any; icon: any }> = {
  paid:      { label: 'Pagada',    variant: 'success', icon: CheckCircle },
  pending:   { label: 'Pendiente', variant: 'warning', icon: Clock },
  overdue:   { label: 'Vencida',   variant: 'error',   icon: AlertTriangle },
  cancelled: { label: 'Cancelada', variant: 'neutral', icon: XCircle },
};

export default function ColegiaturasPage() {
  const queryClient = useQueryClient();
  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null);
  const [gateway, setGateway] = useState('global_payments');

  const { data: invoices, isLoading, isError, refetch } = useQuery<Invoice[]>({
    queryKey: ['invoices'],
    queryFn: async () => {
      const { data } = await financeApi.getInvoices();
      return data.results ?? data;
    },
  });

  const payMutation = useMutation({
    mutationFn: () => financeApi.payInvoice(payInvoice!.id, gateway),
    onSuccess: ({ data }) => {
      if (data?.redirect_url) {
        toast.success('Redirigiendo a la pasarela de pago…');
        window.location.href = data.redirect_url;
        return;
      }
      setPayInvoice(null);
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.error || 'No fue posible iniciar el pago.'),
  });

  const receiptMutation = useMutation({
    mutationFn: (invoice: Invoice) => financeApi.downloadReceipt(invoice.id),
    onSuccess: ({ data }, invoice) => {
      downloadBlob(data, `colegiatura_${invoice.student_code}_${invoice.period}.pdf`);
    },
    onError: () => toast.error('No fue posible descargar el comprobante.'),
  });

  const outstanding = (invoices ?? [])
    .filter((i) => i.status !== 'paid' && i.status !== 'cancelled')
    .reduce((sum, i) => sum + Math.max(0, parseFloat(i.balance_due)), 0);

  // Overpayments show as negative balance_due — surface as credit (saldo a favor).
  const creditTotal = (invoices ?? [])
    .reduce((sum, i) => {
      const due = parseFloat(i.balance_due);
      return due < 0 ? sum + (-due) : sum;
    }, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-head text-fluid-xl font-bold leading-tight tracking-[-0.3px] text-ink">Colegiaturas</h1>
          <p className="mt-0.5 text-fluid-sm text-muted">
            Consulte y pague las colegiaturas mensuales de sus hijos.
          </p>
        </div>
        <div className="flex flex-col gap-1 sm:items-end">
          {outstanding > 0 && (
            <div className="sm:text-right">
              <p className="text-xs text-subtle">Saldo pendiente</p>
              <p className="text-fluid-lg font-bold text-coral">${outstanding.toFixed(2)} MXN</p>
            </div>
          )}
          {creditTotal > 0 && (
            <p className="text-xs font-medium text-green-700">
              Saldo a favor: ${creditTotal.toFixed(2)} MXN
            </p>
          )}
        </div>
      </div>

      {/* Pay modal */}
      <Modal open={!!payInvoice} onClose={() => setPayInvoice(null)} title="Pagar colegiatura">
        {payInvoice && (
          <div className="space-y-4">
            <div className="rounded-xl bg-cream p-4 text-sm">
              <div className="flex justify-between gap-3"><span className="text-muted">Alumno</span><span className="font-medium text-ink">{payInvoice.student_name}</span></div>
              <div className="mt-1 flex justify-between gap-3"><span className="text-muted">Periodo</span><span className="font-medium text-ink">{payInvoice.period_label}</span></div>
              <div className="mt-1 flex justify-between gap-3"><span className="text-muted">Monto a pagar</span><span className="font-bold text-ink">${parseFloat(payInvoice.balance_due).toFixed(2)} {payInvoice.currency}</span></div>
            </div>
            <PaymentMethodPicker value={gateway} onChange={setGateway} disabled={payMutation.isPending} />
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="secondary" onClick={() => setPayInvoice(null)} className="min-h-[44px] flex-1 focus-visible:ring-2 focus-visible:ring-purple/40">Cancelar</Button>
              <Button loading={payMutation.isPending} onClick={() => payMutation.mutate()} className="min-h-[44px] flex-1 focus-visible:ring-2 focus-visible:ring-purple/40">
                <CreditCard className="w-4 h-4" /> Pagar ${parseFloat(payInvoice.balance_due).toFixed(2)}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Invoice list */}
      <Card>
        {isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : isLoading ? (
          <ListSkeleton />
        ) : !invoices?.length ? (
          <EmptyState icon={Receipt} title="Sin colegiaturas" description="Las colegiaturas emitidas aparecerán aquí." />
        ) : (
          <div className="divide-y divide-cream">
            {invoices.map((inv) => {
              const meta = statusMeta[inv.status] ?? statusMeta.pending;
              const Icon = meta.icon;
              const balanceDue = parseFloat(inv.balance_due);
              const hasCredit = balanceDue < 0;
              const payable = (inv.status === 'pending' || inv.status === 'overdue') && balanceDue > 0;
              return (
                <div key={inv.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-cream">
                      <Icon className="h-4 w-4 text-muted" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {inv.period_label} · {inv.student_name}
                      </p>
                      <p className="text-xs text-subtle">
                        Vence {format(new Date(inv.due_date), "d 'de' MMMM yyyy", { locale: es })}
                      </p>
                      {hasCredit && (
                        <p className="mt-0.5 text-xs font-medium text-green-700">
                          Saldo a favor ${(-balanceDue).toFixed(2)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center justify-between gap-4 pl-12 sm:justify-end sm:pl-0">
                    <div className="text-right">
                      <p className="text-sm font-bold text-ink">${parseFloat(inv.amount).toFixed(2)} {inv.currency}</p>
                      <Badge variant={hasCredit ? 'success' : meta.variant}>
                        {hasCredit ? 'Saldo a favor' : meta.label}
                      </Badge>
                    </div>
                    {payable && (
                      <Button size="sm" onClick={() => { setPayInvoice(inv); setGateway('global_payments'); }} className="min-h-[44px] focus-visible:ring-2 focus-visible:ring-purple/40">
                        Pagar
                      </Button>
                    )}
                    {inv.status === 'paid' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={receiptMutation.isPending && receiptMutation.variables?.id === inv.id}
                        onClick={() => receiptMutation.mutate(inv)}
                        className="min-h-[44px] focus-visible:ring-2 focus-visible:ring-purple/40"
                      >
                        <Download className="w-4 h-4" /> Recibo
                      </Button>
                    )}
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
