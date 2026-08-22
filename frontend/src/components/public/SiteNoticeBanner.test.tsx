import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { SiteNoticeBanner, pickNotices } from './SiteNoticeBanner';

vi.mock('@/services/api', () => ({
  portalApi: { getSiteNotices: vi.fn().mockResolvedValue({ data: [{ id: 7, title: 'Suspensión', body: 'No hay clases el lunes.', link: '/calendario', until: null }] }) },
}));

describe('SiteNoticeBanner', () => {
  it('pickNotices hides dismissed ids', () => {
    expect(pickNotices([{ id: 1, title: 'a', body: '', link: '', until: null }], [1])).toEqual([]);
  });
  it('shows the aviso with link and can be dismissed', async () => {
    localStorage.removeItem('interlaken:dismissed-notices');
    const user = userEvent.setup();
    renderWithProviders(<SiteNoticeBanner />);
    expect(await screen.findByRole('status')).toHaveTextContent('Suspensión');
    expect(screen.getByRole('link', { name: 'Ver más' })).toHaveAttribute('href', '/calendario');
    await user.click(screen.getByRole('button', { name: 'Cerrar aviso' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('interlaken:dismissed-notices')!)).toEqual([7]);
  });
});
