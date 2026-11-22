import { ConsoleAreaGuard } from './ConsoleAreaGuard';
import { Outlet, useLocation } from 'react-router-dom';
import { useAppBadge } from '@/hooks/useAppBadge';
import { useBadges } from '@/hooks/useBadges';
import { OfflineBanner } from '@/components/portal/OfflineBanner';
import { useIdleLogout } from '@/hooks/useIdleLogout';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Sidebar from './Sidebar';
import AppHeader from './AppHeader';
import MobileTabBar from './MobileTabBar';
import { RouteTransition } from './RouteTransition';
import { CommandPalette } from '@/components/admin/CommandPalette';
import { SITE_NAME } from '@/lib/siteMeta';
import { navGroupsByRole } from './navConfig';

interface Props {
  role: 'parent' | 'student' | 'admin' | 'staff';
}

/**
 * Per-route document titles for authenticated surfaces. The public site gets
 * its titles from <RouteSeo> (react-helmet-async); portal routes set them here
 * directly so screen-reader users hear where a navigation landed.
 */
const EXPLICIT_TITLES: Record<string, string> = {
  '/portal': 'Inicio',
  '/portal/pagos': 'Pagos',
  '/portal/cafeteria': 'Cafetería',
  '/portal/mi-cafeteria': 'Mi cafetería',
  '/portal/mi-cafeteria/credencial': 'Credencial',
  '/portal/credencial': 'Credencial',
  '/portal/inscripciones': 'Inscripciones',
  '/portal/comunicados': 'Comunicados',
  '/portal/perfil': 'Mi perfil',
  '/portal/privacidad': 'Privacidad',
  '/admin': 'Dashboard',
  '/admin/alumnos': 'Alumnos',
  '/admin/admisiones': 'Admisiones',
  '/admin/visitas': 'Visitas',
  '/admin/cafeteria': 'Cafetería',
  '/admin/comunicados': 'Comunicados',
  '/admin/ajustes': 'Ajustes',
  '/staff': 'Analítica',
};
// Every sidebar entry titles its own route; the explicit map wins on overlap.
const PORTAL_TITLES: Record<string, string> = Object.values(navGroupsByRole)
  .flatMap((groups) => groups.flatMap((g) => g.items))
  .reduce<Record<string, string>>((acc, { to, label }) => (acc[to] ? acc : { ...acc, [to]: label }), { ...EXPLICIT_TITLES });

/** Exact match first; detail routes (…/comunicados/:id) inherit their section title. */
function portalTitleFor(pathname: string): string | undefined {
  if (PORTAL_TITLES[pathname]) return PORTAL_TITLES[pathname];
  const prefix = Object.keys(PORTAL_TITLES)
    .filter((k) => pathname.startsWith(`${k}/`))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? PORTAL_TITLES[prefix] : undefined;
}

/**
 * Shared mobile-nav state. AppHeader (hamburger, search, notifications, account)
 * is rendered by PortalLayout on every authenticated route; page titles live in
 * content via <PageHeader>. MobileTabBar / Sidebar consume this context too.
 * (The header is flat now: no depth cue on scroll, so no scroll state here.)
 */
interface MobileNavCtx {
  open: boolean;
  toggle: () => void;
  close: () => void;
}

const MobileNavContext = createContext<MobileNavCtx>({
  open: false,
  toggle: () => {},
  close: () => {},
});

export function useMobileNav() {
  return useContext(MobileNavContext);
}

export function PortalLayout({ role }: Props) {
  // Staff accounts in the admin console: only the sections of their areas.
  if (role === 'admin') return <ConsoleAreaGuard><PortalShell role={role} /></ConsoleAreaGuard>;
  return <PortalShell role={role} />;
}

function PortalShell({ role }: Props) {
  useIdleLogout(role === 'admin' || role === 'staff');
  const badges = useBadges();
  useAppBadge(badges.notificaciones);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  // Only the content column scrolls (the sidebar + header stay fixed), so reset
  // it to the top on each navigation — otherwise a new page opens mid-scroll.
  const scrollRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [pathname]);

  // Announce the current page in the tab title on each portal navigation.
  useEffect(() => {
    const title = portalTitleFor(pathname);
    if (title) document.title = `${title} · ${SITE_NAME}`;
  }, [pathname]);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  return (
    <MobileNavContext.Provider value={{ open, toggle, close }}>
      {/* The frame is exactly the viewport and never scrolls: `relative` makes it
          the containing block of every absolutely positioned descendant and
          `frame-clip` clips them, so nothing (a table's sr-only <caption>, a
          menu near the bottom) can make the page taller than the screen and
          slide the whole console up, leaving an empty band underneath. */}
      {/* Print: the frame grows with its content (one page otherwise) and the
          chrome hides itself (print:hidden on the header, bars and drawer). */}
      <div className="frame-clip relative flex h-[100dvh] flex-col bg-cream print:block print:h-auto print:overflow-visible print:bg-white">
        <OfflineBanner />
        <div className="flex min-h-0 flex-1 print:block">
        <a href="#contenido" className="skip-link">Saltar al contenido</a>
        {/* Off-canvas backdrop (mobile only) */}
        <div
          onClick={close}
          aria-hidden="true"
          className={`fixed inset-0 z-dropdown bg-dark/55 transition-opacity duration-300 print:hidden lg:hidden ${
            open ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        />

        {/* Sidebar: off-canvas drawer on mobile, static on desktop */}
        <Sidebar role={role} open={open} onNavigate={close} />

        {/* Global search (Ctrl/Cmd+K) — admin workflows only */}
        <CommandPalette />

        {/* Main — sidebar + header stay fixed; only this content column scrolls */}
        <main id="contenido" className="frame-clip flex min-w-0 flex-1 flex-col print:block print:overflow-visible">
          <AppHeader />
          {/* `relative`: page content positions against this column, so it
              scrolls with the content instead of stretching the document. */}
          <div
            ref={scrollRef}
            className="relative flex-1 overflow-y-auto overflow-x-hidden print:overflow-visible"
          >
            <div className="mx-auto w-full max-w-[1320px] 2xl:max-w-[1680px] px-[clamp(16px,4vw,32px)] pt-6 pb-[calc(76px+env(safe-area-inset-bottom))] print:max-w-none print:p-0 lg:pb-6">
              <RouteTransition><Outlet /></RouteTransition>
            </div>
          </div>
        </main>

        {/* Staff analytics is a single-route surface — no bottom tab bar. */}
        {role !== 'staff' && <MobileTabBar role={role} />}
        </div>
      </div>
    </MobileNavContext.Provider>
  );
}

export default PortalLayout;
