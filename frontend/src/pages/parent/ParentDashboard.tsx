import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Coffee, CreditCard, AlertTriangle, GraduationCap, Bell, ArrowRight } from 'lucide-react';
import { StatCard } from '@/components/ui/StatCard';
import { Reveal } from '@/components/ui/Reveal';
import TopBar from '@/components/layout/TopBar';
import { useAuthStore } from '@/store/authStore';
import { portalApi } from '@/services/api';
import { useAnnouncementsRead } from '@/hooks/useAnnouncementsRead';
import { PushOptIn } from '@/components/portal/PushOptIn';
import type { DashboardData } from '@/types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const payBadge = (s: string) => {
  if (s === 'success' || s === 'completed') return { cls: 'badge-green', label: 'Completado' };
  if (s === 'refunded') return { cls: 'badge-green', label: 'Devuelto' };
  if (s === 'failed') return { cls: 'badge-pink', label: 'Fallido' };
  if (s === 'processing') return { cls: 'badge-purple', label: 'Procesando' };
  return { cls: 'badge-amber', label: 'Pendiente' };
};

export default function ParentDashboard() {
  const { user } = useAuthStore();
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => (await portalApi.getDashboard()).data,
    staleTime: 1000 * 60 * 2,
  });

  useAnnouncementsRead(data?.announcements);

  const firstChild = data?.children?.[0];
  const balanceObj = data?.cafeteria_balances?.[0];
  const hasLowBalance = data?.cafeteria_balances?.some(b => b.low);
  const pendingPayments = data?.recent_payments?.filter(p => p.status === 'pending').length ?? 0;

  return (
    <div className="-mt-6 -mx-[clamp(16px,4vw,32px)]">
      <TopBar
        title={`Bienvenido/a, ${user?.first_name ?? ''}`}
        subtitle={`Portal Familiar${firstChild ? ` · ${firstChild.name}` : ''}`}
      />
      <div className="px-[clamp(16px,4vw,32px)] py-6">
        {/* Web-push opt-in (renders only when supported and not yet enabled) */}
        <div className="mb-5">
          <PushOptIn />
        </div>

        {/* Low balance alert */}
        {hasLowBalance && (
          <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-pink bg-pink/5 px-4 py-3.5 text-pink-dark sm:flex-row sm:items-center sm:px-[18px]">
            <AlertTriangle size={20} className="shrink-0" />
            <div className="flex-1 text-[13.5px]">
              <strong>Saldo bajo en cafetería.</strong> Recargue el saldo para continuar usando los servicios.
            </div>
            <Link
              to="/portal/cafeteria"
              className="whitespace-nowrap text-[12.5px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink/40 rounded"
            >
              Recargar →
            </Link>
          </div>
        )}

        {/* Stats */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 sm:gap-[18px]">
          {isLoading ? (
            [0, 1, 2, 3].map(i => <div key={i} className="skeleton h-[148px]" />)
          ) : (
            [
              <StatCard key="a" title="Alumnos" value={data?.children_count ?? data?.children?.length ?? 0} icon={GraduationCap} color="purple" />,
              <StatCard key="b" title="Saldo Cafetería" value={`$${balanceObj?.balance ?? '0.00'}`} icon={Coffee} color={hasLowBalance ? 'amber' : 'green'} />,
              <StatCard key="c" title="Pagos Pendientes" value={pendingPayments} icon={CreditCard} color="pink" />,
              <StatCard key="d" title="Avisos" value={data?.unread_notifications ?? data?.announcements?.length ?? 0} icon={Bell} color="green" />,
            ].map((card, i) => (
              <Reveal key={i} delay={i * 70}>{card}</Reveal>
            ))
          )}
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Recent payments */}
          <Reveal delay={40} className="card !p-0 overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-cream px-5 py-4">
              <h2 className="font-head text-[15px] font-bold text-ink">Últimos Pagos</h2>
              <Link
                to="/portal/pagos"
                className="flex items-center gap-1 whitespace-nowrap text-[12.5px] font-semibold text-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 rounded"
              >
                Ver todos <ArrowRight size={13} />
              </Link>
            </div>
            <div>
              {!data?.recent_payments?.length ? (
                <p className="p-7 text-center text-[13px] text-subtle">Sin pagos registrados</p>
              ) : data.recent_payments.slice(0, 5).map((p, i) => {
                const b = payBadge(p.status);
                return (
                  <div key={p.id} className={`flex items-center justify-between px-5 py-[13px] ${i === 0 ? '' : 'border-t border-cream'}`}>
                    <div>
                      <div className="text-[13.5px] font-semibold capitalize text-ink">{p.type}</div>
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
          </Reveal>

          {/* Announcements */}
          <Reveal delay={110} className="card !p-0 overflow-hidden">
            <div className="border-b border-cream px-5 py-4">
              <h2 className="font-head text-[15px] font-bold text-ink">Avisos Escolares</h2>
            </div>
            <div>
              {!data?.announcements?.length ? (
                <p className="p-7 text-center text-[13px] text-subtle">Sin avisos</p>
              ) : data.announcements.slice(0, 4).map((a, i) => (
                <div key={a.id} className={`px-5 py-[13px] ${i === 0 ? '' : 'border-t border-cream'}`}>
                  <div className="text-[13.5px] font-semibold text-ink">{a.title}</div>
                  <div className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{a.body}</div>
                  <div className="mt-1 text-[11.5px] text-subtle">{format(new Date(a.created_at), 'd MMM', { locale: es })}</div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </div>
  );
}
