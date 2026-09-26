import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn(), loading: vi.fn(() => 't'), dismiss: vi.fn() } }));
vi.mock('@/services/AdminContentApi', () => ({
  pagesAdminApi: { list: vi.fn(), export: vi.fn(), bulk: vi.fn() },
}));
vi.mock('@/services/api', () => ({ contentApi: { adminDeletePage: vi.fn(), adminCreatePage: vi.fn() }, downloadBlob: vi.fn() }));

import { useAuthStore } from '@/store/authStore';
import { pagesAdminApi } from '@/services/AdminContentApi';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';
import AdminPages from './AdminPages';

const list = vi.mocked(pagesAdminApi.list);
const bulk = vi.mocked(pagesAdminApi.bulk);

const PAGES = [
  { id: 1, slug: 'verano', title: 'Curso de verano', template: 'landing', status: 'published', has_unpublished_changes: true, draft_blocks: [], seo: {}, published_version_number: 2, published_at: null, updated_at: '' },
  { id: 2, slug: 'becas', title: 'Becas', template: 'simple', status: 'draft', has_unpublished_changes: false, draft_blocks: [], seo: {}, published_version_number: null, published_at: null, updated_at: '' },
];

const setRole = (role: 'admin' | 'staff') =>
  useAuthStore.setState({ user: { id: 1, email: 'x@x.mx', role } as never });

beforeEach(() => {
  vi.clearAllMocks();
  stubViewport(1280);
  setRole('admin');
  list.mockResolvedValue({ data: { count: 2, next: null, previous: null, results: PAGES } } as never);
});

describe('AdminPages', () => {
  it('lists pages with status and edit links, filters from the URL', async () => {
    renderWithProviders(<AdminPages />, { route: '/admin/contenido?estado=draft&plantilla=simple&q=bec&orden=title' });
    expect(await screen.findByText('Curso de verano')).toBeInTheDocument();
    expect(screen.getByText('Publicada · cambios sin publicar')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Editar Becas' })[0]).toHaveAttribute('href', '/admin/contenido/2');
    expect(list).toHaveBeenCalledWith({ page: 1, q: 'bec', status: 'draft', template: 'simple', ordering: 'title' });
    expect(screen.getByRole('columnheader', { name: 'Página' })).toHaveAttribute('aria-sort', 'ascending');
  });

  it('bulk publish runs the dry run first and reports rows that fail the checks', async () => {
    const user = userEvent.setup();
    bulk
      .mockResolvedValueOnce({ data: { action: 'publish', requested: 2, ok: 1, failed: [{ id: 2, error: 'Corrija antes de publicar: La página no tiene bloques.' }], skipped: [], dry_run: true } } as never)
      .mockResolvedValueOnce({ data: { action: 'publish', requested: 2, ok: 1, failed: [{ id: 2, error: 'Corrija antes de publicar: La página no tiene bloques.' }], skipped: [], dry_run: false } } as never);
    renderWithProviders(<AdminPages />, { route: '/admin/contenido' });
    await screen.findByText('Becas');
    await user.click(screen.getByRole('checkbox', { name: 'Seleccionar todas las filas de esta página' }));
    await user.click(within(screen.getByRole('region', { name: 'Acciones en lote' })).getByRole('button', { name: 'Publicar' }));
    expect(await screen.findByText(/1 no se pueden procesar/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Publicar (1)' }));
    expect(await screen.findByText(/La página no tiene bloques/)).toBeInTheDocument();
    await waitFor(() => expect(bulk).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'publish', ids: [1, 2], dry_run: false })));
  });

  it('staff can list and edit but get no selection, bulk bar or export', async () => {
    setRole('staff');
    renderWithProviders(<AdminPages />, { route: '/staff/contenido' });
    await screen.findByText('Becas');
    expect(screen.queryByRole('checkbox', { name: /Seleccionar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Exportar$/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Editar Becas' })[0]).toHaveAttribute('href', '/staff/contenido/2');
  });
});
