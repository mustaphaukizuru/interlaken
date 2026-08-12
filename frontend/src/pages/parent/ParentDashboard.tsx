import { lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Coffee, CreditCard, AlertTriangle, GraduationCap, Bell, ArrowRight, Receipt, UserCircle, MessageCircle, QrCode } from 'lucide-react';
import { StatCard } from '@/components/ui/StatCard';
import { SectionCard, SectionEmpty } from '@/components/ui/SectionCard';
import { Reveal } from '@/components/ui/Reveal';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/layout/PageHeader';
import { ChildSwitcher } from '@/components/portal/ChildSwitcher';
import { useAuthStore } from '@/store/authStore';
import { useSelectedChildStore } from '@/store/selectedChildStore';
import { portalApi } from '@/services/api';
import { useAnnouncementsRead } from '@/hooks/useAnnouncementsRead';
import { PushOptIn } from '@/components/portal/PushOptIn';
import type { DashboardData } from '@/types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

// Recharts (heavy) stays out of the dashboard's main chunk — loaded only when a
// cafeteria-using family renders the trend.
const CafeteriaTrendCard = lazy(() => import('@/components/portal/CafeteriaTrendCard'));
const CafeteriaCategoriesCard = lazy(() => import('@/components/portal/CafeteriaCategoriesCard'));

const payBadge = (s: string) => {
  if (s === 'success' || s === 'completed') return { cls: 'badge-green', label: 'Completado' };
  if (s === 'refunded') return { cls: 'badge-green', label: 'Devuelto' };
  if (s === 'failed') return { cls: 'badge-pink', label: 'Fallido' };
  if (s === 'processing') return { cls: 'badge-purple', label: 'Procesando' };
  return { cls: 'badge-amber', label: 'Pendiente' };
};

const paymentTypeLabel: Record<string, string> = {
  tuition: 'Colegiatura', enrollment: 'Inscripción', cafeteria: 'Cafetería', other: 'Otro',
};

