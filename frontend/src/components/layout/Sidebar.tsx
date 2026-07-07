import { NavLink, Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import Logo from '@/components/ui/Logo';
import {
  LayoutDashboard, CreditCard, Users, LogOut,
  Coffee, ClipboardList, BarChart3, type LucideIcon,
} from 'lucide-react';

type Role = 'parent' | 'student' | 'admin';

interface NavEntry { icon: LucideIcon; label: string; to: string; end?: boolean; badge?: number }

const navByRole: Record<Role, NavEntry[]> = {
  admin: [
    { icon: BarChart3,     label: 'Dashboard',   to: '/admin', end: true },
    { icon: Users,         label: 'Alumnos',     to: '/admin/alumnos' },
    { icon: ClipboardList, label: 'Admisiones',  to: '/admin/admisiones' },
    { icon: Coffee,        label: 'Cafetería',   to: '/admin/cafeteria' },
  ],
  parent: [
    { icon: LayoutDashboard, label: 'Inicio',    to: '/portal', end: true },
    { icon: CreditCard,      label: 'Pagos',     to: '/portal/pagos' },
    { icon: Coffee,          label: 'Cafetería', to: '/portal/cafeteria' },
  ],
  student: [
    { icon: LayoutDashboard, label: 'Inicio',    to: '/alumno', end: true },
    { icon: Coffee,          label: 'Cafetería', to: '/alumno/cafeteria' },
  ],
};

export default function Sidebar({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const items = navByRole[role] ?? navByRole.parent;
  const initials = `${user?.first_name?.[0] ?? ''}${user?.last_name?.[0] ?? ''}`.toUpperCase() || '?';

  return (
    <aside style={{
      width: 268, flexShrink: 0, display: 'flex', flexDirection: 'column',
      height: '100vh', position: 'sticky', top: 0,
      background: '#080516', padding: '24px 16px',
      boxShadow: '0 0 60px -10px rgba(64,26,142,0.5) inset',
      overflowY: 'auto', gap: 20,
    }}>
      {/* purple glow orbs */}
      <div style={{ position: 'absolute', top: -100, left: -80, width: 340, height: 340, borderRadius: '50%', pointerEvents: 'none', background: 'radial-gradient(circle, rgba(64,26,142,0.55), rgba(8,5,22,0) 68%)' }} />
      <div style={{ position: 'absolute', bottom: -80, right: -60, width: 240, height: 240, borderRadius: '50%', pointerEvents: 'none', background: 'radial-gradient(circle, rgba(239,37,88,0.12), rgba(8,5,22,0) 70%)' }} />

      {/* Logo */}
      <Link to="/" style={{ position: 'relative', padding: '4px 4px 8px' }}>
        <Logo size={38} theme="dark" />
      </Link>

      {/* Role badge */}
      <div style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', borderRadius: 14,
        border: '1px solid rgba(124,77,214,0.4)',
        background: 'linear-gradient(120deg, rgba(64,26,142,0.5), rgba(239,37,88,0.28))',
      }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Users size={17} color="#fff" />
        </div>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.8, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', fontFamily: 'Poppins, sans-serif' }}>Portal</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'Poppins, sans-serif', letterSpacing: 0.5, textTransform: 'capitalize' }}>{role}</div>
        </div>
      </div>

      {/* Navigation */}
      <nav style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div className="sidebar-section-label">MENÚ</div>
        {items.map(({ icon: Icon, label, to, end, badge }) => (
          <NavLink key={to} to={to} end={end} onClick={onNavigate} className={({ isActive }) => isActive ? 'nav-item nav-item-active' : 'nav-item'} style={{ textDecoration: 'none' }}>
            <Icon size={19} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{label}</span>
            {badge && (
              <span style={{ minWidth: 20, height: 19, padding: '0 6px', borderRadius: 999, background: '#ef2558', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User profile */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)' }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg, #ef2558, #401a8e)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 13, color: '#fff', flexShrink: 0 }}>
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.first_name} {user?.last_name}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email}</div>
        </div>
        <button onClick={() => { logout(); navigate('/login'); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.35)', padding: 4, transition: 'color 0.2s' }} onMouseOver={e => (e.currentTarget.style.color = '#ef2558')} onMouseOut={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.35)')}>
          <LogOut size={17} />
        </button>
      </div>
    </aside>
  );
}
