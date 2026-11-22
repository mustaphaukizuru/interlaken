import { Menu, Search } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useMobileNav } from './PortalLayout';
import { NotificationsMenu } from './NotificationsMenu';
import { AccountMenu } from './AccountMenu';
import { QuickActions } from './QuickActions';
import { HEADER_ICON_BUTTON } from './navConfig';
import { HeaderChildSwitcher } from '@/components/portal/HeaderChildSwitcher';
import { useFamilyChildren } from '@/components/portal/familyChildren';

/**
 * Shell-level top chrome, rendered by PortalLayout on EVERY authenticated route.
 * One flat bar with a bottom hairline (Phase 4.7): the hamburger (phones), the
 * family's child switcher, then at most three targets on the right at 360 px
 * (search is desktop only): avisos and the account menu (plus quick actions
 * for admins). The thin brand gradient line above it stays: it is identity.
 * Page titles live in the content area via <PageHeader>.
 */
export default function AppHeader() {
  const { open, toggle } = useMobileNav();
  const { user } = useAuthStore();
  // Families with two or more children: the switcher takes the brand's place
  // on phones (the brand is in the drawer), so the bar never overflows 360 px.
  const { children } = useFamilyChildren();
  const switcher = children.length > 1;

  return (
    <>
      <div className="accent-bar print:hidden" />
      <header className="z-header flex min-h-[60px] items-center gap-2 border-b border-line bg-cream px-2 py-2 print:hidden sm:gap-3 sm:px-4 lg:px-6">
        {/* Mobile hamburger: the single source of drawer access on every page */}
        <button
          type="button"
          onClick={toggle}
          aria-label="Abrir menú"
          aria-expanded={open}
          className={`${HEADER_ICON_BUTTON} lg:hidden`}
        >
          <Menu size={24} aria-hidden="true" />
        </button>

        {switcher ? (
          <HeaderChildSwitcher />
        ) : (
          // Brand cue on mobile (drawer is hidden)
          <span className="font-head text-[15px] font-extrabold tracking-tight text-ink lg:hidden">
            Interlaken
          </span>
        )}

        <div className="flex-1" />

        {/* Ctrl K palette: admins search alumnos/reservas, families and staff jump to
            sections (P1-E7). Desktop only: on phones the tab bar is the navigation. */}
        {user && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
            aria-label={user.role === 'admin' ? 'Buscar alumnos o reservas' : 'Ir a una sección'}
            className="hidden min-h-[44px] w-[230px] items-center gap-2 rounded-sm border border-line bg-white px-3.5 text-left transition-colors hover:border-purple/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 lg:flex"
          >
            <Search size={16} className="text-subtle" aria-hidden="true" />
            <span className="flex-1 text-[13px] text-subtle">{user.role === 'admin' ? 'Buscar…' : 'Ir a…'}</span>
            <kbd className="rounded-sm border border-line px-1.5 py-0.5 text-[11px] font-semibold text-subtle">Ctrl K</kbd>
          </button>
        )}

        {user?.role === 'admin' && <QuickActions />}
        <NotificationsMenu />
        <AccountMenu />
      </header>
    </>
  );
}
