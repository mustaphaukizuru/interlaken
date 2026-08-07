import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CreditCard, CheckCircle, Clock, XCircle, Receipt, Coffee, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/layout/PageHeader';
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
  // Key MUST match the backend Payment.Status values ('success', not
  // 'completed') — otherwise a paid payment falls through to the 'pending'
  // default and shows "Pendiente".
  success:    { label: 'Completado',  variant: 'success', icon: CheckCircle },
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

/** Pagos is a HUB: real payments happen in Colegiaturas (invoice-linked) and
 * Cafetería (top-up-linked), each with gateway selection + secure redirect. The
 * old free-amount "Realizar pago" modal never redirected, so it created orphan
 * PENDING rows that settled nothing — it's replaced by these action cards. */
export default function PaymentsPage() {
  const { data: payments, isLoading, isError, refetch } = useQuery<Payment[]>({
    queryKey: ['payments'],
    queryFn: async () => {
      const { data } = await paymentsApi.getMyPayments();
      return data.results ?? data;
    },
  });

  return (
    <>
      <PageHeader title="Pagos" subtitle="Realiza pagos con tarjeta y consulta tu historial." />

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <ActionCard
          to="/portal/colegiaturas"
          icon={Receipt}
          title="Pagar colegiaturas"
          desc="Consulta y paga las mensualidades de tus hijos con tarjeta."
          gradient="from-pink to-purple"
        />
        <ActionCard
          to="/portal/cafeteria"
          icon={Coffee}
          title="Recargar cafetería"
          desc="Agrega saldo a la cuenta de cafetería de tus hijos."
          gradient="from-green to-green-dark"
        />
      </div>

      <Card title="Historial de pagos">
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
    </>
  );
}

function ActionCard({ to, icon: Icon, title, desc, gradient }: {
  to: string; icon: any; title: string; desc: string; gradient: string;
}) {
  return (
    <Link
      to={to}
      className="hover-lift group flex items-center gap-4 rounded-xl2 border border-line bg-white p-5 shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
    >
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${gradient} text-white shadow-purple`}>
        <Icon className="h-6 w-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-head text-base font-bold text-ink">{title}</span>
        <span className="mt-0.5 block text-sm text-muted">{desc}</span>
      </span>
      <ArrowRight className="h-5 w-5 shrink-0 text-subtle transition group-hover:translate-x-1 group-hover:text-purple" />
    </Link>
  );
}
