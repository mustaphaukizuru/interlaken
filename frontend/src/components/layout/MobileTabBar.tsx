import { NavLink } from 'react-router-dom';
import { navByRole, type Role } from './navConfig';

/**
 * Always-visible primary navigation on phones — the drawer is for the full menu,
 * this keeps the 3–5 core destinations one tap away. Hidden at lg+ where the
 * static sidebar is present.
 */
export default function MobileTabBar({ role }: { role: Role }) {
  const items = (navByRole[role] ?? navByRole.parent).slice(0, 5);

  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_24px_-12px_rgba(64,26,142,0.25)] backdrop-blur-lg lg:hidden"
    >
      {items.map(({ icon: Icon, label, to, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex min-w-0 flex-1 flex-col items-center gap-1 pb-1.5 pt-2 text-[10px] font-semibold focus-visible:outline-none ${
              isActive ? 'text-purple' : 'text-subtle'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <span
                className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${
                  isActive ? 'bg-purple/10' : ''
                }`}
              >
                <Icon size={19} />
              </span>
              <span className="max-w-full truncate px-0.5">{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
