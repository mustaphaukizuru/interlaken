import { lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Users, ClipboardList, CreditCard, RefreshCw, UserPlus, ArrowRight, Bell, Coffee, AlertTriangle, CalendarClock, Inbox, KeyRound, Activity } from 'lucide-react';
import { formatMXN } from '@/lib/format';
import { StatCard } from '@/components/ui/StatCard';
import { Reveal } from '@/components/ui/Reveal';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/layout/PageHeader';
import { portalApi } from '@/services/api';
import { CURRENT_CYCLE } from '@/lib/siteMeta';
import type { DashboardData } from '@/types';
import type { AnalyticsPayload } from '@/types/analytics';

// Recharts loads only when this dashboard renders (keeps it off the main bundle).
const ChartsSection = lazy(() => import('@/components/staff/ChartsSection'));

export default function AdminDashboard() {
  const { data, isLoading, isError, refetch } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => (await portalApi.getDashboard()).data,
  });

  const { data: analytics } = useQuery<AnalyticsPayload>({
    queryKey: ['staff-analytics', 30],
    queryFn: async () => (await portalApi.getStaffAnalytics(30)).data,
    staleTime: 60_000,
  });

  return (
    <>
      <PageHeader title="Panel de Administración" subtitle={`Ciclo Escolar ${CURRENT_CYCLE}`} />
        {/* Stats */}
        {isError ? (
          <div className="card mb-6"><ErrorState onRetry={() => refetch()} /></div>
        ) : (
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 sm:gap-[18px]">
            {isLoading ? (
              [0, 1, 2, 3, 4, 5, 6, 7].map(i => <div key={i} className="skeleton h-[148px]" />)
            ) : (
              [
                <StatCard key="a" title="Alumnos activos" value={data?.total_students ?? 0} icon={Users} color="purple" />,
                <StatCard key="b" title="Saldo total cafetería" value={formatMXN(data?.cafeteria_total_balance ?? 0)} icon={Coffee} color="green" />,
                <StatCard key="c" title="Saldos bajos" value={data?.low_balance_count ?? 0} icon={AlertTriangle} color="amber" subtitle="alumnos bajo su umbral" />,
                <StatCard key="d" title="Recargas por aplicar" value={data?.pending_topups ?? 0} icon={Coffee} color="coral" subtitle="pagos en caja" />,
                <StatCard key="e" title="Cobrado este mes" value={formatMXN(data?.total_revenue ?? 0)} icon={CreditCard} color="green" subtitle="recargas en línea" />,
                <StatCard key="f" title="Admisiones en cola" value={(data?.pending_preregistrations ?? 0) + (data?.pending_registrations ?? 0)} icon={ClipboardList} color="pink" subtitle={`${data?.pending_preregistrations ?? 0} pre-registros · ${data?.pending_registrations ?? 0} inscripciones`} />,
                <StatCard key="g" title="Visitas hoy" value={data?.visits_today ?? 0} icon={CalendarClock} color="purple" />,
                <StatCard key="h" title="Por atender" value={(data?.unhandled_messages ?? 0) + (data?.open_password_requests ?? 0)} icon={Inbox} color="amber" subtitle={`${data?.unhandled_messages ?? 0} mensajes · ${data?.open_password_requests ?? 0} contraseñas`} />,
              ].map((card, i) => (
                <Reveal key={i} delay={i * 70}>{card}</Reveal>
              ))
            )}
          </div>
        )}

        {/* Quick actions — green = ops, pink = admissions; no improvised solid fills */}
        <div className="mb-6 flex flex-wrap gap-3">
          <Link to="/admin/cafeteria" className="btn-green"><RefreshCw size={16} /> Sincronizar Loyverse</Link>
          <Link to="/admin/admisiones" className="btn-pink"><UserPlus size={16} /> Nueva Admisión</Link>
          <Link to="/admin/alumnos" className="btn-outline"><Users size={16} /> Ver Alumnos</Link>
          <Link to="/admin/comunicados" className="btn-outline"><Bell size={16} /> Comunicados</Link>
          <Link to="/admin/contrasenas" className="btn-outline"><KeyRound size={16} /> Contraseñas</Link>
        </div>

        {/* Analytics — reuses the staff chart suite (real data-viz on the landing) */}
        {analytics && (
          <div className="mb-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-head text-[15px] font-bold text-ink">Indicadores · últimos 30 días</h2>
              <Link to="/staff" className="flex items-center gap-1 whitespace-nowrap text-[12.5px] font-semibold text-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 rounded">
                Analítica completa <ArrowRight size={13} />
              </Link>
            </div>
            <Suspense fallback={<div className="skeleton h-[280px] rounded-xl2" aria-hidden="true" />}>
              <ChartsSection data={analytics} />
            </Suspense>
          </div>
        )}

        {/* Recent activity (audit trail) */}
        {!isError && data?.recent_activity && data.recent_activity.length > 0 && (
          <Reveal delay={40} className="card mb-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-head text-[15px] font-bold text-ink"><Activity size={16} className="text-purple" aria-hidden="true" /> Actividad reciente</h2>
              <Link to="/admin/auditoria" className="flex items-center gap-1 text-[12.5px] font-semibold text-purple">Auditoría <ArrowRight size={13} /></Link>
            </div>
            <ul className="divide-y divide-cream text-sm">
              {data.recent_activity.map((a) => (
                <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2">
                  <span className="min-w-0 truncate text-ink"><span className="font-semibold">{a.actor}</span> · {a.action} · {a.object_type.split('.').pop()} #{a.object_id}{a.context ? <span className="text-subtle"> · {a.context}</span> : null}</span>
                  <span className="text-xs text-subtle">{new Date(a.when).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        )}

        {/* Recent announcements — admin-table stacks to cards on small screens */}
        {!isError && (
        <Reveal delay={60} className="card !p-0 overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-cream px-5 py-4 sm:px-[22px]">
            <h2 className="font-head text-[15px] font-bold text-ink">Avisos Recientes</h2>
            <Link
              to="/admin/comunicados"
              className="flex items-center gap-1 whitespace-nowrap text-[12.5px] font-semibold text-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 rounded"
            >
              Ver comunicados <ArrowRight size={13} />
            </Link>
          </div>
          {isLoading ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2].map((i) => <div key={i} className="skeleton h-14 rounded-xl" />)}
            </div>
          ) : !(data?.announcements ?? []).length ? (
            <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
              <Bell className="h-6 w-6 text-subtle" aria-hidden="true" />
              <p className="text-[13px] text-subtle">Sin actividad reciente</p>
            </div>
          ) : (
            <div className="admin-table-wrap border-0 !rounded-none">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Concepto</th>
                    <th>Audiencia</th>
                    <th>Estatus</th>
                    <th>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.announcements ?? []).slice(0, 10).map((a) => (
                    <tr key={a.id}>
                      <td data-label="Concepto" className="font-semibold text-ink">{a.title}</td>
                      <td data-label="Audiencia" className="capitalize text-muted">{a.audience}</td>
                      <td data-label="Estatus"><span className="badge-green">Publicado</span></td>
                      <td data-label="Fecha" className="text-subtle">
                        {new Date(a.created_at).toLocaleDateString('es-MX')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Reveal>
        )}
    </>
  );
}
