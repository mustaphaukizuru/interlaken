import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn(), loading: vi.fn(() => 't'), dismiss: vi.fn() } }));
vi.mock('@/services/AdminContentApi', () => ({
  mediaAdminApi: { list: vi.fn(), export: vi.fn(), bulk: vi.fn(), upload: vi.fn() },
}));
vi.mock('@/services/api', () => ({
  contentApi: { adminDeleteMedia: vi.fn(), adminUpdateMedia: vi.fn() },
  downloadBlob: vi.fn(),
}));

import { mediaAdminApi } from '@/services/AdminContentApi';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';
import AdminMedia from './AdminMedia';

const list = vi.mocked(mediaAdminApi.list);
const upload = vi.mocked(mediaAdminApi.upload);
const bulk = vi.mocked(mediaAdminApi.bulk);

const ASSET = {
  id: 3, filename: 'campus.jpg', content_type: 'image/jpeg', size: 20480, width: 800, height: 600, alt: '', caption: '',
  focal_x: 0.5, focal_y: 0.5, tags: '', urls: { original: '/x.jpg' }, referenced: false, created_at: '2026-09-20T10:00:00Z',
};

const file = (name: string, type: string, size = 1024) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  stubViewport(1280);
  list.mockResolvedValue({ data: { count: 1, next: null, previous: null, results: [ASSET] } } as never);
});

describe('AdminMedia', () => {
  it('drag-and-drop upload reports every file: ok, too big, wrong type and duplicate', async () => {
    upload
      .mockResolvedValueOnce({ data: { ...ASSET, id: 9, filename: 'nueva.png' } } as never)
      .mockRejectedValueOnce({ response: { status: 409, data: { detail: 'Ya existe en la biblioteca: campus.jpg.', existing: ASSET } } });
    renderWithProviders(<AdminMedia />, { route: '/admin/contenido/medios' });
    await screen.findByText('campus.jpg');
    const files = [
      file('nueva.png', 'image/png'),
      file('enorme.jpg', 'image/jpeg', 11 * 1024 * 1024),
      file('doc.pdf', 'application/pdf'),
      file('copia.jpg', 'image/jpeg'),
    ];
    fireEvent.drop(screen.getByTestId('media-dropzone'), { dataTransfer: { files } });
    const report = await screen.findByRole('list', { name: 'Archivos subidos' });
    await waitFor(() => expect(within(report).getByText('Subida')).toBeInTheDocument());
    expect(within(report).getByText(/el límite es 10 MB/)).toBeInTheDocument();
    expect(within(report).getByText('Solo imágenes JPG, PNG, WebP o GIF.')).toBeInTheDocument();
    expect(await within(report).findByText('Ya existe en la biblioteca: campus.jpg.')).toBeInTheDocument();
    expect(upload).toHaveBeenCalledTimes(2); // invalid files never leave the browser
    await userEvent.click(within(report).getByRole('button', { name: 'Ya existe: usar el existente' }));
    expect(await screen.findByRole('dialog', { name: 'Detalles de la imagen' })).toBeInTheDocument();
  });

  it('maps filters and sends the tag with the add_tag bulk dry run', async () => {
    const user = userEvent.setup();
    bulk.mockResolvedValue({ data: { action: 'add_tag', requested: 1, ok: 1, failed: [], skipped: [], dry_run: true } } as never);
    renderWithProviders(<AdminMedia />, { route: '/admin/contenido/medios?uso=1&tipo=jpeg&alt=1' });
    await screen.findByText('campus.jpg');
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ unreferenced: '1', type: 'jpeg', missing_alt: '1' }));
    await user.click(screen.getByRole('checkbox', { name: 'Seleccionar imagen campus.jpg' }));
    await user.click(within(screen.getByRole('region', { name: 'Acciones en lote' })).getByRole('button', { name: 'Agregar etiqueta' }));
    await user.type(await screen.findByLabelText('Etiqueta'), 'campus');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(bulk).toHaveBeenCalledWith(expect.objectContaining({ action: 'add_tag', ids: [3], dry_run: true, payload: { tag: 'campus' } })));
  });
});
