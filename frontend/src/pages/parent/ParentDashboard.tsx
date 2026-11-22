import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Coffee, AlertTriangle, GraduationCap, ArrowRight, Bell, CheckCircle2, Clock,
  MessageCircle, QrCode, Plus, UserPlus, type LucideIcon,
} from 'lucide-react';
import { Reveal } from '@/components/ui/Reveal';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Avatar } from '@/components/ui/Avatar';
import { PageHeader } from '@/components/layout/PageHeader';
import { NovedadesPanel } from '@/components/portal/NovedadesPanel';
import { avatarOf } from '@/components/portal/familyChildren';
import { useAuthStore } from '@/store/authStore';
import { useSelectedChildStore } from '@/store/selectedChildStore';
import { cafeteriaApi, portalApi } from '@/services/api';
import { PushOptIn } from '@/components/portal/PushOptIn';
import { InstallHint } from '@/components/portal/InstallHint';
import { BalanceWithPending } from '@/components/portal/BalanceWithPending';
import type { DashboardData, PendingTopUp } from '@/types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { LIVE } from '@/lib/live';
import { formatMXN } from '@/lib/format';
import { formatCents, projectBalance } from '@/lib/topupApply';
import { fetchNotifications, notifDestination, NOTIFICATIONS_KEY, pinUrgent, type Notif } from '@/lib/notifications';

// Recharts (heavy) stays out of the dashboard's main chunk — loaded only when a
// cafeteria-using family renders the trend.
const CafeteriaTrendCard = lazy(() => import('@/components/portal/CafeteriaTrendCard'));
const CafeteriaCategoriesCard = lazy(() => import('@/components/portal/CafeteriaCategoriesCard'));

/** Dashboard quick top-up amounts; CafeteriaPage reads `?recarga=<amount>`. */
const QUICK_TOPUP_AMOUNTS = [100, 200, 500];
/** «Hoy» shows what needs attention now, never more than this. */
const HOY_MAX = 4;

type DashboardBalance = NonNullable<DashboardData['cafeteria_balances']>[number];

/**
 * The paid card top-ups on their way to this wallet, one by one with their
 * promised load (`pending_topup_items`). An older API sent only the total:
 * then one row with no date ("el siguiente día hábil a las 7:30 a.m.").
 */
