/**
 * Header version 3 refinements (2026-11-23): what a tap leaves behind, the
 * shared «Agendar visita» text, «Pagos» as the current page, the visit not
 * repeated inside the phone menu's «Admisiones», the bar's WhatsApp message,
 * «Volver arriba» on the bar's right edge, the counted clicks, and an axe pass
 * with the menu open.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { renderWithProviders } from '@/test/renderWithProviders';

const settings = vi.hoisted(() => ({ chrome: {} as Record<string, unknown> }));
vi.mock('@/services/api', () => ({
  contentApi: { getSettings: vi.fn(async () => ({ data: { whatsapp_number: '5215550000000', contact_email: 'info@interlaken.com.mx', chrome: settings.chrome } })) },
  portalApi: { getSiteNotices: vi.fn().mockResolvedValue({ data: [] }) },
}));
const tracked = vi.hoisted(() => [] as [string, Record<string, unknown> | undefined][]);
vi.mock('@/services/analytics', async (orig) => ({
  ...(await orig<typeof import('@/services/analytics')>()),
  trackEvent: (name: string, props?: Record<string, unknown>) => { tracked.push([name, props]); },
}));

import { PublicLayout } from './PublicLayout';

afterEach(() => { settings.chrome = {}; tracked.length = 0; });

const openMenu = async () => {
  await userEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Abrir menú' }));
  return screen.getByRole('dialog', { name: 'Menú de navegación' });
};

describe('header version 3, refinements', () => {
  it('a tap leaves no ring or hover colour: rings are for the keyboard, hover only where it exists', async () => {
    renderWithProviders(<PublicLayout />, { route: '/' });
    const menuButton = within(screen.getByRole('banner')).getByRole('button', { name: 'Abrir menú' });
    expect(menuButton.className).toContain('[@media(hover:hover)]:hover:bg-cream');
    expect(menuButton.className).toContain('focus-visible:ring-2');
    expect(menuButton.className).not.toMatch(/(^| )hover:bg-cream/);
    const panel = await openMenu();
    const groupButton = within(panel).getByRole('button', { name: 'Admisiones' });
    expect(groupButton.className).not.toMatch(/(^| )hover:bg-cream/);
  });

  it('«Agendar visita» is one text: the bubble\'s, also on the pill and the menu button', async () => {
    settings.chrome = { float_visit: 'Visítenos' };
    renderWithProviders(<PublicLayout />, { route: '/' });
    const pill = document.querySelector<HTMLAnchorElement>('[data-visit-pill]')!;
    await vi.waitFor(() => expect(pill).toHaveAccessibleName('Visítenos'));
    const panel = await openMenu();
    expect(within(panel).getByRole('link', { name: 'Visítenos' })).toHaveAttribute('href', '/agendar-visita');
  });

  it('the pill has a 44 px tap area around it', () => {
    renderWithProviders(<PublicLayout />, { route: '/' });
    const pill = document.querySelector<HTMLAnchorElement>('[data-visit-pill]')!;
    expect(pill).toHaveClass('relative', 'before:absolute', 'before:-inset-y-2.5');
  });

  it('on /pagos, «Pagos» (bar and tablet button) says it is the current page', async () => {
    renderWithProviders(<PublicLayout />, { route: '/pagos' });
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'Pagos' })).toHaveAttribute('aria-current', 'page');
    const bar = await vi.waitFor(() => document.querySelector<HTMLElement>('[data-sticky-cta]')!);
    expect(within(bar).getByRole('link', { name: 'Pagos' })).toHaveAttribute('aria-current', 'page');
  });

  it('elsewhere «Pagos» is not current', () => {
    renderWithProviders(<PublicLayout />, { route: '/' });
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Pagos' })).not.toHaveAttribute('aria-current');
  });

  it('the phone menu does not repeat «Agendar visita» inside «Admisiones»; the laptop dropdown keeps it', async () => {
    renderWithProviders(<PublicLayout />, { route: '/' });
    const header = screen.getByRole('banner');
    // Laptop dropdown.
    await userEvent.click(within(header.querySelector('nav')!).getByRole('button', { name: 'Admisiones' }));
    expect(within(header.querySelector('nav')!).getByRole('link', { name: 'Agendar visita' })).toBeInTheDocument();
    // Phone/tablet menu: once, as the button under «Pagos de familias».
    const panel = await openMenu();
    await userEvent.click(within(panel).getByRole('button', { name: 'Admisiones' }));
    expect(within(panel).getByRole('link', { name: 'Costos' })).toBeInTheDocument();
    expect(within(panel).getAllByRole('link', { name: 'Agendar visita' })).toHaveLength(1);
  });

  it('the bar\'s WhatsApp opens with the general question (Textos del sitio › «Barra inferior del teléfono»)', async () => {
    renderWithProviders(<PublicLayout />, { route: '/' });
    const bar = await vi.waitFor(() => document.querySelector<HTMLElement>('[data-sticky-cta]')!);
    const wa = within(bar).getByRole('link', { name: 'Escribir por WhatsApp' });
    expect(decodeURIComponent(wa.getAttribute('href')!)).toContain('Hola, me gustaría obtener más información sobre el Colegio Interlaken.');
  });

  it('«Volver arriba» over the bar sits on the bar\'s right edge (the bar is at most 24rem, centred)', async () => {
    renderWithProviders(<PublicLayout />, { route: '/' });
    await vi.waitFor(() => expect(document.querySelector('[data-sticky-cta]')).not.toBeNull());
    const tops = [...document.querySelectorAll<HTMLElement>('[data-back-to-top]')];
    expect(tops.some((el) => el.className.includes('right-[max(1rem,calc((100vw_-_24rem)/2))]'))).toBe(true);
  });

  it('counts the new entry points: pill, menu visit button, «Pagos»', async () => {
    renderWithProviders(<PublicLayout />, { route: '/' });
    await userEvent.click(document.querySelector<HTMLAnchorElement>('[data-visit-pill]')!);
    await userEvent.click(within(screen.getByRole('banner')).getByRole('link', { name: 'Pagos' }));
    const panel = await openMenu();
    await userEvent.click(within(panel).getByRole('link', { name: 'Agendar visita' }));
    expect(tracked).toEqual(expect.arrayContaining([
      ['visit_cta', { context: 'barra_superior' }],
      ['payments_cta', { context: 'encabezado_tableta' }],
      ['visit_cta', { context: 'menu_movil' }],
    ]));
  });

  it('a chosen icon for the bar button wins over the one from its link', async () => {
    settings.chrome = { sticky_icon: 'Coffee' };
    renderWithProviders(<PublicLayout />, { route: '/' });
    const pay = within(screen.getByRole('banner')).getByRole('link', { name: 'Pagos' });
    await vi.waitFor(() => expect(pay.querySelector('svg')?.getAttribute('class')).toMatch(/coffee/));
  });

  it('no serious axe violations with the menu open', async () => {
    const { container } = renderWithProviders(<PublicLayout />, { route: '/' });
    await openMenu();
    const serious = (await axe(container)).violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
    expect(serious.map((v) => v.id)).toEqual([]);
  });
});
