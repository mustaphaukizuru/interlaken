import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from '@/store/authStore';
import { canOpen, consoleHome } from '@/lib/areas';

/**
 * The admin console for staff accounts: only the sections of their areas
 * (lib/areas.ts). A staff account without areas goes to /staff; a section it
 * may not open sends it to its first allowed one. The API enforces the same
 * rule, so this only spares a screen full of "sin permiso" errors.
 *
 * Rendered by the (lazy) PortalLayout, never by App.tsx: the public pages'
 * shared bundle must not carry the console rules (route budget, CI).
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
