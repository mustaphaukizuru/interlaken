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

  it('adds the entry for an admin who holds a cafetería account, console untouched', () => {
    useAuthStore.setState({ user: { ...base, cafeteria_account: account }, accessToken: 't', isAuthenticated: true });
    renderWithProviders(<Sidebar role="admin" />, { route: '/admin' });
    expect(screen.getByRole('link', { name: /Mi cafetería/ })).toHaveAttribute('href', '/portal/mi-cafeteria');
    expect(screen.getByRole('link', { name: /^Usuarios/ })).toBeInTheDocument();
  });

  it('adds it for staff with console areas too', () => {
    useAuthStore.setState({ user: { ...base, role: 'staff', staff_areas: ['visitas'], cafeteria_account: account }, accessToken: 't', isAuthenticated: true });
    renderWithProviders(<Sidebar role="admin" />, { route: '/admin/visitas' });
    expect(screen.getByRole('link', { name: /Mi cafetería/ })).toBeInTheDocument();
  });

  it('never for an account without one, nor for a family login (its «Cafetería» is the wallet)', () => {
    useAuthStore.setState({ user: base, accessToken: 't', isAuthenticated: true });
    const { unmount } = renderWithProviders(<Sidebar role="admin" />, { route: '/admin' });
    expect(screen.queryByRole('link', { name: /Mi cafetería/ })).toBeNull();
    unmount();
    useAuthStore.setState({ user: { ...base, role: 'student', cafeteria_account: account }, accessToken: 't', isAuthenticated: true });
    renderWithProviders(<Sidebar role="parent" />, { route: '/portal' });
    expect(screen.queryByRole('link', { name: /Mi cafetería/ })).toBeNull();
    expect(screen.getByRole('link', { name: /^Cafetería/ })).toHaveAttribute('href', '/portal/cafeteria');
  });
});
