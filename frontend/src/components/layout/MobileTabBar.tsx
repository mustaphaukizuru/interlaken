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
      className="fixed inset-x-0 bottom-0 z-sticky flex border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg print:hidden lg:hidden"
    >
      {items.map(({ icon: Icon, label, to, end, badgeKey }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex min-h-[56px] min-w-0 flex-1 flex-col items-center gap-0.5 rounded-sm pb-1.5 pt-1.5 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple/40 ${
              isActive ? 'text-purple' : 'text-subtle'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <span
                className={`relative flex h-7 w-12 items-center justify-center rounded-sm transition-colors ${
                  isActive ? 'bg-purple/10' : ''
                }`}
              >
                <Icon size={24} aria-hidden="true" />
                {badgeKey && (badges[badgeKey] ?? 0) > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-coral px-1 text-[9px] font-bold text-white" aria-label={`${badges[badgeKey]} pendientes`}>
                    {(badges[badgeKey] ?? 0) > 99 ? '99+' : badges[badgeKey]}
                  </span>
                )}
              </span>
              <span className="max-w-full truncate px-0.5">{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
