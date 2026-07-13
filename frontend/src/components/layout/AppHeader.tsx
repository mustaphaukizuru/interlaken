import { Menu, Search } from 'lucide-react';
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

        {/* Search — desktop only for now */}
        <div className="hidden w-[220px] items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-[9px] shadow-card lg:flex">
          <Search size={15} className="text-subtle" />
          <input
            placeholder="Buscar…"
            aria-label="Buscar"
            className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-ink outline-none"
          />
        </div>

        <NotificationsMenu />
        <AccountMenu />
      </header>
    </>
  );
}
