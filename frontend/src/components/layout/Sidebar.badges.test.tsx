import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';

const badges = vi.hoisted(() => ({ current: {} as Record<string, number> }));
vi.mock('@/hooks/useBadges', () => ({ useBadges: () => badges.current }));
vi.mock('@/services/api', () => ({ authApi: { logout: vi.fn() } }));

import Sidebar from './Sidebar';
import { useAuthStore, type User } from '@/store/authStore';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';

const admin: User = {
  id: 1, email: 'direccion@test.mx', first_name: 'Dirección', last_name: 'Demo', full_name: 'Dirección Demo',
  role: 'admin', avatar: '', whatsapp: '',
};

describe('Sidebar «Por verificar» next to Cafetería', () => {
  beforeEach(() => {
    localStorage.clear();
    stubViewport(1280);
    useAuthStore.setState({ user: admin, accessToken: 't', isAuthenticated: true });
  });

  it('shows «Por verificar: N» under Cafetería, beside the usual count', () => {
    badges.current = { cafeteria: 3, cafeteria_verificar: 2 };
    renderWithProviders(<Sidebar role="admin" />, { route: '/admin' });
    const link = screen.getByRole('link', { name: 'Cafetería, 3 pendientes, por verificar: 2' });
    expect(link).toHaveAttribute('href', '/admin/cafeteria');
    expect(link).toHaveTextContent('Por verificar: 2');
    expect(link).toHaveTextContent('3');
  });

  it('stays out of the way when nothing waits for MultiCobros', () => {
    badges.current = { cafeteria: 1, cafeteria_verificar: 0 };
    renderWithProviders(<Sidebar role="admin" />, { route: '/admin' });
    const link = screen.getByRole('link', { name: 'Cafetería, 1 pendientes' });
    expect(link).not.toHaveTextContent('Por verificar');
  });

  it('an older server without the key changes nothing', () => {
    badges.current = { cafeteria: 2 };
    renderWithProviders(<Sidebar role="admin" />, { route: '/admin/cafeteria' });
    expect(screen.getByRole('link', { name: 'Cafetería, 2 pendientes' })).not.toHaveTextContent('Por verificar');
  });
});
