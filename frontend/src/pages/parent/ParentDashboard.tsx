import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Coffee, CreditCard, AlertTriangle, GraduationCap, Bell, ArrowRight } from 'lucide-react';
import { StatCard } from '@/components/ui/StatCard';
import TopBar from '@/components/layout/TopBar';
import { useAuthStore } from '@/store/authStore';
import { portalApi } from '@/services/api';
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

  const firstChild = data?.children?.[0];
  const balanceObj = data?.cafeteria_balances?.[0];
  const hasLowBalance = data?.cafeteria_balances?.some(b => b.low);
  const pendingPayments = data?.recent_payments?.filter(p => p.status === 'pending').length ?? 0;

  return (
    <div style={{ margin: '-24px clamp(-32px,-4vw,-16px) 0' }}>
      <TopBar
        title={`Bienvenido/a, ${user?.first_name ?? ''}`}
        subtitle={`Portal Familiar${firstChild ? ` · ${firstChild.name}` : ''}`}
      />
      <div style={{ padding: '24px clamp(16px,4vw,32px)' }}>
        {/* Low balance alert */}
        {hasLowBalance && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(239,37,88,0.07)', border: '1px solid #ef2558', borderRadius: 14, padding: '14px 18px', marginBottom: 20, color: '#d81a49' }}>
            <AlertTriangle size={20} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, fontSize: 13.5 }}>
              <strong>Saldo bajo en cafetería.</strong> Recargue el saldo para continuar usando los servicios.
            </div>
            <Link to="/portal/cafeteria" style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>Recargar →</Link>
          </div>
        )}

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 18, marginBottom: 24 }}>
          {isLoading ? (
            [0, 1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 148 }} />)
          ) : (
            <>
              <StatCard title="Alumnos" value={data?.children_count ?? data?.children?.length ?? 0} icon={GraduationCap} color="purple" />
              <StatCard title="Saldo Cafetería" value={`$${balanceObj?.balance ?? '0.00'}`} icon={Coffee} color={hasLowBalance ? 'amber' : 'green'} />
              <StatCard title="Pagos Pendientes" value={pendingPayments} icon={CreditCard} color="pink" />
              <StatCard title="Avisos" value={data?.unread_notifications ?? data?.announcements?.length ?? 0} icon={Bell} color="green" />
            </>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
          {/* Recent payments */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #ECEAF3', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 15, color: '#1A1130' }}>Últimos Pagos</h2>
              <Link to="/portal/pagos" style={{ fontSize: 12.5, color: '#401a8e', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>Ver todos <ArrowRight size={13} /></Link>
            </div>
            <div>
              {!data?.recent_payments?.length ? (
                <p style={{ textAlign: 'center', color: '#9A93AE', fontSize: 13, padding: '28px' }}>Sin pagos registrados</p>
              ) : data.recent_payments.slice(0, 5).map((p, i) => {
                const b = payBadge(p.status);
                return (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 20px', borderTop: i === 0 ? 'none' : '1px solid #ECEAF3' }}>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1A1130', textTransform: 'capitalize' }}>{p.type}</div>
                      <div style={{ fontSize: 12, color: '#9A93AE' }}>{format(new Date(p.date), 'd MMM yyyy', { locale: es })}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#1A1130', fontFamily: 'Poppins, sans-serif' }}>${p.amount}</div>
                      <span className={b.cls} style={{ marginTop: 3 }}>{b.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Announcements */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #ECEAF3' }}>
              <h2 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 15, color: '#1A1130' }}>Avisos Escolares</h2>
            </div>
            <div>
              {!data?.announcements?.length ? (
                <p style={{ textAlign: 'center', color: '#9A93AE', fontSize: 13, padding: '28px' }}>Sin avisos</p>
              ) : data.announcements.slice(0, 4).map((a, i) => (
                <div key={a.id} style={{ padding: '13px 20px', borderTop: i === 0 ? 'none' : '1px solid #ECEAF3' }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1A1130' }}>{a.title}</div>
                  <div style={{ fontSize: 12.5, color: '#6E6885', marginTop: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{a.body}</div>
                  <div style={{ fontSize: 11.5, color: '#9A93AE', marginTop: 4 }}>{format(new Date(a.created_at), 'd MMM', { locale: es })}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
