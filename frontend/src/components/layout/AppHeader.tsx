import { Bell, Menu, Search } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useMobileNav } from './PortalLayout';

/**
 * Shell-level top chrome, rendered by PortalLayout on EVERY authenticated route.
 * Owns the mobile hamburger (so the drawer is reachable everywhere, not just the
 * dashboards) plus the search / notifications / account affordances. Page titles
 * live in the content area via <PageHeader>.
 */
export default function AppHeader() {
  const { user } = useAuthStore();
  const { open, toggle } = useMobileNav();
  const initials =
    `${user?.first_name?.[0] ?? ''}${user?.last_name?.[0] ?? ''}`.toUpperCase() || '?';

  return (
    <>
      <div className="accent-bar" />
      <header className="sticky top-[3px] z-30 flex items-center gap-3 border-b border-line bg-cream/90 px-4 py-3 backdrop-blur-[14px] sm:gap-4 sm:px-6 lg:px-8">
        {/* Mobile hamburger — the single source of drawer access on every page */}
        <button
          type="button"
          onClick={toggle}
          aria-label="Abrir menú"
          aria-expanded={open}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-dark text-white shadow-[0_8px_20px_-6px_rgba(64,26,142,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink/60 lg:hidden"
        >
          <Menu size={20} />
        </button>

        {/* Brand cue on mobile (drawer is hidden) */}
        <span className="font-head text-[15px] font-extrabold tracking-tight text-ink lg:hidden">
          Interlaken
        </span>

        <div className="flex-1" />

        {/* Search — desktop only for now */}
        <div className="hidden w-[220px] items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-[9px] shadow-card lg:flex">
          <Search size={15} className="text-subtle" />
          <input
            placeholder="Buscar…"
            aria-label="Buscar"
            className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-ink outline-none"
          />
        </div>

        <button
          type="button"
          aria-label="Notificaciones"
          className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-white shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink/60"
        >
          <Bell size={19} className="text-muted" />
        </button>

        <div className="flex shrink-0 items-center gap-2.5 rounded-2xl border border-line bg-white py-1.5 pl-3.5 pr-3 shadow-card">
          <div className="hidden text-right leading-tight sm:block">
            <div className="text-[13px] font-semibold text-ink">
              {user?.first_name} {user?.last_name}
            </div>
            <div className="text-[11px] capitalize text-subtle">{user?.role}</div>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-gradient-to-br from-pink to-purple font-head text-[13px] font-bold text-white">
            {initials}
          </div>
        </div>
      </header>
    </>
  );
}
