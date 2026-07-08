import { useQuery } from '@tanstack/react-query';
import { Coffee, Bell, GraduationCap } from 'lucide-react';
import { StatCard } from '@/components/ui/StatCard';
import TopBar from '@/components/layout/TopBar';
import { useAuthStore } from '@/store/authStore';
import { portalApi } from '@/services/api';
import type { DashboardData } from '@/types';

export default function StudentDashboard() {
  const { user } = useAuthStore();
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => (await portalApi.getDashboard()).data,
  });

  return (
    <div style={{ margin: '-24px clamp(-32px,-4vw,-16px) 0' }}>
      <TopBar title={`Hola, ${user?.first_name ?? ''}`} subtitle="Portal del Alumno" />
      <div style={{ padding: '24px clamp(16px,4vw,32px)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 18, marginBottom: 24 }}>
          {isLoading ? (
            [0, 1].map(i => <div key={i} className="skeleton" style={{ height: 148 }} />)
          ) : (
            <>
              <StatCard
                title="Saldo Cafetería"
                value={`$${parseFloat(data?.cafeteria_balance ?? '0').toFixed(2)}`}
                icon={Coffee}
                color={data?.is_low_balance ? 'amber' : 'green'}
                subtitle={data?.is_low_balance ? 'Saldo bajo — solicita recarga' : undefined}
              />
              <StatCard title="Avisos" value={data?.unread_notifications ?? data?.announcements?.length ?? 0} icon={Bell} color="pink" />
            </>
          )}
        </div>

        {/* Student info */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div className="stat-icon" style={{ width: 40, height: 40, borderRadius: 11, background: 'rgba(64,26,142,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <GraduationCap size={20} color="#401a8e" />
            </div>
            <h2 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 15, color: '#1A1130' }}>Mi Información</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 16 }}>
            {[['Matrícula', data?.student_id], ['Grado', data?.grade], ['Grupo', data?.group]].map(([k, v]) => (
              <div key={k as string}>
                <div style={{ fontSize: 11.5, color: '#9A93AE' }}>{k}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1A1130', marginTop: 2, fontFamily: 'Poppins, sans-serif' }}>{(v as string) ?? '—'}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Announcements */}
        {!!data?.announcements?.length && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #ECEAF3' }}>
              <h2 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 15, color: '#1A1130' }}>Avisos Escolares</h2>
            </div>
            {data.announcements.map((a, i) => (
              <div key={a.id} style={{ padding: '13px 20px', borderTop: i === 0 ? 'none' : '1px solid #ECEAF3' }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1A1130' }}>{a.title}</div>
                <div style={{ fontSize: 12.5, color: '#6E6885', marginTop: 2 }}>{a.body}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
