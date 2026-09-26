import { type ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  portalApi: { getAnnouncements: vi.fn() },
}));

vi.mock('@/components/ui/Reveal', () => ({
  Reveal: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import ComunicadosPage from './ComunicadosPage';
import { portalApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const getAnnouncements = vi.mocked(portalApi.getAnnouncements);

function announcement(id: number, title: string) {
  return {
    id,
    title,
    body: `Cuerpo ${id}`,
    audience: 'parents',
    created_at: '2026-08-01T12:00:00Z',
    comment_count: 0,
  };
}

describe('ComunicadosPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pages through announcements with Siguiente', async () => {
    getAnnouncements
      .mockResolvedValueOnce({
        data: { count: 21, results: [announcement(1, 'Aviso página uno')] },
      } as never)
      .mockResolvedValueOnce({
        data: { count: 21, results: [announcement(2, 'Aviso página dos')] },
      } as never);

    renderWithProviders(<ComunicadosPage />, { route: '/portal/comunicados' });

    expect((await screen.findAllByText(/Aviso página uno/i)).length).toBeGreaterThan(0);
    expect(getAnnouncements).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }));

    await userEvent.click(screen.getByRole('button', { name: /siguiente/i }));

    await waitFor(() => {
      expect(getAnnouncements).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 }),
      );
    });
    expect((await screen.findAllByText(/Aviso página dos/i)).length).toBeGreaterThan(0);
  });

  it('opens on the page named by ?page= (Back from a comunicado keeps the page)', async () => {
    getAnnouncements.mockResolvedValue({
      data: { count: 45, results: [announcement(3, 'Aviso página tres')] },
    } as never);
    renderWithProviders(<ComunicadosPage />, { route: '/portal/comunicados?page=3' });
    expect((await screen.findAllByText(/Aviso página tres/i)).length).toBeGreaterThan(0);
    expect(getAnnouncements).toHaveBeenCalledWith({ page: 3 });
    expect(getAnnouncements).not.toHaveBeenCalledWith({ page: 1 });
  });

  it('falls back to page 1 when a bookmarked page no longer exists (DRF 404)', async () => {
    getAnnouncements.mockImplementation((async (params?: { page?: number }) => {
      if ((params?.page ?? 1) > 1) throw Object.assign(new Error('404'), { response: { status: 404, data: { detail: 'Página inválida.' } } });
      return { data: { count: 1, results: [announcement(1, 'Único aviso')] } };
    }) as never);
    renderWithProviders(<ComunicadosPage />, { route: '/portal/comunicados?page=9' });
    expect((await screen.findAllByText(/Único aviso/i)).length).toBeGreaterThan(0);
    expect(getAnnouncements).toHaveBeenLastCalledWith({ page: 1 });
  });

  it('shows empty state when there are no comunicados', async () => {
    getAnnouncements.mockResolvedValue({ data: { count: 0, results: [] } } as never);
    renderWithProviders(<ComunicadosPage />, { route: '/portal/comunicados' });
    expect(await screen.findByText(/Sin comunicados por ahora/i)).toBeInTheDocument();
  });
});
