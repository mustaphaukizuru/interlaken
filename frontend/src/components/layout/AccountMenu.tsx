import { Link } from 'react-router-dom';
import { LogOut, Settings, LayoutDashboard, ChevronDown, User as UserIcon } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { useAuthStore } from '@/store/authStore';
import { authApi } from '@/services/api';

const HOME: Record<string, string> = {
  admin: '/admin', staff: '/staff', student: '/portal', parent: '/portal',
};
const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrador', staff: 'Personal', student: 'Alumno', parent: 'Padre/Tutor',
};

/** Header avatar + account dropdown: identity, quick links, sign out. */
export function AccountMenu() {
  const { user } = useAuthStore();
  const role = user?.role ?? 'parent';
  const initials =
    `${user?.first_name?.[0] ?? ''}${user?.last_name?.[0] ?? ''}`.toUpperCase() || '?';
  const home = HOME[role] ?? '/portal';

  return (
    <Dropdown
      width={286}
      label="Cuenta"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label="Cuenta"
          aria-expanded={open}
          className="flex shrink-0 items-center gap-2.5 rounded-2xl border border-line bg-white py-1.5 pl-3.5 pr-2.5 shadow-card transition-colors hover:border-purple/30"
        >
          <div className="hidden text-right leading-tight sm:block">
            <div className="text-[13px] font-semibold text-ink">
              {user?.first_name} {user?.last_name}
            </div>
            <div className="text-[11px] text-subtle">{ROLE_LABEL[role] ?? role}</div>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-gradient-to-br from-pink to-purple font-head text-[13px] font-bold text-white">
            {initials}
          </div>
          <ChevronDown size={15} className={`text-subtle transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      )}
    >
      {({ close }) => (
        <>
          <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-pink to-purple font-head text-sm font-bold text-white">
              {initials}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink">
                {user?.first_name} {user?.last_name}
              </div>
              <div className="truncate text-xs text-subtle">{user?.email}</div>
            </div>
          </div>
          <div className="p-1.5">
            <Link
              to={home}
              onClick={close}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-cream"
            >
              <LayoutDashboard size={16} className="text-muted" /> Mi panel
            </Link>
            <Link
              to="/portal/perfil"
              onClick={close}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-cream"
            >
              <UserIcon size={16} className="text-muted" /> Mi información
            </Link>
            {role === 'admin' && (
              <Link
                to="/admin/ajustes"
                onClick={close}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-cream"
              >
                <Settings size={16} className="text-muted" /> Ajustes
              </Link>
            )}
          </div>
          <div className="border-t border-line p-1.5">
            <button
              type="button"
              onClick={() => { close(); void authApi.logout(); }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-semibold text-coral transition-colors hover:bg-coral/10"
            >
              <LogOut size={16} /> Cerrar sesión
            </button>
          </div>
        </>
      )}
    </Dropdown>
  );
}

export default AccountMenu;
