/**
 * Signed in, the public header shows the visitor's avatar (in a thin ring,
 * with a chevron) where «Portal Cafetería» was, on every screen size (owner,
 * 2026-11-23). Signed out, nothing changes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { useAuthStore, type User } from '@/store/authStore';

vi.mock('@/services/api', () => ({
  contentApi: {
    getSettings: vi.fn().mockResolvedValue({
      data: {
        chrome: {
          header_buttons: [
            { label: 'Portal Cafetería', href: '/login', icon: 'Coffee', primary: false },
            { label: 'Colegiaturas', href: 'https://interlaken.servoescolar.mx/', icon: 'CreditCard', primary: false },
          ],
        },
      },
    }),
  },
  portalApi: { getSiteNotices: vi.fn().mockResolvedValue({ data: [] }) },
  authApi: { logout: vi.fn() },
}));

import { PublicLayout } from './PublicLayout';

const parent: User = { id: 2, email: 'familia@test.mx', first_name: 'Ana', last_name: 'López', full_name: 'Ana López', role: 'parent', avatar: '', whatsapp: '' };

describe('public header when signed in', () => {
  afterEach(() => useAuthStore.setState({ user: null, accessToken: null, isAuthenticated: false }));

  it('signed out: «Portal Cafetería» as usual and no avatar', async () => {
    renderWithProviders(<PublicLayout />);
    const header = screen.getByRole('banner');
    expect((await within(header).findAllByRole('link', { name: 'Portal Cafetería' }))[0]).toHaveAttribute('href', '/login');
    expect(within(header).queryByRole('button', { name: 'Cuenta' })).not.toBeInTheDocument();
  });

  it('signed in: the avatar replaces «Portal Cafetería» on laptops and on phones', async () => {
    useAuthStore.setState({ user: parent, accessToken: 't', isAuthenticated: true });
    renderWithProviders(<PublicLayout />);
    const header = screen.getByRole('banner');
    const menus = await within(header).findAllByRole('button', { name: 'Cuenta' });
    // One in the laptop header (after a divider), one in the phone/tablet bar.
    expect(menus).toHaveLength(2);
    expect(menus[0].closest('.lg\\:flex')).not.toBeNull();
    expect(menus[1].closest('.lg\\:hidden')).not.toBeNull();
    // Initials in the thin ring while there is no photo.
    expect(menus[0]).toHaveTextContent('AL');
    expect(menus[0].querySelector('.rounded-full.border.p-0\\.5')).not.toBeNull();
    await within(header).findByRole('link', { name: 'Colegiaturas (se abre en otra pestaña)' });
    expect(within(header).queryByRole('link', { name: 'Portal Cafetería' })).not.toBeInTheDocument();
  });

  it('the menu opens with the way back to the portal, then the account and sign out', async () => {
    useAuthStore.setState({ user: parent, accessToken: 't', isAuthenticated: true });
    renderWithProviders(<PublicLayout />);
    const [menu] = await within(screen.getByRole('banner')).findAllByRole('button', { name: 'Cuenta' });
    await userEvent.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Ir a mi portal' })).toHaveAttribute('href', '/portal');
    expect(screen.getByRole('link', { name: 'Mi perfil' })).toHaveAttribute('href', '/portal/perfil');
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
  });

  it('the phone menu keeps the whole «Pagos de familias» block (version 3: the avatar is in the bar)', async () => {
    useAuthStore.setState({ user: parent, accessToken: 't', isAuthenticated: true });
    renderWithProviders(<PublicLayout />);
    const header = screen.getByRole('banner');
    await within(header).findAllByRole('button', { name: 'Cuenta' });
    await userEvent.click(within(header).getByRole('button', { name: 'Abrir menú' }));
    const panel = screen.getByRole('dialog', { name: 'Menú de navegación' });
    const block = await within(panel).findByRole('group', { name: 'Pagos de familias' });
    // A signed-in family goes straight to its cafetería (not to /login and its redirect).
    expect(within(block).getByRole('link', { name: 'Portal Cafetería' })).toHaveAttribute('href', '/portal/cafeteria');
    expect(within(panel).getByRole('link', { name: 'Agendar visita' })).toBeInTheDocument();
  });
});
