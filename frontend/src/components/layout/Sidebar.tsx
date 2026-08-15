import { NavLink, Link } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { authApi } from '@/services/api';
import Logo from '@/components/ui/Logo';
import { Users, LogOut } from 'lucide-react';
import { navByRole, type Role } from './navConfig';

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
      className={`fixed inset-y-0 left-0 z-50 flex h-[100dvh] w-[264px] flex-shrink-0 flex-col gap-5 overflow-hidden border-r border-line bg-white px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] transition-transform duration-300 ease-out [padding-left:max(1rem,env(safe-area-inset-left))] lg:static lg:h-screen lg:translate-x-0 ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      {/* Logo */}
      <Link to="/" className="flex justify-center px-1 pb-1 pt-1" aria-label="Colegio Interlaken — Inicio">
        <Logo variant="stacked" size={84} theme="light" eager />
      </Link>

      {/* Role badge */}
      <div className="flex items-center gap-2.5 rounded-[14px] border border-purple/10 bg-purple/[0.055] px-3.5 py-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-purple/10 text-purple">
          <Users size={17} />
        </div>
        <div>
          <div className="font-head text-[9px] font-bold uppercase tracking-[1.8px] text-purple/55">Portal</div>
          <div className="font-head text-[13px] font-bold capitalize tracking-[0.5px] text-ink">{role}</div>
        </div>
      </div>

      {/* Navigation */}
      <nav aria-label="Menú del portal" className="scrollbar-none relative flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        <div className="px-3.5 pb-1 pt-2 font-head text-[9.5px] font-bold uppercase tracking-[1.8px] text-subtle">
          Menú
        </div>
        {items.map(({ icon: Icon, label, to, end, badge }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13.5px] font-medium no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 ${
                isActive
                  ? 'bg-purple text-white shadow-[0_6px_16px_-9px_rgba(64,26,142,0.65)]'
                  : 'text-muted hover:bg-cream-2 hover:text-ink'
              }`
            }
          >
            <Icon size={19} className="flex-shrink-0" />
            <span className="flex-1">{label}</span>
            {badge && (
              <span className="flex h-[19px] min-w-[20px] items-center justify-center rounded-full bg-coral px-1.5 text-[11px] font-bold text-white">
                {badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User profile */}
      <div className="flex items-center gap-2.5 rounded-[14px] border border-line bg-cream-2 px-3 py-2.5">
        <div className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-pink to-purple font-head text-[13px] font-bold text-white">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-ink">{user?.first_name} {user?.last_name}</div>
          <div className="truncate text-[11px] text-subtle">{user?.email}</div>
        </div>
        <button
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
          onClick={() => { void authApi.logout(); }}
          className="flex h-11 w-11 items-center justify-center rounded-[10px] text-subtle transition-colors hover:bg-coral/10 hover:text-coral focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral/40"
        >
          <LogOut size={17} />
        </button>
      </div>
    </aside>
  );
}
