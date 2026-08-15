import { Menu, Search } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useMobileNav } from './PortalLayout';
import { NotificationsMenu } from './NotificationsMenu';
import { AccountMenu } from './AccountMenu';

/**
 * Shell-level top chrome, rendered by PortalLayout on EVERY authenticated route.
 * Owns the mobile hamburger (so the drawer is reachable everywhere, not just the
 * dashboards) plus search, the notifications bell, and the account menu. Page
 * titles live in the content area via <PageHeader>.
 */
export default function AppHeader() {
  const { open, toggle, scrolled } = useMobileNav();
  const { user } = useAuthStore();

  return (
    <>
      <div className="accent-bar" />
      <header
        className={`z-30 flex items-center gap-3 border-b border-line bg-cream/95 px-4 py-3 transition-shadow duration-200 sm:gap-4 sm:px-6 lg:px-8 ${
          scrolled ? 'shadow-[0_10px_24px_-18px_rgba(16,12,40,0.55)]' : ''
        }`}
      >
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

        {/* Global search — opens the ⌘K command palette. Admin-only: other roles
            have no global-search surface, so we don't show a dead box. */}
        {user?.role === 'admin' && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
            aria-label="Buscar alumnos o reservas"
            className="hidden w-[230px] items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-[9px] text-left shadow-card transition-colors hover:border-purple/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 lg:flex"
          >
            <Search size={15} className="text-subtle" aria-hidden="true" />
            <span className="flex-1 text-[13px] text-subtle">Buscar…</span>
            <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] font-semibold text-subtle">Ctrl K</kbd>
          </button>
        )}

        <NotificationsMenu />
        <AccountMenu />
      </header>
    </>
  );
}
