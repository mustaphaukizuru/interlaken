import { useQuery } from '@tanstack/react-query';
import { Coffee, Bell } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useAuthStore } from '@/store/authStore';
import { portalApi } from '@/services/api';
import type { DashboardData } from '@/types';

export default function StudentDashboard() {
  const { user } = useAuthStore();
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
        <h1 className="text-xl font-bold text-slate-900">Hola, {user?.first_name}</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          {format(new Date(), "EEEE d 'de' MMMM, yyyy", { locale: es })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <StatCard
          title="Saldo cafetería"
          value={`$${parseFloat(data?.cafeteria_balance ?? '0').toFixed(2)}`}
          icon={Coffee}
          color={data?.is_low_balance ? 'amber' : 'brand'}
          trend={data?.is_low_balance ? 'Saldo bajo — solicita recarga' : undefined}
        />
        <StatCard
          title="Avisos"
          value={data?.unread_notifications ?? 0}
          icon={Bell}
          color="blue"
        />
      </div>

      {/* Student info */}
      <Card title="Mi información">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-400">Matrícula</p>
            <p className="text-sm font-semibold text-slate-900 mt-0.5">{data?.student_id ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Grado</p>
            <p className="text-sm font-semibold text-slate-900 mt-0.5">{data?.grade ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Grupo</p>
            <p className="text-sm font-semibold text-slate-900 mt-0.5">{data?.group ?? '—'}</p>
          </div>
        </div>
      </Card>

      {/* Announcements */}
      {data?.announcements && data.announcements.length > 0 && (
        <Card title="Avisos escolares">
          <div className="divide-y divide-slate-100">
            {data.announcements.map((a) => (
              <div key={a.id} className="py-3 first:pt-0 last:pb-0">
                <p className="text-sm font-medium text-slate-900">{a.title}</p>
                <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{a.body}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
