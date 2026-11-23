import { lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Users, CreditCard, ArrowRight, Bell, Coffee, Activity } from 'lucide-react';
import { formatMXN } from '@/lib/format';
import { shortDate, shortDateTime } from '@/lib/tableFormat';
import { StatCard } from '@/components/ui/StatCard';
import { Reveal } from '@/components/ui/Reveal';
import { Badge } from '@/components/ui/Badge';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/layout/PageHeader';
import { PendingList } from '@/components/admin/PendingList';
import { activitySentence, actorLabel } from '@/components/admin/auditLabels';
import { portalApi } from '@/services/api';
import { cycleLabel, runningCycleStart } from '@/lib/siteMeta';
import { PriceYearsReminder } from '@/components/admin/pricing/PriceYearsReminder';
import { useAuthStore } from '@/store/authStore';
import { areasOf, canOpen } from '@/lib/areas';
import { AREA_LABEL } from '@/lib/areaCatalog';
import { audienceMeta } from '@/lib/status/AdminAnnouncementStatus';
import type { DashboardData } from '@/types';
import type { AnalyticsPayload } from '@/types/analytics';
import { DataTable } from '@/components/ui/DataTable';

// Recharts loads only when this dashboard renders (keeps it off the main bundle).
const ChartsSection = lazy(() => import('@/components/staff/ChartsSection'));

/** Quiet ways into the console (links, not competing buttons). */
const SHORTCUTS: { to: string; label: string }[] = [
  { to: '/admin/alumnos', label: 'Alumnos' },
  { to: '/admin/admisiones', label: 'Admisiones' },
  { to: '/admin/cafeteria', label: 'Cafetería' },
  { to: '/admin/comunicados', label: 'Comunicados' },
  { to: '/admin/contrasenas', label: 'Contraseñas' },
];

const linkCls = 'inline-flex min-h-[44px] items-center gap-1 rounded-sm text-[13px] font-semibold text-purple hover:text-purple-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 sm:min-h-0';

