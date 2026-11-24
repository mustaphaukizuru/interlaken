import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { mobileNavByRole, navByRole, type NavEntry, type Role } from './navConfig';
import { canOpen, isAdmin } from '@/lib/areas';
import { useAuthStore } from '@/store/authStore';
import { useBadges } from '@/hooks/useBadges';

/**
 * Always-visible primary navigation on phones and tablets — the drawer is for
 * the full menu, this keeps the curated daily destinations one tap away.
 * Hidden at lg+ where the static sidebar is present.
 *
 * Look (owner, 2026-11-23): a floating white bar. Over the active tab the top
 * edge rises into a small bump with a purple dot; when the tab changes, the
 * bump glides to the new one, the dot pops in and the icon lifts. Motion lives
 * in index.css (.tabbar-*) and is switched off for reduced motion.
 */

/** True while the on-screen keyboard shrinks the visual viewport (BACKLOG P1-B5). */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const check = () => setOpen(vv.height < window.innerHeight * 0.75);
    vv.addEventListener('resize', check);
    return () => vv.removeEventListener('resize', check);
  }, []);
  return open;
}

/** The tab NavLink would mark active (same rule: `end` = exact, else the path or below it). */
function activeTabIndex(items: Pick<NavEntry, 'to' | 'end'>[], pathname: string): number {
  const path = pathname.replace(/\/+$/, '').toLowerCase() || '/';
  return items.findIndex(({ to, end }) => {
    const target = to.replace(/\/+$/, '').toLowerCase() || '/';
    return path === target || (!end && path.startsWith(`${target}/`));
  });
}

export default function MobileTabBar({ role }: { role: Role }) {
  const user = useAuthStore((s) => s.user);
  const { pathname } = useLocation();
  // Staff in the console: their own sections (first five), not the admin's.
  // Every role's tabs pass the same check: a staff account never gets the
  // admin-only /staff tabs (QA 2026-11-24).
  const items = (role === 'admin' && user && !isAdmin(user)
    ? navByRole.admin.filter((item) => canOpen(user, item.to)).slice(0, 5)
    : mobileNavByRole[role] ?? mobileNavByRole.parent
  ).filter((item) => canOpen(user, item.to));
  const keyboardOpen = useKeyboardOpen();
  const badges = useBadges();
  if (keyboardOpen || items.length === 0) return null;

  const active = activeTabIndex(items, pathname);

  return (
    <nav
      aria-label="Navegación principal"
      // data-bottom-bar: the cookie banner lifts itself above this bar (CookieBanner.tsx).
      data-bottom-bar=""
      className="fixed inset-x-2 bottom-[max(8px,env(safe-area-inset-bottom))] z-sticky mx-auto max-w-[560px] rounded-md bg-white px-1 shadow-[0_14px_34px_-12px_rgba(26,17,48,0.34),0_-2px_14px_-6px_rgba(26,17,48,0.14)] min-[360px]:px-2 print:hidden lg:hidden"
    >
      {/* Equal columns: every destination gets the same width and tap area (no label decides the layout). */}
      <div className="relative grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {/* The bump + dot: one column wide, moved a whole column per tab. */}
        <span
          aria-hidden="true"
          data-tab-marker=""
          className={`tabbar-marker pointer-events-none absolute left-0 top-0 h-0 ${active < 0 ? 'opacity-0' : 'opacity-100'}`}
          style={{ width: `${100 / items.length}%`, transform: `translateX(${Math.max(active, 0) * 100}%)` }}
        >
          {/* A round-topped dome, as wide as the tab (80 px at most), stretched to fit. */}
          <svg viewBox="0 0 72 14" preserveAspectRatio="none" className="absolute -bottom-px left-1/2 h-3.5 w-full max-w-[80px] -translate-x-1/2 fill-white drop-shadow-[0_-3px_3px_rgba(26,17,48,0.07)]">
            <path d="M0 14C9 14 13 12.5 17 9C23 3 28 1 36 1S49 3 55 9C59 12.5 63 14 72 14Z" />
          </svg>
          {/* Keyed by tab: it pops in again on every change. */}
          <span key={active} className="tabbar-dot absolute -top-[17px] left-1/2 size-2.5 rounded-full bg-purple ring-[3px] ring-white" />
        </span>

        {items.map(({ icon: Icon, label, to, end, badgeKey }) => {
          const count = badgeKey ? badges[badgeKey] ?? 0 : 0;
          return (
            <NavLink
              key={to}
              to={to}
              end={end}
              aria-label={count > 0 ? `${label}, ${count} pendientes` : undefined}
              className={({ isActive }) =>
                `tabbar-item group flex min-h-[60px] min-w-0 flex-col items-center justify-center gap-1 rounded-sm pb-2 pt-2.5 [@media(orientation:landscape)_and_(max-height:500px)]:min-h-[48px] [@media(orientation:landscape)_and_(max-height:500px)]:py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple/40 ${
                  isActive ? 'text-purple' : 'text-ink/75 hover:text-ink'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className="tabbar-icon relative flex h-6 w-10 items-center justify-center">
                    <Icon size={22} strokeWidth={isActive ? 2.2 : 1.7} aria-hidden="true" />
                    {count > 0 && (
                      <span aria-hidden="true" className="absolute -top-1.5 right-0 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-coral px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                  </span>
                  {/* 10 px on the narrowest phones, 10.5 px from 360 px: «Comunicados» and «Admisiones» fit whole. */}
                  <span className={`w-full truncate px-px text-center text-[10px] leading-none tracking-[-0.03em] min-[360px]:text-[10.5px] min-[360px]:tracking-[-0.01em] [@media(orientation:landscape)_and_(max-height:500px)]:sr-only ${isActive ? 'font-bold text-purple' : 'font-medium text-subtle group-hover:text-ink'}`}>{label}</span>
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
