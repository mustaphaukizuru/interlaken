import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { canOpen, consoleHome, homePath } from '@/lib/areas';
import type { ReactNode } from 'react';
import type { User } from '@/types';

interface Props {
  children: ReactNode;
  roles?: User['role'][];
}

export function ProtectedRoute({ children, roles }: Props) {
  const { isAuthenticated, user } = useAuthStore();
  const location = useLocation();

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (roles && !roles.includes(user.role)) {
    // Back to the user's own home (families /portal, admins /admin, staff
    // their console area or /staff).
    return <Navigate to={homePath(user)} replace />;
  }

  return <>{children}</>;
}

/**
 * The admin console for staff accounts: only the sections of their areas
 * (lib/areas.ts). A staff account without areas goes to /staff; a section it
 * may not open sends it to its first allowed one. The API enforces the same
 * rule, so this only spares a screen full of "sin permiso" errors.
 */
export function ConsoleAreaGuard({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const { pathname } = useLocation();
  if (!user || user.role === 'admin') return <>{children}</>;
  const home = consoleHome(user);
  if (!home) return <Navigate to="/staff" replace />;
  if (!canOpen(user, pathname)) return <Navigate to={home} replace />;
  return <>{children}</>;
}
