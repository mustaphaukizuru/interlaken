import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { NovedadesPanel, readSeen } from './NovedadesPanel';

vi.mock('@/services/api', () => ({
  portalApi: { novedades: vi.fn().mockResolvedValue({ data: { since: 'x', unread: 1, items: [
    { type: 'comunicado', title: 'Junta de padres', text: 'Viernes 9:00', link: '/portal/comunicados/3', at: '2026-08-22T10:00:00Z', unread: true },
    { type: 'cafeteria', title: 'Consumo de Ana: $35', text: '', link: '/portal/cafeteria', at: '2026-08-21T10:00:00Z', unread: false },
  ] } }) },
}));

describe('NovedadesPanel', () => {
  it('lists items with links and stamps the seen time', async () => {
    localStorage.removeItem('interlaken:novedades-seen');
    renderWithProviders(<NovedadesPanel />);
    expect(await screen.findByRole('link', { name: /Junta de padres/ })).toHaveAttribute('href', '/portal/comunicados/3');
    expect(screen.getByText('Novedades (1)')).toBeInTheDocument();
    expect(readSeen()).toBeTruthy();
  });
});