/** First day of this month, YYYY-MM-DD (the «Cobrado este mes» list). */
function monthStart(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function Shortcuts({ items }: { items: { to: string; label: string }[] }) {
  if (!items.length) return null;
  return (
    <nav aria-label="Accesos rápidos" className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-1">
      <span className="text-[13px] text-muted">Ir a:</span>
      {items.map((s) => (
        <Link key={s.to} to={s.to} className={linkCls}>{s.label}</Link>
      ))}
    </nav>
  );
}

/**
 * A staff account's home in the console: only the pending items of its areas
 * (GET /core/badges/ is scoped by the API) and its sections. No KPIs, charts
 * or audit trail: those are the admin's. Ready, not reachable yet: lib/areas.ts
 * keeps `/admin` admin-only (ConsoleAreaGuard sends staff to their first
 * section) until the console nav gives staff a «Pendientes» entry.
 */
function StaffPending() {
  const user = useAuthStore((s) => s.user);
  const areas = [...areasOf(user)];
  const sections = SHORTCUTS.concat([
    { to: '/admin/visitas', label: 'Visitas' },
    { to: '/admin/mensajes', label: 'Mensajes' },
    { to: '/admin/pagos', label: 'Pagos' },
  ]).filter((s) => canOpen(user, s.to));
  return (
    <>
      <PageHeader
        title="Pendientes"
        subtitle={areas.length ? `De sus áreas: ${areas.map((a) => AREA_LABEL[a]).join(', ')}` : undefined}
        breadcrumbs={false}
      />
      <PendingList />
      <Shortcuts items={sections} />
    </>
  );
}

export default function AdminDashboard() {
  const isStaff = useAuthStore((s) => s.user?.role === 'staff');
  return isStaff ? <StaffPending /> : <AdminHome />;
}

function AdminHome() {
  const { data, isLoading, isError, refetch } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => (await portalApi.getDashboard()).data,
  });

  const { data: analytics, isError: analyticsError, refetch: refetchAnalytics } = useQuery<AnalyticsPayload>({
    queryKey: ['staff-analytics', 30],
    queryFn: async () => (await portalApi.getStaffAnalytics(30)).data,
    staleTime: 60_000,
  });

  return (
    <>
      {/* The school year in progress (turns in August), not the one admissions announce. */}
      <PageHeader title="Panel de administración" subtitle={`Ciclo escolar ${cycleLabel(runningCycleStart())}`} />
      {/* «Faltan los precios del ciclo…»: once a day while Costos lacks next cycle's prices. */}
      <PriceYearsReminder />

      {/* Exceptions first (UX Phase 7): what is waiting, each a link to its list. */}
      <PendingList totals={{ verificar: data?.topups_to_verify_total, verificarCargadas: data?.topups_to_verify_loaded, aplicar: data?.paid_topups_to_apply_total }} />

      {/* Figures, not queues: each tile opens the list behind its number. */}
      {isError ? (
        <div className="card mb-6"><ErrorState onRetry={() => refetch()} /></div>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-[18px] lg:grid-cols-3">
          {isLoading ? (
            [0, 1, 2].map(i => <div key={i} className={`skeleton h-[148px] ${i === 2 ? 'col-span-2 lg:col-span-1' : ''}`} />)
          ) : (
            [
              <StatCard key="a" to="/admin/alumnos" title="Alumnos activos" value={data?.total_students ?? 0} icon={Users} color="purple" />,
              // Pupils and staff apart (2026-11-18): the staff wallets (three
              // institutional ones above $20,000) would distort the pupils' figure.
              <StatCard key="b" to="/admin/cafeteria" title="Saldo alumnos" value={formatMXN(data?.cafeteria_students_balance ?? data?.cafeteria_total_balance ?? 0)} icon={Coffee} color="green"
                subtitle={data?.cafeteria_staff_balance != null ? `Saldo personal: ${formatMXN(data.cafeteria_staff_balance)}${data.total_staff_accounts ? ` (${data.total_staff_accounts} ${data.total_staff_accounts === 1 ? 'cuenta' : 'cuentas'})` : ''}` : undefined} />,
              <StatCard key="c" to={`/admin/pagos?estado=success&desde=${monthStart()}`} title="Cobrado este mes" value={formatMXN(data?.total_revenue ?? 0)} icon={CreditCard} color="green" subtitle="Recargas en línea" />,
            ].map((card, i) => (
              <Reveal key={i} delay={i * 70} className={i === 2 ? 'col-span-2 lg:col-span-1' : undefined}>{card}</Reveal>
            ))
          )}
        </div>
      )}

      <Shortcuts items={SHORTCUTS} />

      {/* Analytics — reuses the staff chart suite (real data-viz on the landing) */}
      {analyticsError && !analytics && (
        <div className="card mb-6">
          <ErrorState title="No se pudieron cargar los indicadores" description="El resto del panel sigue disponible." onRetry={() => refetchAnalytics()} />
        </div>
      )}
      {analytics && (
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-head text-[15px] font-bold text-ink">Indicadores · últimos 30 días</h2>
            <Link to="/staff" className={linkCls}>
              Analítica completa <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <Suspense fallback={<div className="skeleton h-[280px] rounded-md" aria-hidden="true" />}>
            <ChartsSection data={analytics} />
          </Suspense>
        </div>
      )}

      {/* Large screens (P1-B10): activity and avisos side by side at 2xl */}
      <div className="grid gap-6 2xl:grid-cols-2">
        {/* Recent activity (audit trail), in words: «Ana López modificó un alumno». */}
        {!isError && data?.recent_activity && data.recent_activity.length > 0 && (
          <Reveal delay={40} className="card min-w-0 mb-6 2xl:mb-0">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-head text-[15px] font-bold text-ink"><Activity size={16} className="text-purple" aria-hidden="true" /> Actividad reciente</h2>
              <Link to="/admin/auditoria" className={linkCls}>Auditoría <ArrowRight size={16} aria-hidden="true" /></Link>
            </div>
            <ul className="divide-y divide-line text-sm">
              {data.recent_activity.map((a) => (
                <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2">
                  <span className="min-w-0 truncate text-ink">
                    <span className="font-semibold">{actorLabel(a.actor)}</span> {activitySentence(a.action, a.object_type)}
                    {a.context ? <span className="text-subtle"> · {a.context}</span> : null}
                  </span>
                  <span className="text-xs text-subtle">{shortDateTime(a.when)}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        )}

        {/* Recent announcements — admin-table stacks to cards on small screens */}
        {!isError && (
          <Reveal delay={60} className="card min-w-0 !p-0 overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 py-4 sm:px-[22px]">
              <h2 className="font-head text-[15px] font-bold text-ink">Avisos recientes</h2>
              <Link to="/admin/comunicados" className={linkCls}>
                Ver comunicados <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
            {isLoading ? (
              <div className="space-y-3 p-5">
                {[0, 1, 2].map((i) => <div key={i} className="skeleton h-14 rounded-sm" />)}
              </div>
            ) : !(data?.announcements ?? []).length ? (
              <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
                <Bell size={24} className="text-subtle" aria-hidden="true" />
                <p className="text-[13px] text-subtle">Sin avisos recientes</p>
              </div>
            ) : (
              <DataTable
                wrapClassName="border-0 !rounded-none"
                rows={(data?.announcements ?? []).slice(0, 10)}
                rowKey={(a) => a.id}
                columns={[
                  { header: 'Concepto', className: 'font-semibold text-ink', cell: (a) => a.title },
                  { header: 'Dirigido a', className: 'text-muted', cell: (a) => audienceMeta(a.audience).label },
                  { header: 'Estatus', cell: () => <Badge variant="success">Publicado</Badge> },
                  { header: 'Fecha', className: 'whitespace-nowrap text-subtle', cell: (a) => shortDate(a.created_at) },
                ]}
              />
            )}
          </Reveal>
        )}
      </div>
    </>
  );
}
