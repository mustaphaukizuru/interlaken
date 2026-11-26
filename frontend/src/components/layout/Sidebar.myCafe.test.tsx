import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';

vi.mock('@/hooks/useBadges', () => ({ useBadges: () => ({}) }));
vi.mock('@/services/api', () => ({ authApi: { logout: vi.fn() } }));

import Sidebar from './Sidebar';
import { useAuthStore, type User } from '@/store/authStore';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';

/** «Mi cafetería» (2026-11-18): only a console user with their own staff wallet gets the entry. */
const account = { id: 9, tipo: 'personal' as const, puesto: 'direccion' as const, puesto_label: 'Dirección', is_active: true, linked: true };
const base: User = {
  id: 5, email: 'caja@test.mx', first_name: 'Caja', last_name: 'Central', full_name: 'Caja Central',
  role: 'admin', avatar: '', whatsapp: '',
};

describe('Sidebar «Mi cafetería»', () => {
  beforeEach(() => {
    localStorage.clear();
    stubViewport(1280);
  });

  it('adds the entry for an admin who holds a cafetería account, inside the console (owner, 2026-11-25)', () => {
    useAuthStore.setState({ user: { ...base, cafeteria_account: account }, accessToken: 't', isAuthenticated: true });
    renderWithProviders(<Sidebar role="admin" />, { route: '/admin' });
    expect(screen.getByRole('link', { name: /Mi cafetería/ })).toHaveAttribute('href', '/admin/mi-cafeteria');
    expect(screen.getByRole('link', { name: /^Usuarios/ })).toBeInTheDocument();
  });

  it('keeps the whole admin menu while «Mi cafetería» is open, with the entry highlighted', () => {
    useAuthStore.setState({ user: { ...base, cafeteria_account: account }, accessToken: 't', isAuthenticated: true });
    renderWithProviders(<Sidebar role="admin" />, { route: '/admin/mi-cafeteria' });
    expect(screen.getByRole('link', { name: /Mi cafetería/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /^Alumnos/ })).toBeInTheDocument();
    expect(screen.getAllByText('Administración').length).toBeGreaterThan(0);
  });

  it('adds it for staff with console areas too, inside the console', () => {
    useAuthStore.setState({ user: { ...base, role: 'staff', staff_areas: ['visitas'], cafeteria_account: account }, accessToken: 't', isAuthenticated: true });
    renderWithProviders(<Sidebar role="admin" />, { route: '/admin/visitas' });
    expect(screen.getByRole('link', { name: /Mi cafetería/ })).toHaveAttribute('href', '/admin/mi-cafeteria');
  });

  it('a staff login without console areas keeps the portal address', () => {
    useAuthStore.setState({ user: { ...base, role: 'staff', staff_areas: [], cafeteria_account: account }, accessToken: 't', isAuthenticated: true });
    renderWithProviders(<Sidebar role="staff" />, { route: '/staff' });
    expect(screen.getByRole('link', { name: /Mi cafetería/ })).toHaveAttribute('href', '/portal/mi-cafeteria');
  });

  it('never for an account without one', () => {
    useAuthStore.setState({ user: base, accessToken: 't', isAuthenticated: true });
    renderWithProviders(<Sidebar role="admin" />, { route: '/admin' });
    expect(screen.queryByRole('link', { name: /Mi cafetería/ })).toBeNull();
  });

  it('a staff member\'s portal-only login reads «Personal»: its own wallet is the portal «Cafetería»', () => {
    useAuthStore.setState({ user: { ...base, role: 'student', cafeteria_account: account }, accessToken: 't', isAuthenticated: true });
    renderWithProviders(<Sidebar role="parent" />, { route: '/portal' });
    // The family wallet page, relabelled; no console-style /portal/mi-cafeteria entry.
    expect(screen.getByRole('link', { name: /^Mi cafetería/ })).toHaveAttribute('href', '/portal/cafeteria');
    expect(screen.queryByRole('link', { name: /^Cafetería/ })).toBeNull();
    expect(screen.getAllByText('Personal').length).toBeGreaterThan(0);
    expect(screen.queryByText('Familia')).toBeNull();
  });

  it('a family login is unchanged: «Familia» and «Cafetería»', () => {
    useAuthStore.setState({ user: { ...base, role: 'parent' }, accessToken: 't', isAuthenticated: true });
    renderWithProviders(<Sidebar role="parent" />, { route: '/portal' });
    expect(screen.getByRole('link', { name: /^Cafetería/ })).toHaveAttribute('href', '/portal/cafeteria');
    expect(screen.getAllByText('Familia').length).toBeGreaterThan(0);
    expect(screen.queryByText('Personal')).toBeNull();
  });
});
