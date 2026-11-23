/**
 * Navegación › «Dónde se muestra» = «Solo ícono en celular y tableta» (owner,
 * 2026-11-23: «Colegiaturas»). The button leaves the laptop header and the
 * mobile menu and shows only as an icon in the phone/tablet bar, next to the
 * call and menu buttons. Breakpoints are classes (jsdom has no layout), so the
 * test checks which container holds the link.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';

vi.mock('@/services/api', () => ({
  contentApi: {
    getSettings: vi.fn().mockResolvedValue({
      data: {
        chrome: {
          header_buttons: [
            { label: 'Cafetería', href: '/login', icon: 'Coffee', primary: false },
            { label: 'Colegiaturas', href: 'https://interlaken.servoescolar.mx', icon: 'CircleDollarSign', primary: false, placement: 'mobile_icon' },
            { label: 'Agendar visita', href: '/agendar-visita', primary: true },
          ],
        },
      },
    }),
  },
  portalApi: { getSiteNotices: vi.fn().mockResolvedValue({ data: [] }) },
}));

import { PublicLayout } from './PublicLayout';

describe('header button shown only as an icon on phones and tablets', () => {
  it('is an icon next to the menu button, hidden from 1024 px up, and opens the tuition site in a new tab', async () => {
    renderWithProviders(<PublicLayout />);
    const header = screen.getByRole('banner');
    const icon = await within(header).findByRole('link', { name: 'Colegiaturas' });
    expect(icon).toHaveAttribute('href', 'https://interlaken.servoescolar.mx');
    expect(icon).toHaveAttribute('target', '_blank');
    expect(icon).toHaveAttribute('title', 'Colegiaturas');
    // Only the icon is seen; the text is for screen readers at every width.
    expect(icon.querySelector('svg')).not.toBeNull();
    expect(icon.querySelector('span')).toHaveClass('sr-only');
    expect(icon.querySelector('span')!.className).not.toContain('not-sr-only');
    // Same group as the burger, which is lg:hidden.
    const bar = within(header).getByRole('button', { name: 'Abrir menú' }).parentElement!;
    expect(bar).toHaveClass('lg:hidden');
    expect(bar).toContainElement(icon);
  });

  it('is not one of the laptop header buttons, which stay «Cafetería» and «Agendar visita» with their names', async () => {
    renderWithProviders(<PublicLayout />);
    const header = screen.getByRole('banner');
    const cafe = await within(header).findByRole('link', { name: 'Cafetería' });
    const wide = cafe.parentElement!;
    expect(wide).toHaveClass('hidden', 'lg:flex');
    expect(within(wide).getAllByRole('link').map((a) => a.textContent)).toEqual(['Cafetería', 'Agendar visita']);
    // Two buttons left: names always show (no icon-only compact mode).
    expect(cafe.querySelector('.sr-only')).toBeNull();
  });

  it('is not repeated inside the mobile menu', async () => {
    renderWithProviders(<PublicLayout />);
    const header = screen.getByRole('banner');
    await within(header).findByRole('link', { name: 'Cafetería' });
    await userEvent.click(within(header).getByRole('button', { name: 'Abrir menú' }));
    const menu = screen.getByRole('dialog', { name: 'Menú de navegación' });
    expect(within(menu).getByRole('link', { name: 'Cafetería' })).toBeInTheDocument();
    expect(within(menu).queryByRole('link', { name: 'Colegiaturas' })).not.toBeInTheDocument();
  });
});
