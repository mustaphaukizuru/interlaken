import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { portalApi } from '@/services/api';
import { NovedadesPanel, readSeen } from './NovedadesPanel';

vi.mock('@/services/api', () => ({
  portalApi: { novedades: vi.fn().mockResolvedValue({ data: { since: 'x', unread: 1, items: [
    { type: 'comunicado', title: 'Junta de padres', text: 'Viernes 9:00', link: '/portal/comunicados/3', at: '2026-08-22T10:00:00Z', unread: true },
    { type: 'cafeteria', title: 'Consumo de Ana: $35', text: '', link: '/portal/cafeteria', at: '2026-08-21T10:00:00Z', unread: false },
    { type: 'evento', title: '14/11 · Festival', text: 'Patio central', link: '', at: '2026-11-14T00:00:00Z', unread: false },
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

  it('shows a school date as a plain row, not a link to a page that no longer exists', async () => {
    renderWithProviders(<NovedadesPanel />);
    expect(await screen.findByText('14/11 · Festival')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Festival/ })).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('announces an unread item to screen readers without a stray aria-label', async () => {
    renderWithProviders(<NovedadesPanel />);
    expect(await screen.findByRole('link', { name: /Junta de padres.*Nuevo/ })).toBeInTheDocument();
  });

  it('the count in the title is the new rows it lists, never more (QA 2026-11-24: «9» over 8 rows)', async () => {
    const items = Array.from({ length: 9 }, (_, i) => ({
      type: 'cafeteria', title: `Consumo ${i + 1}`, text: '', link: '/portal/cafeteria',
      at: `2026-11-${String(20 - i).padStart(2, '0')}T10:00:00Z`, unread: true,
    }));
    vi.mocked(portalApi.novedades).mockResolvedValueOnce({ data: { since: 'x', unread: 9, items } } as never);
    renderWithProviders(<NovedadesPanel />);
    expect(await screen.findByText('Novedades (8)')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Novedades' })).getAllByRole('listitem')).toHaveLength(8);
    expect(screen.queryByText('Novedades (9)')).toBeNull();
  });
});
