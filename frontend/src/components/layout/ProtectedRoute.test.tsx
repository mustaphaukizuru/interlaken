import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { useAuthStore, type User } from '@/store/authStore';

const adminUser: User = {
  id: 1,
  email: 'admin@test.mx',
  first_name: 'Ada',
  last_name: 'Admin',
  full_name: 'Ada Admin',
  role: 'admin',
  avatar: '',
  whatsapp: '',
};

function renderAt(path: string, roles?: User['role'][]) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<div>LOGIN PAGE</div>} />
        <Route path="/portal" element={<div>PORTAL HOME</div>} />
        <Route
          path="/admin"
          element={
            <ProtectedRoute roles={roles}>
              <div>ADMIN CONTENT</div>
            </ProtectedRoute>
          }
        />
        <Route
          path="/staff"
          element={
            <ProtectedRoute roles={['staff', 'admin']}>
              <div>STAFF DASHBOARD</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      accessToken: null,
      isAuthenticated: false,
    });
  });

  it('redirects unauthenticated users to /login', () => {
    renderAt('/admin', ['admin']);
    expect(screen.getByText('LOGIN PAGE')).toBeInTheDocument();
    expect(screen.queryByText('ADMIN CONTENT')).not.toBeInTheDocument();
  });

  it('renders children when the role is allowed', () => {
    useAuthStore.setState({ user: adminUser, isAuthenticated: true });
    renderAt('/admin', ['admin']);
    expect(screen.getByText('ADMIN CONTENT')).toBeInTheDocument();
  });

  it('redirects to the role home when the role is not allowed', () => {
    useAuthStore.setState({
      user: { ...adminUser, role: 'parent' },
      isAuthenticated: true,
    });
    renderAt('/admin', ['admin']);
    // A parent hitting an admin-only route is sent to their portal, not the content.
    expect(screen.getByText('PORTAL HOME')).toBeInTheDocument();
    expect(screen.queryByText('ADMIN CONTENT')).not.toBeInTheDocument();
  });

  it('renders children when no roles are required and the user is authenticated', () => {
    useAuthStore.setState({ user: adminUser, isAuthenticated: true });
    renderAt('/admin');
    expect(screen.getByText('ADMIN CONTENT')).toBeInTheDocument();
  });

  // /staff guard (IK-ADMIN item 9): staff and admin in, everyone else out.
  it('lets staff into /staff', () => {
    useAuthStore.setState({
      user: { ...adminUser, role: 'staff' },
      isAuthenticated: true,
    });
    renderAt('/staff');
    expect(screen.getByText('STAFF DASHBOARD')).toBeInTheDocument();
  });

  it('lets admin into /staff', () => {
    useAuthStore.setState({ user: adminUser, isAuthenticated: true });
    renderAt('/staff');
    expect(screen.getByText('STAFF DASHBOARD')).toBeInTheDocument();
  });

  it('redirects a parent away from /staff to their portal', () => {
    useAuthStore.setState({
      user: { ...adminUser, role: 'parent' },
      isAuthenticated: true,
    });
    renderAt('/staff');
    expect(screen.getByText('PORTAL HOME')).toBeInTheDocument();
    expect(screen.queryByText('STAFF DASHBOARD')).not.toBeInTheDocument();
  });

  it('redirects anonymous visitors of /staff to /login', () => {
    renderAt('/staff');
    expect(screen.getByText('LOGIN PAGE')).toBeInTheDocument();
    expect(screen.queryByText('STAFF DASHBOARD')).not.toBeInTheDocument();
  });
});
