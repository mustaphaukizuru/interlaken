import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';

vi.mock('@/hooks/useBadges', () => ({ useBadges: () => ({ cafeteria: 2 }) }));
vi.mock('@/services/api', () => ({ authApi: { logout: vi.fn() } }));

import Sidebar from './Sidebar';
import { useAuthStore, type User } from '@/store/authStore';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';

const base: User = {
  id: 5, email: 'caja@test.mx', first_name: 'Caja', last_name: 'Demo', full_name: 'Caja Demo',
  role: 'staff', avatar: '', whatsapp: '',
};

describe('Sidebar for staff with console areas', () => {
  beforeEach(() => {
    localStorage.clear();
    stubViewport(1280);
  });

  it('shows only the sections of the account’s areas, never the admin-only «Panel de Dirección» (QA 2026-11-24)', () => {
    useAuthStore.setState({ user: { ...base, staff_areas: ['cafeteria'], staff_title: 'Cafetería' }, accessToken: 't', isAuthenticated: true });
    renderWithProviders(<Sidebar role="admin" />, { route: '/admin/cafeteria' });
    expect(screen.getByRole('link', { name: /Cafetería/ })).toHaveAttribute('href', '/admin/cafeteria');
    expect(screen.getByRole('link', { name: /^Pagos/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Analítica/ })).not.toBeInTheDocument();
    for (const hidden of ['Inicio', 'Alumnos', 'Usuarios', 'Ajustes', 'Auditoría', 'Comunicados']) {
      expect(screen.queryByRole('link', { name: new RegExp(`^${hidden}`) })).not.toBeInTheDocument();
    }
  });

  it('on /staff a staff account sees no «Analítica», «Páginas» or «Biblioteca de medios» (QA 2026-11-24)', () => {
    useAuthStore.setState({ user: { ...base, staff_areas: [] }, accessToken: 't', isAuthenticated: true });
    renderWithProviders(<Sidebar role="staff" />, { route: '/staff' });
    for (const hidden of [/Analítica/, /^Páginas/, /Biblioteca de medios/]) {
      expect(screen.queryByRole('link', { name: hidden })).not.toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: /^Portal/ })).toHaveAttribute('href', '/portal');
  });

  it('gives the staff dashboard a way back into the console', () => {
    useAuthStore.setState({ user: { ...base, staff_areas: ['visitas', 'mensajes'], staff_title: 'Recepción' }, accessToken: 't', isAuthenticated: true });
    renderWithProviders(<Sidebar role="staff" />, { route: '/staff' });
    expect(screen.getByRole('link', { name: /Recepción/ })).toHaveAttribute('href', '/admin/visitas');
  });

  it('leaves the admin menu whole for an admin', () => {
    useAuthStore.setState({ user: { ...base, role: 'admin' }, accessToken: 't', isAuthenticated: true });
    renderWithProviders(<Sidebar role="admin" />, { route: '/admin' });
    expect(screen.getByRole('link', { name: /^Usuarios/ })).toBeInTheDocument();
    // Plain Spanish, not «Dashboard», and no em-dash in the logo's name (QA 2026-11-24).
    expect(screen.getByRole('link', { name: /^Inicio/ })).toHaveAttribute('href', '/admin');
    expect(screen.queryByRole('link', { name: /Dashboard/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Colegio Interlaken, ir al inicio' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: /Analítica/ })).not.toBeInTheDocument();
  });
});
