import { Outlet, useLocation } from 'react-router-dom';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Sidebar from './Sidebar';
import AppHeader from './AppHeader';
import MobileTabBar from './MobileTabBar';
import { RouteTransition } from './RouteTransition';
import { CommandPalette } from '@/components/admin/CommandPalette';

interface Props {
  role: 'parent' | 'student' | 'admin' | 'staff';
}

/**
 * Shared mobile-nav state. TopBar is rendered by each page (inside <Outlet/>),
 * so it consumes this context to reach the hamburger toggle owned by PortalLayout.
 */
interface MobileNavCtx {
  open: boolean;
  toggle: () => void;
  close: () => void;
  /** True once the content column has scrolled — drives the header's depth cue. */
  scrolled: boolean;
}

const MobileNavContext = createContext<MobileNavCtx>({
  open: false,
  toggle: () => {},
  close: () => {},
  scrolled: false,
});

export function useMobileNav() {
  return useContext(MobileNavContext);
}

export function PortalLayout({ role }: Props) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  const [scrolled, setScrolled] = useState(false);

  // Only the content column scrolls (the sidebar + header stay fixed), so reset
  // it to the top on each navigation — otherwise a new page opens mid-scroll.
  const scrollRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [pathname]);

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
    <MobileNavContext.Provider value={{ open, toggle, close, scrolled }}>
      <div className="flex h-[100dvh] overflow-hidden bg-cream">
        <a href="#contenido" className="skip-link">Saltar al contenido</a>
        {/* Off-canvas backdrop (mobile only) */}
        <div
          onClick={close}
          aria-hidden="true"
          className={`fixed inset-0 z-40 bg-dark/55 backdrop-blur-[2px] transition-opacity duration-300 lg:hidden ${
            open ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        />

        {/* Sidebar: off-canvas drawer on mobile, static on desktop */}
        <Sidebar role={role} open={open} onNavigate={close} />

        {/* Global search (Ctrl/Cmd+K) — admin workflows only */}
        {role === 'admin' && <CommandPalette />}

        {/* Main — sidebar + header stay fixed; only this content column scrolls */}
        <main id="contenido" className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <AppHeader />
          <div
            ref={scrollRef}
            onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}
            className="flex-1 overflow-y-auto overflow-x-hidden"
          >
            <div className="mx-auto w-full max-w-[1400px] px-[clamp(16px,4vw,32px)] pt-6 pb-[calc(76px+env(safe-area-inset-bottom))] lg:pb-6">
              <RouteTransition><Outlet /></RouteTransition>
            </div>
          </div>
        </main>

        {/* Always-visible primary nav on phones (staff has its own shell) */}
        {role !== 'staff' && <MobileTabBar role={role} />}
      </div>
    </MobileNavContext.Provider>
  );
}

export default PortalLayout;
