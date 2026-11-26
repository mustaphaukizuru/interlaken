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

  it('shows «Por verificar: N» under Cafetería as its own link to exactly those top-ups (owner, 2026-11-25)', () => {
    badges.current = { cafeteria: 3, cafeteria_verificar: 2 };
    renderWithProviders(<Sidebar role="admin" />, { route: '/admin' });
    const entry = screen.getByRole('link', { name: 'Cafetería, 3 pendientes' });
    expect(entry).toHaveAttribute('href', '/admin/cafeteria');
    expect(entry).toHaveTextContent('3');
    // A sibling link, never an anchor nested inside the entry's anchor.
    const verify = screen.getByRole('link', { name: 'Por verificar: 2. Ver la lista' });
    expect(verify).toHaveAttribute('href', '/admin/cafeteria?tab=deposits&revisar=verificar');
    expect(verify).toHaveTextContent('Por verificar: 2');
    expect(entry.contains(verify)).toBe(false);
    expect(verify.parentElement?.closest('a')).toBeNull();
  });

  it('marks the «Por verificar» link as the current page on that list', () => {
    badges.current = { cafeteria: 3, cafeteria_verificar: 2 };
    renderWithProviders(<Sidebar role="admin" />, { route: '/admin/cafeteria?tab=deposits&revisar=verificar' });
    expect(screen.getByRole('link', { name: 'Por verificar: 2. Ver la lista' })).toHaveAttribute('aria-current', 'page');
  });

  it('stays out of the way when nothing waits for MultiCobros', () => {
    badges.current = { cafeteria: 1, cafeteria_verificar: 0 };
    renderWithProviders(<Sidebar role="admin" />, { route: '/admin' });
    const link = screen.getByRole('link', { name: 'Cafetería, 1 pendientes' });
    expect(link).not.toHaveTextContent('Por verificar');
    expect(screen.queryByRole('link', { name: /Por verificar/ })).toBeNull();
  });

  it('an older server without the key changes nothing', () => {
    badges.current = { cafeteria: 2 };
    renderWithProviders(<Sidebar role="admin" />, { route: '/admin/cafeteria' });
    expect(screen.getByRole('link', { name: 'Cafetería, 2 pendientes' })).not.toHaveTextContent('Por verificar');
  });
});

describe('Sidebar Visitas (owner 2026-11-25: the dot counts the people coming)', () => {
  beforeEach(() => {
    localStorage.clear();
    stubViewport(1280);
    useAuthStore.setState({ user: admin, accessToken: 't', isAuthenticated: true });
  });

  it('shows the upcoming visits as the red dot and «Por cerrar: N» as a link to exactly those', () => {
    badges.current = { visitas: 3, visitas_cerrar: 1 };
    renderWithProviders(<Sidebar role="admin" />, { route: '/admin' });
    const entry = screen.getByRole('link', { name: 'Visitas, 3 pendientes' });
    expect(entry).toHaveAttribute('href', '/admin/visitas');
    expect(entry).toHaveTextContent('3');
    // Its own link (integration of PR 1's sub-badge links), never nested in the entry.
    const close = screen.getByRole('link', { name: 'Por cerrar: 1. Ver la lista' });
    expect(close).toHaveAttribute('href', '/admin/visitas?seguimiento=por_cerrar');
    expect(entry.contains(close)).toBe(false);
  });

  it('hides «Por cerrar» when every past visit is closed', () => {
    badges.current = { visitas: 2, visitas_cerrar: 0 };
    renderWithProviders(<Sidebar role="admin" />, { route: '/admin' });
    expect(screen.getByRole('link', { name: 'Visitas, 2 pendientes' })).not.toHaveTextContent('Por cerrar');
  });
});
