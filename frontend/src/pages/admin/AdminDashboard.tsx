import { useQuery } from '@tanstack/react-query';
import { Users, ClipboardList, CreditCard, TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { portalApi } from '@/services/api';
import type { DashboardData } from '@/types';

export default function AdminDashboard() {
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const { data } = await portalApi.getDashboard();
      return data;
    },
  });

  if (isLoading) return <LoadingSpinner size="lg" className="mt-20" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Panel de Administración</h1>
        <p className="text-slate-500 text-sm mt-0.5">Resumen general del sistema.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total alumnos" value={data?.total_students ?? 0} icon={Users} />
        <StatCard title="Pre-registros pendientes" value={data?.pending_preregistrations ?? 0} icon={ClipboardList} color="amber" />
        <StatCard title="Inscripciones en revisión" value={data?.pending_registrations ?? 0} icon={ClipboardList} color="blue" />
        <StatCard title="Pagos pendientes" value={data?.pending_payments ?? 0} icon={CreditCard} color="red" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card title="Ingresos confirmados">
          <div className="flex items-center gap-3 py-4">
            <div className="w-12 h-12 bg-brand-50 rounded-2xl flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-brand-600" />
            </div>
            <div>
              <p className="text-3xl font-bold text-slate-900">${parseFloat(data?.total_revenue ?? '0').toFixed(2)}</p>
              <p className="text-xs text-slate-400 mt-0.5">MXN · Pagos completados</p>
            </div>
          </div>
        </Card>

        {data?.announcements && data.announcements.length > 0 && (
          <Card title="Últimos avisos">
            <div className="divide-y divide-slate-100">
              {data.announcements.map((a) => (
                <div key={a.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-sm font-medium text-slate-900">{a.title}</p>
                  <p className="text-xs text-slate-400 mt-0.5 capitalize">{a.audience}</p>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
