import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Users, ClipboardList, CreditCard, Coffee, RefreshCw, UserPlus, ArrowRight } from 'lucide-react';
import { StatCard } from '@/components/ui/StatCard';
import TopBar from '@/components/layout/TopBar';
import { portalApi } from '@/services/api';
import type { DashboardData } from '@/types';

export default function AdminDashboard() {
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => (await portalApi.getDashboard()).data,
  });

  return (
    <div style={{ margin: '-24px clamp(-32px,-4vw,-16px) 0' }}>
      <TopBar title="Panel de Administración" subtitle="Ciclo Escolar 2025–2026" />
      <div style={{ padding: '24px clamp(16px,4vw,32px)' }}>
        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 18, marginBottom: 24 }}>
          {isLoading ? (
            [0, 1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 148 }} />)
          ) : (
            <>
              <StatCard title="Total Alumnos" value={data?.total_students ?? 0} icon={Users} color="purple" />
              <StatCard title="Pre-registros Pendientes" value={data?.pending_preregistrations ?? 0} icon={ClipboardList} color="pink" />
              <StatCard title="Ingresos del Mes" value={`$${parseFloat(data?.total_revenue ?? '0').toLocaleString('es-MX')}`} suffix="MXN" icon={CreditCard} color="teal" />
              <StatCard title="Pagos Pendientes" value={data?.pending_payments ?? 0} icon={Coffee} color="green" />
            </>
          )}
        </div>

        {/* Quick actions */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
          <Link to="/admin/cafeteria" className="btn-teal"><RefreshCw size={16} /> Sincronizar Loyverse</Link>
          <Link to="/admin/admisiones" className="btn" style={{ background: 'var(--purple)', color: '#fff' }}><UserPlus size={16} /> Nueva Admisión</Link>
          <Link to="/admin/alumnos" className="btn-outline"><Users size={16} /> Ver Alumnos</Link>
        </div>

        {/* Recent activity */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '18px 22px', borderBottom: '1px solid #ECEAF3', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 15, color: '#1A1130' }}>Avisos Recientes</h2>
            <Link to="/admin/admisiones" style={{ fontSize: 12.5, color: '#401a8e', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
              Ver admisiones <ArrowRight size={13} />
            </Link>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#FAF9FD' }}>
                  {['Concepto', 'Audiencia', 'Estatus', 'Fecha'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '11px 22px', fontFamily: 'Poppins, sans-serif', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#6E6885', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.announcements ?? []).slice(0, 10).map((a, i) => (
                  <tr key={a.id} style={{ borderTop: i === 0 ? 'none' : '1px solid #ECEAF3' }}>
                    <td style={{ padding: '13px 22px', fontSize: 13.5, fontWeight: 600, color: '#1A1130' }}>{a.title}</td>
                    <td style={{ padding: '13px 22px', fontSize: 13, color: '#6E6885', textTransform: 'capitalize' }}>{a.audience}</td>
                    <td style={{ padding: '13px 22px' }}><span className="badge-teal">Publicado</span></td>
                    <td style={{ padding: '13px 22px', fontSize: 13, color: '#9A93AE' }}>{new Date(a.created_at).toLocaleDateString('es-MX')}</td>
                  </tr>
                ))}
                {!isLoading && !(data?.announcements ?? []).length && (
                  <tr><td colSpan={4} style={{ padding: '32px', textAlign: 'center', color: '#9A93AE', fontSize: 13 }}>Sin actividad reciente</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
