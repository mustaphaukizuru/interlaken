import { useQuery } from '@tanstack/react-query';
import { Coffee, Bell, GraduationCap } from 'lucide-react';
import { StatCard } from '@/components/ui/StatCard';
import { Reveal } from '@/components/ui/Reveal';
import { ErrorState } from '@/components/ui/ErrorState';
import TopBar from '@/components/layout/TopBar';
import { useAuthStore } from '@/store/authStore';
import { portalApi } from '@/services/api';
import { useAnnouncementsRead } from '@/hooks/useAnnouncementsRead';
import type { DashboardData } from '@/types';

export default function StudentDashboard() {
  const { user } = useAuthStore();
  const { data, isLoading, isError, refetch } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => (await portalApi.getDashboard()).data,
  });

  useAnnouncementsRead(data?.announcements);

  return (
    <div className="-mt-6 -mx-[clamp(16px,4vw,32px)]">
      <TopBar title={`Hola, ${user?.first_name ?? ''}`} subtitle="Portal del Alumno" />
      <div className="px-[clamp(16px,4vw,32px)] py-6">
        {isError ? (
          <div className="card"><ErrorState onRetry={() => refetch()} /></div>
        ) : (
        <>
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-[18px]">
          {isLoading ? (
            [0, 1].map(i => <div key={i} className="skeleton h-[148px]" />)
          ) : (
            [
              <StatCard
                key="a"
                title="Saldo Cafetería"
                value={`$${parseFloat(data?.cafeteria_balance ?? '0').toFixed(2)}`}
                icon={Coffee}
                color={data?.is_low_balance ? 'amber' : 'green'}
                subtitle={data?.is_low_balance ? 'Saldo bajo — solicita recarga' : undefined}
              />,
              <StatCard key="b" title="Avisos" value={data?.unread_notifications ?? data?.announcements?.length ?? 0} icon={Bell} color="pink" />,
            ].map((card, i) => (
              <Reveal key={i} delay={i * 70}>{card}</Reveal>
            ))
          )}
        </div>

        {/* Student info */}
        <Reveal delay={40} className="card mb-5">
          <div className="mb-4 flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple/10">
              <GraduationCap size={20} className="text-purple" />
            </div>
            <h2 className="font-head text-[15px] font-bold text-ink">Mi Información</h2>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {[['Matrícula', data?.student_id], ['Grado', data?.grade], ['Grupo', data?.group]].map(([k, v]) => (
              <div key={k as string}>
                <div className="text-[11.5px] text-subtle">{k}</div>
                <div className="mt-0.5 font-head text-[14px] font-bold text-ink">{(v as string) ?? '—'}</div>
              </div>
            ))}
          </div>
        </Reveal>

        {/* Announcements */}
        {!!data?.announcements?.length && (
          <Reveal delay={90} className="card !p-0 overflow-hidden">
            <div className="border-b border-cream px-5 py-4">
              <h2 className="font-head text-[15px] font-bold text-ink">Avisos Escolares</h2>
            </div>
            {data.announcements.map((a, i) => (
              <div key={a.id} className={`px-5 py-[13px] ${i === 0 ? '' : 'border-t border-cream'}`}>
                <div className="text-[13.5px] font-semibold text-ink">{a.title}</div>
                <div className="mt-0.5 text-[12.5px] text-muted">{a.body}</div>
              </div>
            ))}
          </Reveal>
        )}
        </>
        )}
      </div>
    </div>
  );
}
