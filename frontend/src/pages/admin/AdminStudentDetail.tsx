import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Coffee, Receipt, CheckCircle, Clock, AlertTriangle, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/layout/PageHeader';
import { StudentDiscounts } from '@/components/admin/StudentDiscounts';
import { financeApi } from '@/services/api';

const statusMeta: Record<string, { label: string; variant: any; icon: any }> = {
  paid:      { label: 'Pagada',    variant: 'success', icon: CheckCircle },
  pending:   { label: 'Pendiente', variant: 'warning', icon: Clock },
  overdue:   { label: 'Vencida',   variant: 'error',   icon: AlertTriangle },
  cancelled: { label: 'Cancelada', variant: 'neutral', icon: XCircle },
};

interface Ledger {
  student: { id: number; name: string; student_code: string; grade: string };
  outstanding: string;
  invoices: {
    id: number; period_label: string; amount: string; balance_due: string;
    currency: string; status: string; due_date: string;
  }[];
}

export default function AdminStudentDetail() {
  const { studentId } = useParams();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-student-ledger', studentId],
    queryFn: async () => (await financeApi.getStudentLedger(Number(studentId))).data as Ledger,
    enabled: !!studentId,
  });

  const s = data?.student;
  const outstanding = parseFloat(data?.outstanding ?? '0');

  return (
    <>
      <Link to="/admin/alumnos" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Alumnos
      </Link>

      <PageHeader
        title={s?.name ?? 'Alumno'}
        subtitle={s ? `Matrícula ${s.student_code} · ${s.grade}` : undefined}
        actions={s && (
          <Link to={`/admin/cafeteria/${s.id}`} className="btn-outline">
            <Coffee size={16} aria-hidden="true" /> Cafetería
          </Link>
        )}
      />

      {/* Summary */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-subtle">Saldo de colegiaturas</p>
          <p className={`mt-1 font-head text-2xl font-bold ${outstanding > 0 ? 'text-coral' : 'text-green-dark'}`}>
            ${outstanding.toFixed(2)}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-subtle">Facturas</p>
          <p className="mt-1 font-head text-2xl font-bold text-ink">{data?.invoices?.length ?? 0}</p>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-subtle">Pagadas</p>
          <p className="mt-1 font-head text-2xl font-bold text-ink">
            {data?.invoices?.filter((i) => i.status === 'paid').length ?? 0}
          </p>
        </Card>
      </div>

      <Card title="Colegiaturas">
        {isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : isLoading ? (
          <ListSkeleton />
        ) : !data?.invoices?.length ? (
          <EmptyState icon={Receipt} title="Sin colegiaturas" description="Aún no se han emitido colegiaturas para este alumno." />
        ) : (
          <div className="divide-y divide-cream">
            {data.invoices.map((inv) => {
              const meta = statusMeta[inv.status] ?? statusMeta.pending;
              const Icon = meta.icon;
              return (
                <div key={inv.id} className="flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cream">
                      <Icon className="h-4 w-4 text-muted" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{inv.period_label}</p>
                      <p className="text-xs text-subtle">
                        Vence {format(new Date(inv.due_date), "d MMM yyyy", { locale: es })}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-ink">${parseFloat(inv.amount).toFixed(2)} {inv.currency}</p>
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {s && <div className="mt-6"><StudentDiscounts studentId={s.id} /></div>}
    </>
  );
}
