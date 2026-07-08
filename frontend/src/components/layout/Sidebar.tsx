import { NavLink, Link } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { authApi } from '@/services/api';
import Logo from '@/components/ui/Logo';
import {
  LayoutDashboard, CreditCard, Users, LogOut,
  Coffee, ClipboardList, BarChart3, CalendarClock, Receipt, type LucideIcon,
} from 'lucide-react';

type Role = 'parent' | 'student' | 'admin';

interface NavEntry { icon: LucideIcon; label: string; to: string; end?: boolean; badge?: number }

const navByRole: Record<Role, NavEntry[]> = {
  admin: [
    { icon: BarChart3,     label: 'Dashboard',   to: '/admin', end: true },
    { icon: Users,         label: 'Alumnos',     to: '/admin/alumnos' },
    { icon: ClipboardList, label: 'Admisiones',  to: '/admin/admisiones' },
    { icon: CalendarClock, label: 'Visitas',     to: '/admin/visitas' },
    { icon: Receipt,       label: 'Finanzas',    to: '/admin/finanzas' },
    { icon: Coffee,        label: 'Cafetería',   to: '/admin/cafeteria' },
  ],
  parent: [
    { icon: LayoutDashboard, label: 'Inicio',       to: '/portal', end: true },
    { icon: Receipt,         label: 'Colegiaturas', to: '/portal/colegiaturas' },
    { icon: CreditCard,      label: 'Pagos',        to: '/portal/pagos' },
    { icon: Coffee,          label: 'Cafetería',    to: '/portal/cafeteria' },
  ],
  student: [
    { icon: LayoutDashboard, label: 'Inicio',    to: '/alumno', end: true },
    { icon: Coffee,          label: 'Cafetería', to: '/alumno/cafeteria' },
  ],
};

interface SidebarProps {
  role: Role;
  /** Drawer open state (mobile only). */
  open?: boolean;
  onNavigate?: () => void;
}

export default function Sidebar({ role, open = false, onNavigate }: SidebarProps) {
  const { user } = useAuthStore();
  const items = navByRole[role] ?? navByRole.parent;
  const initials = `${user?.first_name?.[0] ?? ''}${user?.last_name?.[0] ?? ''}`.toUpperCase() || '?';

  return (
    <aside
      aria-label="Navegación del portal"
      className={`fixed inset-y-0 left-0 z-50 flex h-[100dvh] w-[268px] flex-shrink-0 flex-col gap-5 overflow-y-auto bg-dark px-4 py-6 shadow-[0_0_60px_-10px_rgba(64,26,142,0.5)_inset] transition-transform duration-300 ease-out [padding-left:max(1rem,env(safe-area-inset-left))] lg:static lg:h-screen lg:translate-x-0 ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      {/* purple glow orbs */}
      <div className="pointer-events-none absolute -top-[100px] -left-20 h-[340px] w-[340px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(64,26,142,0.55), rgba(8,5,22,0) 68%)' }} />
      <div className="pointer-events-none absolute -bottom-20 -right-[60px] h-60 w-60 rounded-full" style={{ background: 'radial-gradient(circle, rgba(239,37,88,0.12), rgba(8,5,22,0) 70%)' }} />

      {/* Logo */}
      <Link to="/" className="relative flex justify-center px-1 pb-2 pt-1" aria-label="Colegio Interlaken — Inicio">
        <Logo variant="stacked" size={92} theme="dark" eager />
      </Link>

      {/* Role badge */}
      <div className="relative flex items-center gap-2.5 rounded-[14px] border border-purple-mid/40 bg-gradient-to-br from-purple/50 to-pink/[0.28] px-3.5 py-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-white/10">
          <Users size={17} color="white" />
        </div>
        <div>
          <div className="font-head text-[9px] font-bold uppercase tracking-[1.8px] text-white/45">Portal</div>
          <div className="font-head text-[13px] font-bold capitalize tracking-[0.5px] text-white">{role}</div>
        </div>
      </div>

      {/* Navigation */}
      <nav aria-label="Menú del portal" className="relative flex flex-1 flex-col gap-0.5">
        <div className="sidebar-section-label">MENÚ</div>
        {items.map(({ icon: Icon, label, to, end, badge }) => (
          <NavLink key={to} to={to} end={end} onClick={onNavigate} className={({ isActive }) => (isActive ? 'nav-item nav-item-active' : 'nav-item') + ' no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink/60'}>
            <Icon size={19} className="flex-shrink-0" />
            <span className="flex-1">{label}</span>
            {badge && (
              <span className="flex h-[19px] min-w-[20px] items-center justify-center rounded-full bg-pink px-1.5 text-[11px] font-bold text-white">
                {badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User profile */}
      <div className="relative flex items-center gap-2.5 rounded-[14px] border border-white/[0.08] bg-white/[0.04] px-3 py-2.5">
        <div className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-pink to-purple font-head text-[13px] font-bold text-white">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-white">{user?.first_name} {user?.last_name}</div>
          <div className="truncate text-[11px] text-white/45">{user?.email}</div>
        </div>
        <button aria-label="Cerrar sesión" title="Cerrar sesión" onClick={() => { void authApi.logout(); }} className="flex h-11 w-11 items-center justify-center rounded-[10px] text-white/35 transition-colors hover:text-pink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink/60">
          <LogOut size={17} />
        </button>
      </div>
    </aside>
  );
}
