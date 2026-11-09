import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import type { ReactNode } from 'react';
import type { User } from '@/types';

interface Props {
  children: ReactNode;
  roles?: User['role'][];
}

export function ProtectedRoute({ children, roles }: Props) {
  const { isAuthenticated, user } = useAuthStore();
  const location = useLocation();

  // Links emailed before 2026-11-08 point at /portal/perfil?…&verificar_correo=<token>.
  // Confirming needs no sign-in now: send them to the public page first.
  const legacyToken = new URLSearchParams(location.search).get('verificar_correo');
  if (legacyToken) {
    return <Navigate to={`/confirmar-correo?token=${encodeURIComponent(legacyToken)}`} replace />;
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (roles && !roles.includes(user.role)) {
    // Redirect to the user's home portal based on role
    const rolePaths: Record<User['role'], string> = {
      parent:  '/portal',
      student: '/portal', // student == family login → the shared family portal
      admin:   '/admin',
      staff:   '/staff',
    };
    return <Navigate to={rolePaths[user.role]} replace />;
  }

  return <>{children}</>;
}
