import { useEffect, useRef, useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { authApi } from '@/services/api';
import Logo from '@/components/ui/Logo';
import { Users, LogOut, PanelLeftClose, PanelLeftOpen, ChevronUp } from 'lucide-react';
import { navGroupsByRole, type Role } from './navConfig';
import { useBadges } from '@/hooks/useBadges';
import { Avatar } from '@/components/ui/Avatar';

interface SidebarProps {
  role: Role;
  /** Drawer open state (mobile only). */
  open?: boolean;
  onNavigate?: () => void;
}

const COLLAPSE_KEY = 'portal.sidebar.collapsed';
const ROLE_LABEL: Record<string, string> = { admin: 'Administración', staff: 'Personal', student: 'Familia', parent: 'Familia' };

function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
}

/**
 * Portal sidebar: grouped navigation with live badges (BACKLOG P1-E2/E3), a
 * collapsible icon rail on desktop (E1) and a user card that opens the account
 * actions (E5). On phones it is the off-canvas drawer (swipe-left closes).
 */
export default function Sidebar({ role, open = false, onNavigate }: SidebarProps) {
  const { user } = useAuthStore();
  const badges = useBadges();
  const groups = navGroupsByRole[role] ?? navGroupsByRole.parent;
  const asideRef = useRef<HTMLElement>(null);
  const touchX = useRef<number | null>(null);
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); } catch { /* private mode */ }
      return !c;
    });
  };

  // Mobile drawer (BACKLOG P1-B5): move focus in when it opens so keyboard and
  // screen-reader users land on the menu, and let a leftward swipe close it.
  useEffect(() => {
    if (!open) return;
    if (window.matchMedia?.('(min-width: 1024px)').matches) return;
    asideRef.current?.querySelector<HTMLElement>('a, button')?.focus();
  }, [open]);
  const onTouchStart = (e: React.TouchEvent) => { touchX.current = e.touches[0]?.clientX ?? null; };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchX.current;
    touchX.current = null;
    if (start === null) return;
    const dx = (e.changedTouches[0]?.clientX ?? start) - start;
    if (dx < -60) onNavigate?.();
  };

  // Collapsed rail only applies at lg+ (the drawer is always full width).
  const rail = collapsed;

  return (
    <aside
      ref={asideRef}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      aria-label="Navegación del portal"
      data-collapsed={rail || undefined}
      className={`fixed inset-y-0 left-0 z-50 flex h-[100dvh] w-[264px] flex-shrink-0 flex-col gap-4 overflow-hidden border-r border-line bg-white px-4 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] transition-[transform,width] duration-300 ease-out [padding-left:max(1rem,env(safe-area-inset-left))] lg:static lg:h-screen lg:translate-x-0 ${
        open ? 'translate-x-0' : '-translate-x-full'
      } ${rail ? 'lg:w-[76px] lg:px-2.5' : ''}`}
    >
      {/* Logo + collapse toggle */}
      <div className={`flex items-center ${rail ? 'lg:flex-col lg:gap-2' : 'justify-between'}`}>
        <Link to="/" className="flex justify-center px-1" aria-label="Colegio Interlaken — Inicio">
          <Logo variant={rail ? 'icon' : 'stacked'} size={rail ? 40 : 76} theme="light" eager />
        </Link>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={rail ? 'Expandir menú' : 'Contraer menú'}
          aria-pressed={rail}
          className="hidden h-9 w-9 items-center justify-center rounded-lg text-subtle hover:bg-cream-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 lg:flex"
        >
          {rail ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      {/* Role badge */}
      {!rail && (
        <div className="flex items-center gap-2.5 rounded-[14px] border border-purple/10 bg-purple/[0.055] px-3.5 py-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-purple/10 text-purple">
            <Users size={17} />
          </div>
          <div>
            <div className="font-head text-[9px] font-bold uppercase tracking-[1.8px] text-purple/55">Portal</div>
            <div className="font-head text-[13px] font-bold tracking-[0.5px] text-ink">{ROLE_LABEL[role] ?? role}</div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav aria-label="Menú del portal" className="scrollbar-none relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {groups.map((group) => (
          <div key={group.heading}>
            {!rail && (
              <div className="px-3.5 pb-1 pt-1 font-head text-[9.5px] font-bold uppercase tracking-[1.8px] text-subtle">
                {group.heading}
              </div>
            )}
            {rail && <div className="mx-auto mb-1 h-px w-8 bg-line" aria-hidden="true" />}
            <div className="flex flex-col gap-0.5">
              {group.items.map(({ icon: Icon, label, to, end, badgeKey }) => {
                const count = badgeKey ? badges[badgeKey] ?? 0 : 0;
                return (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    onClick={onNavigate}
                    title={rail ? label : undefined}
                    aria-label={count ? `${label}, ${count} pendientes` : label}
                    className={({ isActive }) =>
                      `relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13.5px] font-medium no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 ${
                        rail ? 'lg:justify-center lg:px-0' : ''
                      } ${
                        isActive
                          ? 'bg-purple text-white shadow-[0_6px_16px_-9px_rgba(64,26,142,0.65)]'
                          : 'text-muted hover:bg-cream-2 hover:text-ink'
                      }`
                    }
                  >
                    <Icon size={19} className="flex-shrink-0" />
                    <span className={`flex-1 ${rail ? 'lg:hidden' : ''}`}>{label}</span>
                    {count > 0 && (
                      <span className={`flex h-[19px] min-w-[20px] items-center justify-center rounded-full bg-coral px-1.5 text-[11px] font-bold text-white ${rail ? 'lg:absolute lg:-right-0.5 lg:-top-0.5 lg:h-4 lg:min-w-[16px] lg:px-1 lg:text-[10px]' : ''}`}>
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User card → account actions (P1-E5) */}
      <div className="relative">
        {menuOpen && (
          <div role="menu" className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-[14px] border border-line bg-white p-1.5 shadow-card">
            <Link role="menuitem" to="/portal/perfil" onClick={() => { setMenuOpen(false); onNavigate?.(); }} className="block rounded-lg px-3 py-2 text-sm text-ink hover:bg-cream-2">Mi perfil</Link>
            <Link role="menuitem" to="/portal/notificaciones" onClick={() => { setMenuOpen(false); onNavigate?.(); }} className="block rounded-lg px-3 py-2 text-sm text-ink hover:bg-cream-2">Notificaciones</Link>
            <Link role="menuitem" to="/" onClick={() => setMenuOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-ink hover:bg-cream-2">Sitio público</Link>
            <button role="menuitem" type="button" onClick={() => { void authApi.logout(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-coral hover:bg-coral/10">
              <LogOut size={15} /> Cerrar sesión
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Opciones de la cuenta"
          className={`flex w-full items-center gap-2.5 rounded-[14px] border border-line bg-cream-2 px-3 py-2.5 text-left hover:border-purple/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 ${rail ? 'lg:justify-center lg:px-0' : ''}`}
        >
          <Avatar user={user} size={38} rounded="rounded-[10px]" />
          <div className={`min-w-0 flex-1 ${rail ? 'lg:hidden' : ''}`}>
            <div className="truncate text-[13px] font-semibold text-ink">{user?.first_name} {user?.last_name}</div>
            <div className="truncate text-[11px] text-subtle">{user?.email}</div>
          </div>
          <ChevronUp size={15} className={`text-subtle transition-transform ${menuOpen ? 'rotate-180' : ''} ${rail ? 'lg:hidden' : ''}`} />
        </button>
      </div>
    </aside>
  );
}