function pendingOf(b: DashboardBalance): Pick<PendingTopUp, 'amount' | 'apply_due_at'>[] {
  if (b.pending_topup_items) return b.pending_topup_items;
  return parseFloat(b.pending_topups || '0') > 0 ? [{ amount: b.pending_topups as string, apply_due_at: null }] : [];
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const cafeteriaLink = (b: DashboardBalance) => (b.student ? `/portal/cafeteria?hijo=${b.student}` : '/portal/cafeteria');

/** es-MX time-of-day greeting. Exported for tests. */
export function greetingForHour(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Buenos días';
  if (hour >= 12 && hour < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

/**
 * Current time as state, refreshed every minute — keeps the greeting and the
 * "Actualizado hace X min" hint honest without reading the clock during
 * render (react-hooks/purity): the impure `Date.now()` reads live in the
 * lazy initializer and the interval callback.
 */
function useNowMs(): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return nowMs;
}

/** One «Hoy» row: what it is about and one verb-first action. */
interface HoyItem {
  key: string;
  icon: LucideIcon;
  tone: 'warning' | 'info' | 'danger' | 'neutral';
  title: string;
  text?: string;
  action?: { label: string; to: string; aria?: string; onClick?: () => void };
}

const TONE: Record<HoyItem['tone'], string> = {
  warning: 'bg-warning-bg text-warning',
  info: 'bg-info-bg text-info',
  danger: 'bg-danger-bg text-danger',
  neutral: 'bg-cream text-muted',
};

export default function ParentDashboard() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const childId = useSelectedChildStore((s) => s.childId);
  const { data, isLoading, isError, dataUpdatedAt, refetch } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => (await portalApi.getDashboard()).data,
    ...LIVE,
  });
  // The header bell's list (same key): already loaded on every portal page.
  const { data: notifs, isSuccess: notifsLoaded } = useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: fetchNotifications,
    staleTime: 30_000,
  });
  const markRead = useMutation({
    mutationFn: (id: number) => portalApi.markNotificationRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const nowMs = useNowMs();

  const children = data?.children ?? [];
  const needsFamilyLink = Boolean(data?.needs_family_link) || (!isLoading && !isError && children.length === 0);
  // The header switcher (shared store) picks the child; the first one otherwise.
  const selectedChild = children.find((c) => c.id === childId) ?? children[0];
  const several = children.length > 1;
  // A staff member's own cafetería login (2026-11-18): no siblings to add, a puesto instead.
  const staffOnly = children.length > 0 && children.every((c) => c.tipo === 'personal');
  const balances = data?.cafeteria_balances ?? [];
  // Each child is its own wallet: the hero shows the SELECTED child's balance,
  // never a sum of siblings. One child only: its single row, even if an older
  // API left out the id.
  const selectedBalance = balances.find((b) => b.student === selectedChild?.id)
    ?? (children.length <= 1 && balances.length === 1 ? balances[0] : undefined);
  const hasCafeteria = balances.length > 0;
  const otherChildren = children.filter((c) => c.id !== selectedChild?.id);

  // ── «Hoy»: what needs attention now, built only from data already here ──
  const hoy: HoyItem[] = [];
  // `low` already honours the paid top-ups on their way (backend).
  const lowBalances = balances.filter((b) => b.low);
  for (const b of lowBalances) {
    hoy.push({
      key: `low-${b.student ?? b.student_name}`,
      icon: AlertTriangle,
      tone: 'warning',
      title: balances.length > 1 ? `Saldo bajo de ${firstName(b.student_name)}` : 'Saldo bajo en cafetería',
      text: `Quedan ${formatMXN(b.balance)}.`,
      action: { label: 'Recargar', to: cafeteriaLink(b), aria: balances.length > 1 ? `Recargar a ${b.student_name}` : undefined },
    });
  }
  for (const b of balances) {
    const p = projectBalance(b.balance, pendingOf(b));
    if (!p) continue;
    const last = p.steps[p.steps.length - 1];
    hoy.push({
      key: `pending-${b.student ?? b.student_name}`,
      icon: Clock,
      tone: 'info',
      title: balances.length > 1 ? `Recarga pagada de ${firstName(b.student_name)}` : 'Recarga pagada',
      text: `${formatCents(p.pending)} · ${p.steps.length > 1 ? 'todo disponible' : 'disponible'} ${last.short}`,
      action: { label: 'Ver movimientos', to: cafeteriaLink(b), aria: balances.length > 1 ? `Ver movimientos de ${b.student_name}` : undefined },
    });
  }
  // Unread avisos: urgent ones first, one row each; the rest as one row. A
  // «saldo bajo» alert already has its row above.
  const unread = pinUrgent((notifs ?? []).filter((n) => !n.is_read))
    .filter((n) => !(lowBalances.length && /saldo bajo/i.test(n.title)));
  const openNotif = (n: Notif) => { markRead.mutate(n.id); };
  const urgent = unread.filter((n) => n.notif_type === 'warning');
  const rest = unread.filter((n) => n.notif_type !== 'warning');
  for (const n of urgent) {
    hoy.push({
      key: `notif-${n.id}`, icon: AlertTriangle, tone: 'danger', title: n.title,
      action: { label: 'Leer', to: notifDestination(n), aria: `Leer el aviso: ${n.title}`, onClick: () => openNotif(n) },
    });
  }
  // The bell's list when it loaded, else the dashboard's own count.
  const restCount = notifsLoaded ? rest.length : (data?.unread_notifications ?? 0);
  if (restCount === 1 && rest[0]) {
    const n = rest[0];
    hoy.push({
      key: `notif-${n.id}`, icon: Bell, tone: 'neutral', title: n.title,
      action: { label: 'Leer', to: notifDestination(n), aria: `Leer el aviso: ${n.title}`, onClick: () => openNotif(n) },
    });
  } else if (restCount > 0) {
    hoy.push({
      key: 'notif-rest', icon: Bell, tone: 'neutral',
      title: `${restCount} avisos sin leer`,
      action: { label: 'Ver avisos', to: '/portal/notificaciones?sin_leer=1' },
    });
  }

  const now = new Date(nowMs);
  const todayLine = format(now, "EEEE d 'de' MMMM 'de' yyyy", { locale: es });
  const todayCapitalized = todayLine.charAt(0).toUpperCase() + todayLine.slice(1);

  const updatedMins = dataUpdatedAt
    ? Math.max(0, Math.floor((nowMs - dataUpdatedAt) / 60_000))
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
        subtitle={todayCapitalized}
        // The page refreshes itself (LIVE): it only says how fresh it is.
        actions={updatedLabel ? <span className="text-xs text-subtle" aria-live="polite">{updatedLabel}</span> : undefined}
      />

      {isError ? (
        <div className="card"><ErrorState onRetry={() => refetch()} /></div>
      ) : isLoading ? (
        /* Skeletons mirroring the final layout: Hoy, wallet + KPIs, two section cards. */
        <div aria-busy="true" aria-label="Cargando panel" className="space-y-6">
          <div className="skeleton h-[148px] rounded-md" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="skeleton h-[200px] rounded-md lg:col-span-2" />
            <div className="skeleton h-[200px] rounded-md" />
          </div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {[0, 1].map((i) => <div key={i} className="skeleton h-[240px] rounded-md" />)}
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
              description="El colegio aún no vincula a un alumno con este correo."
              action={
                <Link to="/contacto" className="btn-primary min-h-[44px]">
                  <MessageCircle size={20} aria-hidden="true" /> Contactar al colegio
                </Link>
              }
            />
          </div>
        </>
      ) : (
      <div className="space-y-6">
        {/* 1. «Hoy»: what needs attention now (≤ 4 rows, one action each) */}
        <Reveal delay={0}>
          <section aria-labelledby="hoy-title" className="card !p-0">
            <h2 id="hoy-title" className="px-5 pb-1 pt-4 font-head text-base font-bold text-ink">Hoy</h2>
            <ul aria-label="Pendientes de hoy" className="pb-2">
              {hoy.length === 0 ? (
                <HoyRow item={{ key: 'ok', icon: CheckCircle2, tone: 'neutral', title: 'Todo en orden', text: 'No hay pendientes por hoy.' }} ok />
              ) : (
                hoy.slice(0, HOY_MAX).map((item) => <HoyRow key={item.key} item={item} />)
              )}
            </ul>
          </section>
        </Reveal>

        {/* 2. The selected child's wallet + ≤ 3 KPIs */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
          <Reveal className="lg:col-span-2" delay={40}>
            {hasCafeteria && selectedBalance ? (
              <WalletHero
                childId={selectedBalance.student}
                name={selectedBalance.student_name}
                several={several}
                balance={selectedBalance.balance || '0'}
                pending={pendingOf(selectedBalance)}
                low={!!selectedBalance.low}
              />
            ) : hasCafeteria ? (
              <div className="card h-full">
                <EmptyState
                  icon={Coffee}
                  title={`${selectedChild?.name ?? 'Este alumno'} no tiene monedero activo`}
                  description="Puede estar de baja o sin cafetería. Elija a otro alumno arriba."
                />
              </div>
            ) : (
              <div className="card h-full">
                <EmptyState
                  icon={Coffee}
                  title="Monedero de cafetería"
                  description="El colegio aún no activa la cafetería para su familia."
                  action={
                    <Link to="/portal/cafeteria" className="btn-secondary min-h-[44px]">
                      Ir a Cafetería <ArrowRight size={16} aria-hidden="true" />
                    </Link>
                  }
                />
              </div>
            )}
          </Reveal>
          <Reveal delay={70}>
            <Kpis
              childId={hasCafeteria ? selectedChild?.id : undefined}
              staffPuesto={staffOnly ? (children[0].puesto_label || 'Sin asignar') : null}
              count={data?.children_count ?? children.length}
            />
          </Reveal>
        </div>

        {/* Install + web-push hints (each renders only when relevant) */}
        <div className="space-y-3 empty:hidden">
          <InstallHint />
          <PushOptIn />
        </div>

        {/* 3. Novedades and the other children, as rows */}
        <div className={`grid grid-cols-1 gap-5 ${several ? 'lg:grid-cols-2' : ''}`}>
          <Reveal delay={20}><NovedadesPanel className="h-full" /></Reveal>
          {several && (
            <Reveal delay={20}>
              <section aria-labelledby="otros-title" className="card h-full !p-0">
                <h2 id="otros-title" className="border-b border-cream px-5 py-4 font-head text-base font-bold text-ink">
                  {otherChildren.length === 1 ? 'Su otro alumno' : 'Sus otros alumnos'}
                </h2>
                <ul aria-label="Otros alumnos">
                  {otherChildren.map((c) => {
                    const b = balances.find((x) => x.student === c.id);
                    return (
                      <li key={c.id} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-0">
                        <Avatar user={avatarOf(c.name)} size={36} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink">{c.name}</p>
                          {b ? (
                            <BalanceWithPending variant="tile" label={null} balance={b.balance} pending={pendingOf(b)} low={b.low} />
                          ) : (
                            <p className="text-xs text-subtle">Sin monedero activo</p>
                          )}
                        </div>
                        {b?.student && (
                          <Link to={cafeteriaLink(b)} aria-label={`Recargar a ${c.name}`} className="inline-flex min-h-[44px] shrink-0 items-center rounded-sm px-3 text-sm font-semibold text-purple transition-colors hover:bg-purple/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40">
                            Recargar
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            </Reveal>
          )}
        </div>

        {/* 4. Cafeteria spending trend + category breakdown — cafeteria families only (lazy chunks) */}
        {hasCafeteria && (
          <Reveal delay={20}>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <Suspense fallback={<div className="skeleton h-[300px] rounded-md" aria-hidden="true" />}>
                <CafeteriaTrendCard student={selectedChild?.id ?? 'all'} />
              </Suspense>
              <Suspense fallback={<div className="skeleton h-[300px] rounded-md" aria-hidden="true" />}>
                <CafeteriaCategoriesCard student={selectedChild?.id ?? 'all'} />
              </Suspense>
            </div>
          </Reveal>
        )}

        {/* The way to add a sibling without the office (Mi perfil → Mis hijos) */}
        {!staffOnly && (
          <Link to="/portal/perfil?tab=hijos"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-sm px-2 text-sm font-semibold text-purple hover:bg-purple/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40">
            <UserPlus size={20} aria-hidden="true" /> Agregar otro hijo
          </Link>
        )}
      </div>
      )}
    </>
  );
}

function HoyRow({ item, ok = false }: { item: HoyItem; ok?: boolean }) {
  const Icon = item.icon;
  const a = item.action;
  return (
    <li className="flex min-h-[56px] items-center gap-3 px-5 py-2">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-sm ${ok ? 'bg-success-bg text-success' : TONE[item.tone]}`}>
        <Icon size={20} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-semibold text-ink">{item.title}</p>
        {item.text && <p className="text-[13px] leading-snug text-muted">{item.text}</p>}
      </div>
      {a && (
        <Link
          to={a.to}
          onClick={a.onClick}
          aria-label={a.aria}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1 whitespace-nowrap rounded-sm px-3 text-sm font-semibold text-purple transition-colors hover:bg-purple/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
        >
          {a.label} <ArrowRight size={16} aria-hidden="true" />
        </Link>
      )}
    </li>
  );
}

/**
 * Hero: the SELECTED child's cafetería wallet (never a sum of siblings),
 * quick top-up chips and the credential. The chips deep-link into
 * CafeteriaPage with `?recarga=<monto>&hijo=<id>` so its top-up wizard opens
 * for this child with the amount prefilled (no payment logic here).
 */
function WalletHero({ childId, name, several, balance, pending, low }: {
  childId?: number; name: string; several: boolean; balance: string;
  /** Paid card top-ups waiting for the 7:30 POS load: «$150.00 → $350.00». */
  pending: Pick<PendingTopUp, 'amount' | 'apply_due_at'>[];
  low: boolean;
}) {
  const first = firstName(name);
  const hijo = childId ? `hijo=${childId}` : '';
  const page = hijo ? `/portal/cafeteria?${hijo}` : '/portal/cafeteria';
  return (
    <section data-testid="wallet-hero" aria-label={`Monedero de ${name}`} className="card flex h-full flex-col gap-5">
      <BalanceWithPending
        variant="hero"
        balance={balance}
        pending={pending}
        low={low}
        label={several ? `Saldo de ${first}` : 'Saldo Cafetería'}
        pendingLabel={several ? `Saldo en caja de ${first}` : 'Saldo en caja'}
        caption={<p className="mt-0.5 text-xs text-subtle">{name}</p>}
        expandable
      />
      <div className="mt-auto space-y-3">
        <div>
          <p className="mb-2 text-xs font-semibold text-subtle">Recarga rápida</p>
          <div className="flex flex-wrap items-center gap-2">
            {QUICK_TOPUP_AMOUNTS.map((amt) => (
              <Link
                key={amt}
                to={`/portal/cafeteria?recarga=${amt}${hijo ? `&${hijo}` : ''}`}
                aria-label={`Recargar $${amt} a ${name}`}
                className="inline-flex min-h-[44px] items-center gap-1 rounded-sm bg-purple-light px-4 text-sm font-bold text-purple transition-colors hover:bg-purple-xlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
              >
                <Plus size={16} aria-hidden="true" /> ${amt}
              </Link>
            ))}
            <Link
              to={page}
              className="inline-flex min-h-[44px] items-center rounded-sm px-3 text-sm font-semibold text-purple transition-colors hover:bg-purple/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
            >
              Elegir otro monto
            </Link>
          </div>
        </div>
        <Link
          to="/portal/credencial"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-sm px-1 text-sm font-semibold text-ink transition-colors hover:text-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
        >
          <QrCode size={20} aria-hidden="true" /> Mostrar credencial
        </Link>
      </div>
    </section>
  );
}

/** At most three figures for the selected child, from queries the page already makes. */
function Kpis({ childId, staffPuesto, count }: { childId?: number; staffPuesto: string | null; count: number }) {
  // The trend chart's own query (same key and payload): one request for both.
  const { data: trend } = useQuery({
    queryKey: ['cafeteria-spending-trend', 30, childId ?? 'all'],
    queryFn: async () => (await cafeteriaApi.getSpendingTrend(30, childId)).data as { total: number; average: number },
    enabled: childId != null,
    staleTime: 1000 * 60 * 5,
  });
  const items: { label: string; value: ReactNode }[] = [];
  if (childId != null) {
    items.push({ label: 'Consumo en 30 días', value: trend ? formatMXN(trend.total) : '—' });
    items.push({ label: 'Promedio por día', value: trend ? formatMXN(trend.average) : '—' });
  }
  items.push(staffPuesto != null
    ? { label: 'Personal del colegio', value: staffPuesto }
    : { label: 'Alumnos', value: count });
  return (
    <dl className="card grid h-full grid-cols-3 content-start gap-4 lg:grid-cols-1">
      {items.map((k) => (
        <div key={k.label} className="min-w-0">
          <dt className="text-xs font-medium text-muted">{k.label}</dt>
          <dd className="mt-1 truncate font-head text-lg font-bold tabular-nums text-ink">{k.value}</dd>
        </div>
      ))}
    </dl>
  );
}
