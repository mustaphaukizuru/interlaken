import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Users, ClipboardList, CreditCard, Coffee, RefreshCw, UserPlus, ArrowRight } from 'lucide-react';
import { StatCard } from '@/components/ui/StatCard';
import TopBar from '@/components/layout/TopBar';
import { portalApi } from '@/services/api';
import { CURRENT_CYCLE } from '@/lib/siteMeta';
import type { DashboardData } from '@/types';

export default function AdminDashboard() {
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => (await portalApi.getDashboard()).data,
  });

  return (
    <div className="-mt-6 -mx-[clamp(16px,4vw,32px)]">
      <TopBar title="Panel de Administración" subtitle={`Ciclo Escolar ${CURRENT_CYCLE}`} />
      <div className="px-[clamp(16px,4vw,32px)] py-6">
        {/* Stats */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 sm:gap-[18px]">
          {isLoading ? (
            [0, 1, 2, 3].map(i => <div key={i} className="skeleton h-[148px]" />)
          ) : (
            <>
              <StatCard title="Total Alumnos" value={data?.total_students ?? 0} icon={Users} color="purple" />
              <StatCard title="Pre-registros Pendientes" value={data?.pending_preregistrations ?? 0} icon={ClipboardList} color="pink" />
              <StatCard title="Ingresos del Mes" value={`$${parseFloat(data?.total_revenue ?? '0').toLocaleString('es-MX')}`} suffix="MXN" icon={CreditCard} color="green" />
              <StatCard title="Pagos Pendientes" value={data?.pending_payments ?? 0} icon={Coffee} color="green" />
            </>
          )}
        </div>

        {/* Quick actions */}
        <div className="mb-6 flex flex-wrap gap-3">
          <Link to="/admin/cafeteria" className="btn-green"><RefreshCw size={16} /> Sincronizar Loyverse</Link>
          <Link to="/admin/admisiones" className="btn bg-purple text-white"><UserPlus size={16} /> Nueva Admisión</Link>
          <Link to="/admin/alumnos" className="btn-outline"><Users size={16} /> Ver Alumnos</Link>
        </div>

        {/* Recent activity */}
        <div className="card !p-0 overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-cream px-5 py-4 sm:px-[22px]">
            <h2 className="font-head text-[15px] font-bold text-ink">Avisos Recientes</h2>
            <Link
              to="/admin/admisiones"
              className="flex items-center gap-1 whitespace-nowrap text-[12.5px] font-semibold text-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 rounded"
            >
              Ver admisiones <ArrowRight size={13} />
            </Link>
          </div>
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr className="bg-cream-2">
                  {['Concepto', 'Audiencia', 'Estatus', 'Fecha'].map(h => (
                    <th key={h} className="px-5 py-[11px] text-left font-head text-[11px] font-bold uppercase tracking-wider text-muted sm:px-[22px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.announcements ?? []).slice(0, 10).map((a, i) => (
                  <tr key={a.id} className={i === 0 ? '' : 'border-t border-cream'}>
                    <td className="px-5 py-[13px] text-[13.5px] font-semibold text-ink sm:px-[22px]">{a.title}</td>
                    <td className="px-5 py-[13px] text-[13px] capitalize text-muted sm:px-[22px]">{a.audience}</td>
                    <td className="px-5 py-[13px] sm:px-[22px]"><span className="badge-green">Publicado</span></td>
                    <td className="px-5 py-[13px] text-[13px] text-subtle sm:px-[22px]">{new Date(a.created_at).toLocaleDateString('es-MX')}</td>
                  </tr>
                ))}
                {!isLoading && !(data?.announcements ?? []).length && (
                  <tr><td colSpan={4} className="p-8 text-center text-[13px] text-subtle">Sin actividad reciente</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