export default function ParentDashboard() {
  const { user } = useAuthStore();
  const childId = useSelectedChildStore((s) => s.childId);
  const { data, isLoading, isError, refetch } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => (await portalApi.getDashboard()).data,
    staleTime: 1000 * 60 * 2,
  });

  useAnnouncementsRead(data?.announcements);

  const children = data?.children ?? [];
  const needsFamilyLink = Boolean(data?.needs_family_link) || (!isLoading && !isError && children.length === 0);
  const selectedChild = children.find((c) => c.id === childId) ?? children[0];
  const totalBalance = (data?.cafeteria_balances ?? []).reduce((s, b) => s + parseFloat(b.balance || '0'), 0);
  const hasLowBalance = data?.cafeteria_balances?.some(b => b.low);
  // Prefer invoice summary from the API; never infer from recent Payment stubs.
  const pendingInvoices = data?.pending_invoices ?? 0;

  return (
    <>
      <PageHeader
        title={`Bienvenido/a, ${user?.first_name ?? ''}`}
        subtitle={`Portal Familiar${selectedChild ? ` · ${selectedChild.name}` : ''}`}
      />

      {children.length > 1 && (
        <div className="mb-5">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-subtle">Alumno</p>
          <ChildSwitcher students={children} />
        </div>
      )}

        {/* Web-push opt-in (renders only when supported and not yet enabled) */}
        <div className="mb-5">
          <PushOptIn />
        </div>

        {isError ? (
          <div className="card"><ErrorState onRetry={() => refetch()} /></div>
        ) : isLoading ? (
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 sm:gap-[18px]">
            {[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-[148px]" />)}
          </div>
        ) : needsFamilyLink ? (
          <>
            <div className="card mb-6">
              <EmptyState
                icon={GraduationCap}
                title="Cuenta sin alumno vinculado"
                description="Su acceso está activo, pero el colegio aún no ha vinculado un alumno a este correo. Contacte a administración para completar el vínculo; mientras tanto puede actualizar sus datos."
                action={
                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                    <Link to="/contacto" className="btn-pink inline-flex min-h-[44px] items-center justify-center gap-2 text-sm">
                      <MessageCircle size={15} aria-hidden="true" /> Contactar al colegio
                    </Link>
                    <Link to="/portal/perfil" className="btn-outline inline-flex min-h-[44px] items-center justify-center gap-2 text-sm">
                      <UserCircle size={15} aria-hidden="true" /> Mi información
                    </Link>
                  </div>
                }
              />
            </div>
            <Reveal delay={40}>
              <SectionCard title="Avisos Escolares" action={{ to: '/portal/comunicados', label: 'Ver todos' }}>
                {!data?.announcements?.length ? (
                  <SectionEmpty icon={Bell}>Sin avisos</SectionEmpty>
                ) : (
                  <div>
                    {data.announcements.slice(0, 4).map((a, i) => (
                      <Link
                        key={a.id}
                        to={`/portal/comunicados/${a.id}`}
                        className={`block px-5 py-[13px] transition hover:bg-cream/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple/30 ${i === 0 ? '' : 'border-t border-cream'}`}
                      >
                        <div className="text-[13.5px] font-semibold text-ink">{a.title}</div>
                        <div className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{a.body}</div>
                        <div className="mt-1 text-[11.5px] text-subtle">{format(new Date(a.created_at), 'd MMM', { locale: es })}</div>
                      </Link>
                    ))}
                  </div>
                )}
              </SectionCard>
            </Reveal>
          </>
        ) : (
        <>
        {/* Low balance alert */}
        {hasLowBalance && (
          <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-amber/30 bg-amber/[0.07] px-4 py-3.5 sm:flex-row sm:items-center sm:px-[18px]">
            <AlertTriangle size={20} className="shrink-0 text-amber" />
            <div className="flex-1 text-[13.5px] text-ink">
              <strong className="font-semibold text-amber">Saldo bajo en cafetería.</strong> Recargue el saldo para continuar usando los servicios.
            </div>
            <Link
              to="/portal/cafeteria"
              className="whitespace-nowrap rounded text-[12.5px] font-bold text-amber focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/40"
            >
              Recargar →
            </Link>
          </div>
        )}

        {/* Stats */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 sm:gap-[18px]">
          {[
            <StatCard key="a" title="Alumnos" value={data?.children_count ?? data?.children?.length ?? 0} icon={GraduationCap} color="purple" />,
            <StatCard key="b" title="Saldo Cafetería" value={`$${totalBalance.toFixed(2)}`} icon={Coffee} color={hasLowBalance ? 'amber' : 'green'} />,
            <StatCard key="c" title="Colegiaturas pendientes" value={pendingInvoices} icon={CreditCard} color="coral" />,
            <StatCard key="d" title="Avisos" value={data?.unread_notifications ?? data?.announcements?.length ?? 0} icon={Bell} color="pink" />,
          ].map((card, i) => (
            <Reveal key={i} delay={i * 70}>{card}</Reveal>
          ))}
        </div>

        {/* Quick actions — the things parents do most */}
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <QuickAction to="/portal/colegiaturas" icon={Receipt} title="Pagar colegiaturas" desc="Consulta y paga las mensualidades." gradient="from-pink to-purple" />
          <QuickAction to="/portal/cafeteria" icon={Coffee} title="Recargar cafetería" desc="Agrega saldo con tarjeta." gradient="from-green to-green-dark" />
          <QuickAction to="/portal/credencial" icon={QrCode} title="Credencial digital" desc="Código para pagar en caja." gradient="from-purple to-pink" />
        </div>

        <Link
          to="/portal/perfil"
          className="mb-6 flex items-center gap-2 text-[13px] font-medium text-muted transition-colors hover:text-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/30 rounded"
        >
          <UserCircle size={16} className="text-subtle" aria-hidden="true" />
          Mi información y preferencias
          <ArrowRight size={14} className="text-subtle" aria-hidden="true" />
        </Link>

        {/* Cafeteria spending trend + category breakdown — cafeteria families only */}
        {!!data?.cafeteria_balances?.length && (
          <Reveal delay={20} className="mb-6">
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <Suspense fallback={<div className="skeleton h-[300px] rounded-xl2" aria-hidden="true" />}>
                <CafeteriaTrendCard />
              </Suspense>
              <Suspense fallback={<div className="skeleton h-[300px] rounded-xl2" aria-hidden="true" />}>
                <CafeteriaCategoriesCard student={childId ?? 'all'} />
              </Suspense>
            </div>
          </Reveal>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Recent payments */}
          <Reveal delay={40} className="h-full">
            <SectionCard title="Últimos Pagos" action={{ to: '/portal/pagos', label: 'Ver todos' }} className="h-full">
              {!data?.recent_payments?.length ? (
                <SectionEmpty icon={Receipt}>Sin pagos registrados</SectionEmpty>
              ) : (
                <div>
                  {data.recent_payments.slice(0, 5).map((p, i) => {
                    const b = payBadge(p.status);
                    return (
                      <div key={p.id} className={`flex items-center justify-between px-5 py-[13px] ${i === 0 ? '' : 'border-t border-cream'}`}>
                        <div>
                          <div className="text-[13.5px] font-semibold text-ink">{paymentTypeLabel[p.type] ?? p.type}</div>
                          <div className="text-[12px] text-subtle">{format(new Date(p.date), 'd MMM yyyy', { locale: es })}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-head text-[14px] font-bold text-ink">${p.amount}</div>
                          <span className={`${b.cls} mt-[3px]`}>{b.label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>
          </Reveal>

          {/* Announcements */}
          <Reveal delay={110} className="h-full">
            <SectionCard title="Avisos Escolares" action={{ to: '/portal/comunicados', label: 'Ver todos' }} className="h-full">
              {!data?.announcements?.length ? (
                <SectionEmpty icon={Bell}>Sin avisos</SectionEmpty>
              ) : (
                <div>
                  {data.announcements.slice(0, 4).map((a, i) => (
                    <Link
                      key={a.id}
                      to={`/portal/comunicados/${a.id}`}
                      className={`block px-5 py-[13px] transition hover:bg-cream/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple/30 ${i === 0 ? '' : 'border-t border-cream'}`}
                    >
                      <div className="text-[13.5px] font-semibold text-ink">{a.title}</div>
                      <div className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{a.body}</div>
                      <div className="mt-1 text-[11.5px] text-subtle">{format(new Date(a.created_at), 'd MMM', { locale: es })}</div>
                    </Link>
                  ))}
                </div>
              )}
            </SectionCard>
          </Reveal>
        </div>
        </>
        )}
    </>
  );
}

function QuickAction({ to, icon: Icon, title, desc, gradient }: {
  to: string; icon: any; title: string; desc: string; gradient: string;
}) {
  return (
    <Link
      to={to}
      className="hover-lift group flex items-center gap-4 rounded-xl2 border border-line bg-white p-5 shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
    >
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${gradient} text-white`}>
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
