/**
 * Header, menu and phone bar, version 3 (school, 2026-11-23):
 * - phones: logo + menu button; bottom bar «Pagos» → /pagos next to WhatsApp,
 *   hidden while the menu is open;
 * - menu: «Pagos de familias» (Portal Cafetería, Colegiaturas ↗), then
 *   «Agendar visita»;
 * - tablets: one «Pagos» button before the menu button;
 * - tablet and up: the «Agendar visita» pill in the purple top bar;
 * - laptops: «Portal Cafetería» and «Colegiaturas» with their full names.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';

const settings = vi.hoisted(() => ({ chrome: {} as Record<string, unknown> }));
vi.mock('@/services/api', () => ({
  contentApi: { getSettings: vi.fn(async () => ({ data: { whatsapp_number: '5215550000000', contact_email: 'info@interlaken.com.mx', chrome: settings.chrome } })) },
  portalApi: { getSiteNotices: vi.fn().mockResolvedValue({ data: [] }) },
}));

import { PublicLayout } from './PublicLayout';

const bar = () => document.querySelector<HTMLElement>('[data-sticky-cta]');

describe('header version 3', () => {
  it('phone bar: «Pagos» → /pagos with WhatsApp, hidden while the menu is open', async () => {
    renderWithProviders(<PublicLayout />, { route: '/' });
    const pay = await within(await vi.waitFor(() => bar()!)).findByRole('link', { name: 'Pagos' });
    expect(pay).toHaveAttribute('href', '/pagos');
    expect(pay.querySelector('svg')).not.toBeNull(); // the card icon
    expect(within(bar()!).getByRole('link', { name: 'Escribir por WhatsApp' })).toBeInTheDocument();
    expect(bar()).toHaveClass('md:hidden');

    await userEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Abrir menú' }));
    expect(bar()).toBeNull();
    await userEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Cerrar menú' }));
    expect(bar()).not.toBeNull();
  });

  it('menu: «Pagos de familias» first (Portal Cafetería, Colegiaturas in a new tab), then «Agendar visita»', async () => {
    renderWithProviders(<PublicLayout />, { route: '/' });
    await userEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Abrir menú' }));
    const panel = screen.getByRole('dialog', { name: 'Menú de navegación' });
    // Its contents load on demand (MobileMenu), and focus moves in.
    const group = await within(panel).findByRole('group', { name: 'Pagos de familias' });
    const links = within(group).getAllByRole('link');
    expect(links[0]).toHaveFocus();
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/login', 'https://interlaken.servoescolar.mx/']);
    expect(links[0]).toHaveAccessibleName('Portal Cafetería');
    expect(links[1]).toHaveAccessibleName('Colegiaturas (se abre en otra pestaña)');
    expect(links[1]).toHaveAttribute('target', '_blank');
    expect(links[1].getAttribute('rel')).toContain('noopener');

    // «Agendar visita» right after the block, before Contacto and the groups.
    const all = within(panel).getAllByRole('link');
    const visit = within(panel).getByRole('link', { name: 'Agendar visita' });
    expect(visit).toHaveAttribute('href', '/agendar-visita');
    expect(all.indexOf(visit)).toBe(2);
    expect(all[3]).toHaveAccessibleName('Contacto');
  });

  it('menu: a saved «Agendar visita» header button is not repeated in the payments block', async () => {
    settings.chrome = { header_buttons: [
      { label: 'Cafetería', href: '/login', icon: 'Coffee' },
      { label: 'Agendar visita', href: '/agendar-visita', primary: true },
    ] };
    try {
      renderWithProviders(<PublicLayout />, { route: '/' });
      const header = screen.getByRole('banner');
      await within(header).findAllByRole('link', { name: 'Cafetería' });
      await userEvent.click(within(header).getByRole('button', { name: 'Abrir menú' }));
      const panel = screen.getByRole('dialog', { name: 'Menú de navegación' });
      expect(within(await within(panel).findByRole('group', { name: 'Pagos de familias' })).getAllByRole('link')).toHaveLength(1);
      expect(within(panel).getAllByRole('link', { name: 'Agendar visita' })).toHaveLength(1);
    } finally {
      settings.chrome = {};
    }
  });

  it('tablet: one «Pagos» button before the menu button, only from 768 to 1023 px', async () => {
    renderWithProviders(<PublicLayout />, { route: '/' });
    const header = screen.getByRole('banner');
    const smallBar = within(header).getByRole('button', { name: 'Abrir menú' }).parentElement!;
    expect(smallBar).toHaveClass('lg:hidden');
    const pay = within(smallBar).getByRole('link', { name: 'Pagos' });
    expect(pay).toHaveAttribute('href', '/pagos');
    expect(pay).toHaveClass('hidden', 'md:inline-flex');
    // No icon-only payment button any more (version 3 dropped the «$»).
    expect(within(smallBar).getAllByRole('link')).toHaveLength(1);
  });

  it('purple top bar (tablet and up): the «Agendar visita» pill next to the email', async () => {
    renderWithProviders(<PublicLayout />, { route: '/' });
    const pill = document.querySelector<HTMLAnchorElement>('[data-visit-pill]')!;
    expect(pill).toHaveAccessibleName('Agendar visita');
    expect(pill).toHaveAttribute('href', '/agendar-visita');
    expect(pill).toHaveClass('rounded-full');
    expect(pill.closest('.hidden.md\\:block')).not.toBeNull();
    expect(pill.closest('header')).toBeNull();
    const emails = await screen.findAllByRole('link', { name: 'info@interlaken.com.mx' });
    // Same row as the pill (the footer has the email too), after a thin divider.
    const topEmail = emails.find((a) => a.parentElement === pill.parentElement)!;
    expect(topEmail).toBeDefined();
    expect(topEmail.previousElementSibling).toHaveClass('w-px');
  });

  it('laptop header: «Portal Cafetería» and «Colegiaturas» with their full names, no «Agendar visita»', async () => {
    renderWithProviders(<PublicLayout />, { route: '/' });
    const header = screen.getByRole('banner');
    const wide = within(header).getByRole('link', { name: 'Portal Cafetería', hidden: false }).parentElement!;
    expect(wide).toHaveClass('hidden', 'lg:flex');
    const links = within(wide).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(['Portal Cafetería', 'Colegiaturas (se abre en otra pestaña)']);
    expect(links[1]).toHaveAttribute('href', 'https://interlaken.servoescolar.mx/');
    // Full names at 1024 px too: the label is never screen-reader-only, and the padding tightens below 1150 px.
    for (const a of links) {
      expect(a.querySelectorAll('.sr-only')).toHaveLength(a === links[1] ? 1 : 0);
      expect(a).toHaveClass('px-2.5', 'min-[1150px]:px-3.5');
    }
    expect(within(header).queryByRole('link', { name: 'Agendar visita' })).not.toBeInTheDocument();
    expect(header.querySelector('nav')).toHaveClass('gap-3', 'min-[1150px]:gap-4');
  });
});
