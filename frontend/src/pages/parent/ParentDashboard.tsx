import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Coffee, CreditCard, AlertTriangle, Users, ArrowRight, Bell } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useAuthStore } from '@/store/authStore';
import { portalApi } from '@/services/api';
import type { DashboardData } from '@/types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export default function ParentDashboard() {
  const { user } = useAuthStore();

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const { data } = await portalApi.getDashboard();
      return data;
    },
    staleTime: 1000 * 60 * 2,
  });

  if (isLoading) return <LoadingSpinner size="lg" className="mt-20" />;

  const hasLowBalance = data?.cafeteria_balances?.some((b) => b.low);
  const paymentStatusColor = (s: string) => {
    if (s === 'completed') return 'success';
    if (s === 'failed') return 'error';
    if (s === 'pending') return 'warning';
    return 'neutral';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          Bienvenido, {user?.first_name}
        </h1>
        <p className="text-slate-500 text-sm mt-0.5">
          {format(new Date(), "EEEE d 'de' MMMM, yyyy", { locale: es })}
        </p>
      </div>

      {/* Low balance alert */}
      {hasLowBalance && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-800">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 text-amber-500" />
          <div className="flex-1 text-sm">
            <strong>Saldo bajo en cafetería.</strong> Recargue el saldo para que su hijo/a pueda continuar usando los servicios.
          </div>
          <Link to="/portal/cafeteria" className="text-xs font-semibold text-amber-700 hover:underline whitespace-nowrap">
            Recargar →
          </Link>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Alumnos" value={data?.children_count ?? 0} icon={Users} />
        <StatCard
          title="Saldo cafetería"
          value={`$${data?.cafeteria_balances?.[0]?.balance ?? '0.00'}`}
          icon={Coffee}
          color={hasLowBalance ? 'amber' : 'brand'}
        />
        <StatCard
          title="Pagos pendientes"
          value={data?.recent_payments?.filter((p) => p.status === 'pending').length ?? 0}
          icon={CreditCard}
          color="blue"
        />
        <StatCard
          title="Avisos"
          value={data?.unread_notifications ?? 0}
          icon={Bell}
          color="amber"
        />
      </div>

      {/* Children */}
      {data?.children && data.children.length > 0 && (
        <Card title="Mis alumnos">
          <div className="divide-y divide-slate-100">
            {data.children.map((child) => {
              const balance = data.cafeteria_balances?.find((b) => b.student_name === child.name);
              return (
                <div key={child.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-brand-100 rounded-full flex items-center justify-center text-brand-700 font-semibold text-sm">
                      {child.name.split(' ')[0][0]}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-900">{child.name}</p>
                      <p className="text-xs text-slate-500">{child.grade} · Grupo {child.group} · ID {child.student_id}</p>
                    </div>
                  </div>
                  {balance && (
                    <Badge variant={balance.low ? 'warning' : 'success'}>
                      ${balance.balance}
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Two column: payments + announcements */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent payments */}
        <Card
          title="Últimos pagos"
          action={<Link to="/portal/pagos" className="text-xs text-brand-600 hover:underline flex items-center gap-1">Ver todos <ArrowRight className="w-3 h-3" /></Link>}
        >
          {!data?.recent_payments?.length ? (
            <p className="text-sm text-slate-400 text-center py-6">Sin pagos registrados</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.recent_payments.map((p) => (
                <div key={p.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-900 capitalize">{p.type}</p>
                    <p className="text-xs text-slate-400">{format(new Date(p.date), 'd MMM yyyy', { locale: es })}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-900">${p.amount}</p>
                    <Badge variant={paymentStatusColor(p.status) as any} className="mt-0.5">
                      {p.status === 'completed' ? 'Completado' : p.status === 'pending' ? 'Pendiente' : 'Fallido'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Announcements */}
        <Card title="Avisos escolares">
          {!data?.announcements?.length ? (
            <p className="text-sm text-slate-400 text-center py-6">Sin avisos</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.announcements.map((a) => (
                <div key={a.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-sm font-medium text-slate-900">{a.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{a.body}</p>
                  <p className="text-xs text-slate-300 mt-1">{format(new Date(a.created_at), 'd MMM', { locale: es })}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
