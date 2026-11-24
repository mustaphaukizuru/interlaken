import { Link } from 'react-router-dom';
import { LogOut, ChevronDown, LayoutDashboard } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { useAuthStore } from '@/store/authStore';
import { authApi } from '@/services/api';
import { Avatar } from '@/components/ui/Avatar';
import { homePath } from '@/lib/areas';
import { accountEntries } from './navConfig';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrador', staff: 'Personal', student: 'Alumno', parent: 'Padre/Tutor',
};

/** 44 px menu row, shared look for links and the sign-out button. */
export const ACCOUNT_ROW =
  'flex min-h-[44px] w-full items-center gap-3 rounded-sm px-3 text-left text-sm font-medium transition-colors focus-visible:outline-none';

/** The avatar in a thin ring (a 2 px white gap, then a 1 px line that turns purple on hover). */
export function RingedAvatar({ user, size }: { user: Parameters<typeof Avatar>[0]['user']; size: number }) {
  return (
    <span className="flex shrink-0 rounded-full border border-ink/15 bg-white p-0.5 transition-colors group-hover:border-purple/40 group-aria-expanded:border-purple/60">
      <Avatar user={user} size={size} />
    </span>
  );
}

/**
 * Header avatar + account dropdown: identity, the shared account entries, sign out.
 * `public`: the public site's header when the visitor is signed in (owner,
 * 2026-11-23). It takes the place of «Portal Cafetería»: a divider, the
 * avatar in its ring and a chevron, and the menu starts with the way back to
 * the portal or console.
 */
export function AccountMenu({ variant = 'portal' }: { variant?: 'portal' | 'public' }) {
  const { user } = useAuthStore();
  const role = user?.role ?? 'parent';
  const home = homePath(user);
  // A staff member's portal-only login (role student + a «Personal del
  // colegio» cafetería account) reads as their puesto, never «Alumno».
  const staffAccount = role === 'student' && user?.cafeteria_account?.tipo === 'personal' ? user.cafeteria_account : null;
  const roleText = staffAccount
    ? (staffAccount.puesto && staffAccount.puesto !== 'sin_asignar' ? staffAccount.puesto_label : 'Personal del colegio')
    : (role === 'staff' && user?.staff_title) || (ROLE_LABEL[role] ?? role);

  return (
    <Dropdown
      width={286}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label="Cuenta"
          aria-expanded={open}
          aria-haspopup="true"
          className={`group flex h-11 min-w-[44px] shrink-0 items-center justify-center gap-2 rounded-sm px-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 ${
            variant === 'public' ? 'hover:bg-cream sm:gap-1.5 sm:pr-1.5' : 'hover:bg-ink/5 lg:gap-2.5 lg:pl-3'
          }`}
        >
          {variant === 'portal' && <span className="hidden text-right leading-tight lg:block">
            <span className="block text-[13px] font-semibold text-ink">
              {user?.first_name} {user?.last_name}
            </span>
            <span className="block text-xs text-subtle">{roleText}</span>
          </span>}
          <RingedAvatar user={user} size={variant === 'public' ? 32 : 30} />
          <ChevronDown size={16} aria-hidden="true" className={`hidden text-subtle transition-transform ${variant === 'public' ? 'sm:block' : 'lg:block'} ${open ? 'rotate-180' : ''}`} />
        </button>
      )}
    >
      {({ close }) => (
        <>
          <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
            <Avatar user={user} size={44} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink">
                {user?.first_name} {user?.last_name}
              </div>
              <div className="truncate text-xs text-subtle">{user?.email}</div>
            </div>
          </div>
          <div className="p-1.5">
            {[
              // From the public site: the way back in first.
              ...(variant === 'public' ? [{ icon: LayoutDashboard, label: role === 'admin' || role === 'staff' ? 'Ir a mi panel' : 'Ir a mi portal', to: home }] : []),
              ...accountEntries(role, home).filter((e) => variant === 'portal' || e.to !== home),
            ].map(({ icon: Icon, label, to }) => (
              <Link key={to} to={to} onClick={close} className={`${ACCOUNT_ROW} text-ink hover:bg-cream focus-visible:bg-cream`}>
                <Icon size={20} className="text-muted" aria-hidden="true" /> {label}
              </Link>
            ))}
          </div>
          <div className="border-t border-line p-1.5">
            <button
              type="button"
              onClick={() => { close(); void authApi.logout(); }}
              className={`${ACCOUNT_ROW} font-semibold text-danger hover:bg-danger-bg focus-visible:bg-danger-bg`}
            >
              <LogOut size={20} aria-hidden="true" /> Cerrar sesión
            </button>
          </div>
        </>
      )}
    </Dropdown>
  );
}

export default AccountMenu;
