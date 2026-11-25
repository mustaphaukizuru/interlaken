import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { CreatePasswordScreen } from '@/components/portal/CreatePasswordScreen';
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

  // A temporary password from the school: «Cree su contraseña» before any
  // portal or console page. Once saved, this same route renders the page the
  // person was going to (the login's destination or a deep link).
  if (user.password_change_required) {
    return <CreatePasswordScreen />;
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
