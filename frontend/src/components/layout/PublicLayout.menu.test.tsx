/**
 * The public menu as a visitor meets it. «Opción 3» (2026-11-20): «Familias»
 * replaces «Pagos». 2026-11-22: two header buttons (Portal Cafetería /
 * Agendar visita; the owner removed «Colegiaturas») and a single tuition entry
 * in «Familias» («Colegiaturas y cafetería», whose page links to the tuition site).
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';

vi.mock('@/services/api', () => ({
  // No server: the layout renders its built-in menu and buttons.
  contentApi: { getSettings: vi.fn().mockRejectedValue(new Error('offline')) },
  portalApi: { getSiteNotices: vi.fn().mockResolvedValue({ data: [] }) },
}));

import { PublicLayout } from './PublicLayout';

describe('PublicLayout menu', () => {
  it('the bar is sticky, solid and above the page (z-header; 2026-11-22: without it photos covered it)', () => {
    renderWithProviders(<PublicLayout />);
    const header = screen.getByRole('banner');
    for (const cls of ['sticky', 'top-0', 'z-header', 'bg-white']) expect(header).toHaveClass(cls);
  });

  it('shows «Portal Cafetería» and «Agendar visita», and no «Colegiaturas» or «Pagos» button', () => {
    renderWithProviders(<PublicLayout />);
    const header = screen.getByRole('banner');
    const cafe = within(header).getAllByRole('link', { name: 'Portal Cafetería' });
    expect(cafe[0]).toHaveAttribute('href', '/login');
    // Two buttons fit with their names at every desktop width (no icon-only mode).
    expect(cafe[0].querySelector('.sr-only')).toBeNull();
    expect(within(header).queryByRole('link', { name: /^Colegiaturas$/ })).not.toBeInTheDocument();
    expect(within(header).getByRole('link', { name: 'Agendar visita' })).toHaveAttribute('href', '/agendar-visita');
    expect(within(header).queryByRole('link', { name: /^Pagos$/ })).not.toBeInTheDocument();
    expect(within(header).queryByRole('button', { name: 'Pagos' })).not.toBeInTheDocument();
  });

  it('«Familias» lists Colegiaturas y cafetería, Facturación and Plataformas, without a second tuition link', async () => {
    renderWithProviders(<PublicLayout />);
    const header = screen.getByRole('banner');
    await userEvent.click(within(header).getByRole('button', { name: 'Familias' }));

    expect(within(header).getByRole('link', { name: 'Colegiaturas y cafetería' })).toHaveAttribute('href', '/pagos');
    expect(within(header).getByRole('link', { name: 'Facturación' })).toHaveAttribute('href', '/comunidad/facturacion');
    expect(within(header).getByRole('link', { name: 'Plataformas' })).toHaveAttribute('href', '/plataformas');
    expect(within(header).queryByRole('link', { name: /Pagar colegiatura/ })).not.toBeInTheDocument();
  });

  it('«El Colegio» no longer lists Plataformas', async () => {
    renderWithProviders(<PublicLayout />);
    const header = screen.getByRole('banner');
    await userEvent.click(within(header).getByRole('button', { name: 'El Colegio' }));
    expect(within(header).getByRole('link', { name: 'Galería' })).toBeInTheDocument();
    expect(within(header).queryByRole('link', { name: 'Plataformas' })).not.toBeInTheDocument();
  });

  it('the footer lists «Colegiaturas y cafetería» once, without the duplicate tuition link', () => {
    renderWithProviders(<PublicLayout />);
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('link', { name: 'Colegiaturas y cafetería' })).toHaveAttribute('href', '/pagos');
    expect(within(footer).queryByRole('link', { name: /Pagar colegiatura/ })).not.toBeInTheDocument();
  });
});
