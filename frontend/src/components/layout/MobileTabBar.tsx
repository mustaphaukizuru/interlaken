import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { mobileNavByRole, navByRole, type Role } from './navConfig';
import { canOpen, isAdmin } from '@/lib/areas';
import { useAuthStore } from '@/store/authStore';
import { useBadges } from '@/hooks/useBadges';

/**
 * Always-visible primary navigation on phones — the drawer is for the full menu,
 * this keeps the curated daily destinations one tap away. Hidden at lg+ where the
 * static sidebar is present.
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

export default function MobileTabBar({ role }: { role: Role }) {
  const user = useAuthStore((s) => s.user);
  // Staff in the console: their own sections (first five), not the admin's.
  const items = role === 'admin' && user && !isAdmin(user)
    ? navByRole.admin.filter((item) => canOpen(user, item.to)).slice(0, 5)
    : mobileNavByRole[role] ?? mobileNavByRole.parent;
  const keyboardOpen = useKeyboardOpen();
  const badges = useBadges();
  if (keyboardOpen) return null;

  return (
    <nav
      aria-label="Navegación principal"
      // data-bottom-bar: the cookie banner lifts itself above this bar (CookieBanner.tsx).
      data-bottom-bar=""
      // Equal columns: every destination gets the same width and tap area (no label decides the layout).
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      className="fixed inset-x-0 bottom-0 z-sticky grid border-t border-line bg-white/95 px-0 min-[360px]:px-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_20px_-12px_rgba(26,17,48,0.18)] backdrop-blur-lg print:hidden lg:hidden"
    >
      {items.map(({ icon: Icon, label, to, end, badgeKey }) => {
        const count = badgeKey ? badges[badgeKey] ?? 0 : 0;
        return (
          <NavLink
            key={to}
            to={to}
            end={end}
            aria-label={count > 0 ? `${label}, ${count} pendientes` : undefined}
            className={({ isActive }) =>
              `group flex min-h-[64px] min-w-0 flex-col items-center justify-center gap-1 rounded-sm py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple/40 ${
                isActive ? 'text-purple' : 'text-subtle hover:text-ink'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {/* Active indicator behind the icon (the label stays plain text, never a pill). */}
                <span
                  className={`relative flex h-8 w-14 items-center justify-center rounded-md transition-colors duration-200 ${
                    isActive ? 'bg-purple/10' : 'group-hover:bg-cream-2'
                  }`}
                >
                  <Icon size={22} strokeWidth={isActive ? 2.3 : 1.8} aria-hidden="true" />
                  {count > 0 && (
                    <span aria-hidden="true" className="absolute -top-1 right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-coral px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </span>
                {/* 11 px from 360 px wide, 10 px on the narrowest phones: «Comunicados» fits whole. */}
                <span className={`w-full truncate px-px text-center text-[10px] leading-none tracking-[-0.035em] min-[360px]:text-[11px] min-[360px]:tracking-[-0.01em] ${isActive ? 'font-bold' : 'font-semibold'}`}>{label}</span>
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}
