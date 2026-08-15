import { lazy, Suspense, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Coffee, AlertTriangle, GraduationCap, Bell, ArrowRight, Receipt, UserCircle,
  MessageCircle, QrCode, Plus, RefreshCw,
} from 'lucide-react';
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
import { InstallHint } from '@/components/portal/InstallHint';
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

/** Dashboard quick top-up amounts; CafeteriaPage reads `?recarga=<amount>`. */
const QUICK_TOPUP_AMOUNTS = [100, 200, 500];

/** es-MX time-of-day greeting. Exported for tests. */
export function greetingForHour(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Buenos días';
  if (hour >= 12 && hour < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

/** Re-render every minute so the "Actualizado hace X min" hint stays honest. */
function useMinuteTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);
}

export default function ParentDashboard() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const childId = useSelectedChildStore((s) => s.childId);
  const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => (await portalApi.getDashboard()).data,
    staleTime: 1000 * 60 * 2,
  });

  useAnnouncementsRead(data?.announcements);
  useMinuteTick();

  const children = data?.children ?? [];
  const needsFamilyLink = Boolean(data?.needs_family_link) || (!isLoading && !isError && children.length === 0);
  const selectedChild = children.find((c) => c.id === childId) ?? children[0];
  const balances = data?.cafeteria_balances ?? [];
  const totalBalance = balances.reduce((s, b) => s + parseFloat(b.balance || '0'), 0);
  const hasLowBalance = balances.some((b) => b.low);
  const hasCafeteria = balances.length > 0;
  const unread = data?.unread_notifications ?? 0;

  const now = new Date();
  const todayLine = format(now, "EEEE d 'de' MMMM 'de' yyyy", { locale: es });
  const todayCapitalized = todayLine.charAt(0).toUpperCase() + todayLine.slice(1);

  const updatedMins = dataUpdatedAt
    ? Math.max(0, Math.floor((Date.now() - dataUpdatedAt) / 60_000))
    : null;
  const updatedLabel = updatedMins == null
    ? null
    : updatedMins < 1
      ? 'Actualizado hace un momento'
      : `Actualizado hace ${updatedMins} min`;

  return (
    <>
      <PageHeader
        title={`${greetingForHour(now.getHours())}, ${user?.first_name ?? ''}`}
        subtitle={`${todayCapitalized}${selectedChild ? ` · ${selectedChild.name}` : ''}`}
        actions={
          <div className="flex items-center gap-2.5">
            {updatedLabel && <span className="text-[11.5px] text-subtle">{updatedLabel}</span>}
            <button
              type="button"
              aria-label="Actualizar"
              onClick={() => queryClient.invalidateQueries({ queryKey: ['dashboard'] })}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-white text-muted shadow-card transition hover:border-purple/25 hover:text-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
            >
              <RefreshCw size={16} className={isFetching ? 'animate-spin' : undefined} aria-hidden="true" />
            </button>
          </div>
        }
      />

      {isError ? (
        <div className="card"><ErrorState onRetry={() => refetch()} /></div>
      ) : isLoading ? (
        /* Per-card skeletons mirroring the final layout: hero + stat, quick actions, section cards. */
        <div aria-busy="true" aria-label="Cargando panel">
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-[18px]">
            <div className="skeleton h-[176px] rounded-xl2 sm:col-span-2" />
            <div className="skeleton h-[176px] rounded-xl2" />
          </div>
          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            {[0, 1].map((i) => <div key={i} className="skeleton h-[92px] rounded-xl2" />)}
          </div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {[0, 1].map((i) => <div key={i} className="skeleton h-[280px] rounded-xl2" />)}
          </div>
        </div>
      ) : needsFamilyLink ? (
        <>
          <div className="mb-5 space-y-3">
            <InstallHint />
            <PushOptIn />
          </div>
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
            <AnnouncementsCard announcements={data?.announcements} unread={unread} />
          </Reveal>
        </>
      ) : (
      <>
      {/* 1. Low balance alert */}
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

      {/* 2. Child switcher */}
      {children.length > 1 && (
        <div className="mb-5">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-subtle">Alumno</p>
          <ChildSwitcher students={children} />
        </div>
      )}

      {/* 3. Cafetería saldo + quick top-up (or wallet explainer for families without activity) */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-[18px]">
        <Reveal className="sm:col-span-2" delay={0}>
          {hasCafeteria ? (
            <CafeteriaSaldoCard total={totalBalance} low={!!hasLowBalance} studentsCount={balances.length} />
          ) : (
            <div className="card h-full">
              <EmptyState
                icon={Coffee}
                title="Monedero de cafetería"
                description="Cada alumno cuenta con un monedero digital para comprar en la cafetería escolar sin efectivo. Su familia aún no tiene saldo ni movimientos: cuando el colegio active el servicio, aquí podrá recargar en línea y seguir cada consumo."
                action={
                  <Link to="/portal/cafeteria" className="btn-outline inline-flex min-h-[44px] items-center justify-center gap-2 text-sm">
                    Ir a Cafetería <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                }
              />
            </div>
          )}
        </Reveal>
        <Reveal delay={70}>
          <StatCard
            title="Alumnos"
            value={data?.children_count ?? children.length}
            icon={GraduationCap}
            color="purple"
          />
        </Reveal>
      </div>

      {/* Quick actions — the things parents do most */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <QuickAction to="/portal/cafeteria" icon={Coffee} title="Recargar cafetería" desc="Agrega saldo con tarjeta." gradient="from-green to-green-dark" />
        <QuickAction to="/portal/credencial" icon={QrCode} title="Credencial digital" desc="Código para pagar en caja." gradient="from-purple to-pink" />
      </div>

      {/* Install + web-push hints (each renders only when relevant) */}
      <div className="mb-6 space-y-3">
        <InstallHint />
        <PushOptIn />
      </div>

      {/* 4. Avisos (unread + latest) · 5. Últimos pagos */}
      <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Reveal delay={40} className="h-full">
          <AnnouncementsCard announcements={data?.announcements} unread={unread} className="h-full" />
        </Reveal>

        <Reveal delay={110} className="h-full">
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
      </div>

      {/* 6. Cafeteria spending trend + category breakdown — cafeteria families only (lazy chunks) */}
      {hasCafeteria && (
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

      <Link
        to="/portal/perfil"
        className="mb-6 flex items-center gap-2 text-[13px] font-medium text-muted transition-colors hover:text-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/30 rounded"
      >
        <UserCircle size={16} className="text-subtle" aria-hidden="true" />
        Mi información y preferencias
        <ArrowRight size={14} className="text-subtle" aria-hidden="true" />
      </Link>
      </>
      )}
    </>
  );
}

/**
 * Hero card: family cafetería balance + quick top-up chips. The chips deep-link
 * into CafeteriaPage with `?recarga=<monto>` so its top-up modal opens with the
 * amount prefilled (no payment logic here).
 */
function CafeteriaSaldoCard({ total, low, studentsCount }: {
  total: number; low: boolean; studentsCount: number;
}) {
  return (
    <div className="card flex h-full flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12.5px] font-medium text-muted">Saldo Cafetería</p>
          <p className={`mt-1 font-head text-[clamp(26px,8vw,36px)] font-extrabold leading-[1.1] tracking-[-1px] ${low ? 'text-amber' : 'text-ink'}`}>
            ${total.toFixed(2)}
          </p>
          {studentsCount > 1 && (
            <p className="mt-0.5 text-[11.5px] text-subtle">Suma de {studentsCount} alumnos</p>
          )}
        </div>
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${low ? 'bg-amber/10 text-amber' : 'bg-green-50 text-green-dark'}`}>
          <Coffee size={22} aria-hidden="true" />
        </span>
      </div>
      <div className="mt-auto">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-subtle">Recarga rápida</p>
        <div className="flex flex-wrap items-center gap-2">
          {QUICK_TOPUP_AMOUNTS.map((amt) => (
            <Link
              key={amt}
              to={`/portal/cafeteria?recarga=${amt}`}
              aria-label={`Recargar $${amt} en cafetería`}
              className="inline-flex min-h-[40px] items-center gap-1 rounded-full border border-green/40 bg-green-50 px-4 py-1.5 text-sm font-bold text-green-dark transition hover:border-green hover:bg-green-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
            >
              <Plus size={14} aria-hidden="true" /> ${amt}
            </Link>
          ))}
          <Link
            to="/portal/cafeteria"
            className="rounded px-1 text-[12.5px] font-semibold text-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
          >
            Otro monto →
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Avisos section: unread count chip + latest announcements. */
function AnnouncementsCard({ announcements, unread, className }: {
  announcements: DashboardData['announcements'];
  unread: number;
  className?: string;
}) {
  return (
    <SectionCard title="Avisos Escolares" action={{ to: '/portal/comunicados', label: 'Ver todos' }} className={className}>
      {unread > 0 && (
        <div className="border-b border-cream px-5 py-2.5">
          <span className="badge-pink">{unread} sin leer</span>
        </div>
      )}
      {!announcements?.length ? (
        <SectionEmpty icon={Bell}>Sin avisos</SectionEmpty>
      ) : (
        <div>
          {announcements.slice(0, 4).map((a, i) => (
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
