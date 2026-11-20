/**
 * Menu «Opción 3» (confirmed 2026-11-20) as a visitor meets it: «Familias»
 * replaces «Pagos», the online payment opens Servo Escolar in a new tab, and
 * the header keeps two buttons.
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

describe('PublicLayout menu (Opción 3)', () => {
  it('shows «Portal Cafetería» and «Agendar visita», and no «Pagos» button', () => {
    renderWithProviders(<PublicLayout />);
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'Portal Cafetería' })).toHaveAttribute('href', '/login');
    expect(within(header).getByRole('link', { name: 'Agendar visita' })).toHaveAttribute('href', '/agendar-visita');
    expect(within(header).queryByRole('link', { name: /^Pagos$/ })).not.toBeInTheDocument();
    expect(within(header).queryByRole('button', { name: 'Pagos' })).not.toBeInTheDocument();
  });

  it('«Familias» opens with the online payment (new tab), Colegiaturas, Facturación and Plataformas', async () => {
    renderWithProviders(<PublicLayout />);
    const header = screen.getByRole('banner');
    await userEvent.click(within(header).getByRole('button', { name: 'Familias' }));

    const pay = within(header).getByRole('link', { name: 'Pagar colegiatura (se abre en otra pestaña)' });
    expect(pay).toHaveAttribute('href', 'https://interlaken.servoescolar.mx');
    expect(pay).toHaveAttribute('target', '_blank');
    expect(pay).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(header).getByRole('link', { name: 'Colegiaturas y cafetería' })).toHaveAttribute('href', '/pagos');
    expect(within(header).getByRole('link', { name: 'Facturación' })).toHaveAttribute('href', '/comunidad/facturacion');
    expect(within(header).getByRole('link', { name: 'Plataformas' })).toHaveAttribute('href', '/plataformas');
  });

  it('«El Colegio» no longer lists Plataformas', async () => {
    renderWithProviders(<PublicLayout />);
    const header = screen.getByRole('banner');
    await userEvent.click(within(header).getByRole('button', { name: 'El Colegio' }));
    expect(within(header).getByRole('link', { name: 'Galería' })).toBeInTheDocument();
    expect(within(header).queryByRole('link', { name: 'Plataformas' })).not.toBeInTheDocument();
  });

  it('the footer link to the online payment also opens in a new tab', () => {
    renderWithProviders(<PublicLayout />);
    const footer = screen.getByRole('contentinfo');
    const pay = within(footer).getByRole('link', { name: 'Pagar colegiatura (se abre en otra pestaña)' });
    expect(pay).toHaveAttribute('href', 'https://interlaken.servoescolar.mx');
    expect(pay).toHaveAttribute('target', '_blank');
  });
});
