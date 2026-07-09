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

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (roles && !roles.includes(user.role)) {
    // Redirect to the user's home portal based on role
    const rolePaths: Record<User['role'], string> = {
      parent:  '/portal',
      student: '/alumno',
      admin:   '/admin',
      staff:   '/staff',
    };
    return <Navigate to={rolePaths[user.role]} replace />;
  }

  return <>{children}</>;
}
