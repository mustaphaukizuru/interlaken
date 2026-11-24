/**
 * The phone/tablet tab bar (owner, 2026-11-23): a floating bar whose bump and
 * dot sit over the active tab and move a whole column per tab.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const badges = vi.hoisted(() => ({ current: {} as Record<string, number> }));
vi.mock('@/hooks/useBadges', () => ({ useBadges: () => badges.current }));

import MobileTabBar from './MobileTabBar';
import { useAuthStore, type User } from '@/store/authStore';
import { renderWithProviders } from '@/test/renderWithProviders';

const parent: User = { id: 2, email: 'familia@test.mx', first_name: 'Ana', last_name: 'Demo', full_name: 'Ana Demo', role: 'parent', avatar: '', whatsapp: '' };
const admin: User = { id: 1, email: 'direccion@test.mx', first_name: 'Dirección', last_name: 'Demo', full_name: 'Dirección Demo', role: 'admin', avatar: '', whatsapp: '' };

const marker = () => document.querySelector<HTMLElement>('[data-tab-marker]')!;

describe('MobileTabBar', () => {
  beforeEach(() => { badges.current = {}; });

  it('families: five tabs, the bump over «Credencial» on its page', () => {
    useAuthStore.setState({ user: parent, accessToken: 't', isAuthenticated: true });
    renderWithProviders(<MobileTabBar role="parent" />, { route: '/portal/credencial' });
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Inicio', 'Cafetería', 'Credencial', 'Avisos', 'Pagos']);
    expect(within(nav).getByRole('link', { name: 'Credencial' })).toHaveAttribute('aria-current', 'page');
    expect(marker().style.width).toBe('20%');
    expect(marker().style.transform).toBe('translateX(200%)');
    expect(marker()).toHaveClass('opacity-100');
    // Floating: off the screen edges, phones and tablets only.
    expect(nav).toHaveClass('fixed', 'inset-x-2', 'rounded-md', 'lg:hidden');
  });

  it('a page below a tab keeps that tab active; «Inicio» only on its own page', () => {
    useAuthStore.setState({ user: parent, accessToken: 't', isAuthenticated: true });
    renderWithProviders(<MobileTabBar role="parent" />, { route: '/portal/cafeteria/historial' });
    expect(marker().style.transform).toBe('translateX(100%)');
  });

  it('the bump moves with the tab the user taps', async () => {
    useAuthStore.setState({ user: parent, accessToken: 't', isAuthenticated: true });
    renderWithProviders(<MobileTabBar role="parent" />, { route: '/portal' });
    expect(marker().style.transform).toBe('translateX(0%)');
    await userEvent.click(screen.getByRole('link', { name: 'Pagos' }));
    expect(marker().style.transform).toBe('translateX(400%)');
    expect(screen.getByRole('link', { name: 'Pagos' })).toHaveAttribute('aria-current', 'page');
  });

  it('no tab for the page (e.g. «Mi perfil»): the bump hides', () => {
    useAuthStore.setState({ user: parent, accessToken: 't', isAuthenticated: true });
    renderWithProviders(<MobileTabBar role="parent" />, { route: '/portal/perfil' });
    expect(marker()).toHaveClass('opacity-0');
    expect(screen.queryByRole('link', { current: 'page' })).not.toBeInTheDocument();
  });

  it('admin: the console tabs, with their pending counts', () => {
    badges.current = { admisiones: 4 };
    useAuthStore.setState({ user: admin, accessToken: 't', isAuthenticated: true });
    renderWithProviders(<MobileTabBar role="admin" />, { route: '/admin/admisiones' });
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect(within(nav).getAllByRole('link')).toHaveLength(5);
    expect(within(nav).getByRole('link', { name: 'Admisiones, 4 pendientes' })).toHaveAttribute('aria-current', 'page');
    expect(marker().style.transform).toBe('translateX(400%)');
  });
});

describe('MobileTabBar on a phone held sideways', () => {
  it('shows only the icons (the names stay for screen readers) and a shorter bar', () => {
    useAuthStore.setState({ user: parent, accessToken: 't', isAuthenticated: true });
    renderWithProviders(<MobileTabBar role="parent" />, { route: '/portal' });
    const tab = screen.getByRole('link', { name: 'Inicio' });
    const LANDSCAPE = '[@media(orientation:landscape)_and_(max-height:500px)]';
    expect(tab.className).toContain(`${LANDSCAPE}:min-h-[48px]`);
    expect(within(tab).getByText('Inicio').className).toContain(`${LANDSCAPE}:sr-only`);
  });
});
