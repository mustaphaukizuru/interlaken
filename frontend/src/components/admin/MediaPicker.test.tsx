import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({ contentApi: { adminListMedia: vi.fn() } }));

import { contentApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { MediaPicker } from './MediaPicker';

const asset = (id: number) => ({ id, filename: `foto-${id}.jpg`, alt: `Foto ${id}`, urls: { thumb: `/t/${id}`, original: `/o/${id}` } });
const list = vi.mocked(contentApi.adminListMedia);

beforeEach(() => vi.clearAllMocks());

describe('MediaPicker', () => {
  it('pages through the library with «Cargar más»', async () => {
    list.mockImplementation(async (params) => ({
      data: params?.page === 2
        ? { count: 3, next: null, previous: null, results: [asset(3)] }
        : { count: 3, next: 'x', previous: null, results: [asset(1), asset(2)] },
    }) as never);
    renderWithProviders(<MediaPicker label="Imagen" value={null} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Elegir imagen' }));
    expect(await screen.findByRole('button', { name: 'Foto 2' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(await screen.findByRole('button', { name: 'Foto 3' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument());
    expect(list).toHaveBeenLastCalledWith({ q: undefined, page: 2 });
  });

  it('shows empty and error states', async () => {
    list.mockResolvedValueOnce({ data: { count: 0, next: null, previous: null, results: [] } } as never);
    const { unmount } = renderWithProviders(<MediaPicker label="Imagen" value={null} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Elegir imagen' }));
    expect(await screen.findByText('La biblioteca está vacía.')).toBeInTheDocument();
    unmount();

    list.mockRejectedValueOnce(new Error('500'));
    renderWithProviders(<MediaPicker label="Imagen" value={null} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Elegir imagen' }));
    expect(await screen.findByText('No se pudo cargar la biblioteca')).toBeInTheDocument();
  });
});
