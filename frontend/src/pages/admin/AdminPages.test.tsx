import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn(), loading: vi.fn(() => 't'), dismiss: vi.fn() } }));
vi.mock('@/services/AdminContentApi', () => ({
  pagesAdminApi: { list: vi.fn(), export: vi.fn(), bulk: vi.fn() },
}));
vi.mock('@/services/api', () => ({ contentApi: { adminDeletePage: vi.fn(), adminCreatePage: vi.fn() }, downloadBlob: vi.fn() }));

import { useAuthStore } from '@/store/authStore';
import { pagesAdminApi } from '@/services/AdminContentApi';
import { contentApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';
import { loadAllGroups } from '@/cms/sections/loaders';
import { originalBlocks } from '@/cms/editor/helpers';
import AdminPages from './AdminPages';

const list = vi.mocked(pagesAdminApi.list);
const bulk = vi.mocked(pagesAdminApi.bulk);

const base = { seo: {}, published_at: null, publish_at: null, unpublish_at: null, review_requested_at: null, review_note: '', updated_at: '2026-11-19T10:00:00Z' };
const PAGES = [
  // Public pages someone customised: one old seed (C1 flag), one published with edits, one scheduled.
  { ...base, id: 2, slug: 'nosotros', title: 'Nosotros', template: 'simple', status: 'draft', has_unpublished_changes: true, draft_blocks: [{ id: 'x', type: 'hero', props: {} }], published_version_number: null, legacy_seed: true },
  { ...base, id: 1, slug: 'inicio', title: 'Inicio', template: 'home', status: 'published', has_unpublished_changes: true, draft_blocks: [], published_version_number: 3, draft_updated_by: 'Ana Ruiz', draft_updated_at: '2026-11-19T09:00:00Z' },
  { ...base, id: 9, slug: 'contacto', title: 'Contacto', template: 'simple', status: 'published', has_unpublished_changes: true, draft_blocks: [], published_version_number: 1, publish_at: '2099-01-01T14:00:00Z' },
  // Pages the school created.
  { ...base, id: 20, slug: 'verano', title: 'Curso de verano', template: 'landing', status: 'published', has_unpublished_changes: false, draft_blocks: [], published_version_number: 2 },
  { ...base, id: 21, slug: 'becas', title: 'Becas', template: 'simple', status: 'draft', has_unpublished_changes: true, draft_blocks: [], published_version_number: null, review_requested_at: '2026-11-19T08:00:00Z' },
];

const setRole = (role: 'admin' | 'staff') => useAuthStore.setState({ user: { id: 1, email: 'x@x.mx', role } as never });
const row = (name: string) => screen.getAllByRole('listitem').find((li) => within(li).queryByText(name, { selector: 'a,span' }) && li.closest('ul[aria-label]'))!;
const group = (name: string) => screen.getByRole('list', { name });

function renderList(route = '/admin/contenido') {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/contenido" element={<AdminPages />} />
      <Route path="/staff/contenido" element={<AdminPages />} />
      <Route path="/admin/contenido/:id" element={<p>Editor abierto</p>} />
    </Routes>,
    { route },
  );
}

beforeAll(async () => { await loadAllGroups(); }, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  stubViewport(1280);
  setRole('admin');
  list.mockResolvedValue({ data: { count: PAGES.length, next: null, previous: null, results: PAGES } } as never);
});

describe('AdminPages: one list of the site', () => {
  it('lists every public page once, with its state in words, and custom pages apart', async () => {
    renderList();
    const site = await screen.findByRole('list', { name: 'Páginas del sitio' }, { timeout: 8000 });
    expect(list).toHaveBeenCalledWith({ page: 1, page_size: 100 });
    // 18 designed pages + the 3 app screens (iniciar-sesion, inscripcion-documentos, confirmar-correo).
    expect(within(site).getAllByRole('listitem')).toHaveLength(21);
    expect(screen.getAllByText('Nosotros', { selector: 'a' })).toHaveLength(1);
    expect(within(group('Páginas propias')).getAllByRole('listitem')).toHaveLength(2);

    expect(within(row('Nosotros')).getByText('Borrador antiguo')).toBeInTheDocument();
    expect(within(row('Inicio')).getByText('Cambios sin publicar')).toBeInTheDocument();
    expect(within(row('Inicio')).getByText('Ana Ruiz')).toBeInTheDocument();
    expect(within(row('Contacto')).getByText('Programada')).toBeInTheDocument();
    expect(within(row('Galería')).getByText('Diseño original')).toBeInTheDocument();
    expect(within(row('Curso de verano')).getByText('Publicada')).toBeInTheDocument();
    expect(within(row('Becas')).getByText('Borrador')).toBeInTheDocument();
    expect(within(row('Becas')).getByText('Pendiente de aprobación')).toBeInTheDocument();

    // Actions: «Personalizar» for an untouched page, «Editar», «Ver» and «Versiones» otherwise.
    expect(within(row('Galería')).getByRole('button', { name: 'Personalizar Galería' })).toBeInTheDocument();
    expect(within(row('Inicio')).getByRole('link', { name: 'Editar Inicio' })).toHaveAttribute('href', '/admin/contenido/1');
    expect(within(row('Inicio')).getByRole('link', { name: /Ver Inicio en el sitio/ })).toHaveAttribute('href', '/');
    expect(within(row('Inicio')).getByRole('link', { name: 'Versiones de Inicio' })).toHaveAttribute('href', '/admin/contenido/1?versiones=1');
    // A custom draft is not on the site yet: no «Ver».
    expect(within(row('Becas')).queryByRole('link', { name: /Ver Becas/ })).not.toBeInTheDocument();
  });

  it('filters by state and searches from the URL', async () => {
    renderList('/admin/contenido?estado=legacy');
    const site = await screen.findByRole('list', { name: 'Páginas del sitio' }, { timeout: 8000 });
    expect(within(site).getAllByRole('listitem')).toHaveLength(1);
    expect(within(site).getByText('Nosotros')).toBeInTheDocument();
    expect(screen.getByText('Ninguna página propia coincide con la búsqueda.')).toBeInTheDocument();
  });

  it('searches without accents', async () => {
    renderList('/admin/contenido?q=galeria');
    const site = await screen.findByRole('list', { name: 'Páginas del sitio' }, { timeout: 8000 });
    expect(within(site).getAllByRole('listitem').map((li) => within(li).getAllByText(/./)[0].textContent)).toEqual(['Galería']);
  });

  it('«Personalizar» creates the draft from the current design and opens the editor', async () => {
    vi.mocked(contentApi.adminCreatePage).mockResolvedValue({ data: { id: 44 } } as never);
    renderList();
    await screen.findByRole('list', { name: 'Páginas del sitio' }, { timeout: 8000 });
    await userEvent.click(screen.getByRole('button', { name: 'Personalizar Galería' }));
    await waitFor(() => expect(contentApi.adminCreatePage).toHaveBeenCalledWith(expect.objectContaining({ slug: 'galeria', draft_blocks: originalBlocks('galeria') })));
    expect(await screen.findByText('Editor abierto')).toBeInTheDocument();
  });

  it('keeps bulk publish: dry run first, then the run, on the selected pages', async () => {
    const user = userEvent.setup();
    bulk
      .mockResolvedValueOnce({ data: { action: 'publish', requested: 2, ok: 1, failed: [{ id: 21, error: 'Corrija antes de publicar: La página no tiene bloques.' }], skipped: [], dry_run: true } } as never)
      .mockResolvedValueOnce({ data: { action: 'publish', requested: 2, ok: 1, failed: [{ id: 21, error: 'Corrija antes de publicar: La página no tiene bloques.' }], skipped: [], dry_run: false } } as never);
    renderList();
    await screen.findByRole('list', { name: 'Páginas propias' }, { timeout: 8000 });
    await user.click(screen.getByRole('checkbox', { name: 'Seleccionar todas: Páginas propias' }));
    await user.click(within(screen.getByRole('region', { name: 'Acciones en lote' })).getByRole('button', { name: 'Publicar' }));
    expect(await screen.findByText(/1 no se pueden procesar/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Publicar (1)' }));
    expect(await screen.findByText(/La página no tiene bloques/)).toBeInTheDocument();
    await waitFor(() => expect(bulk).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'publish', ids: [21, 20], dry_run: false })));
  });

  it('staff can list and edit but get no selection, bulk bar or export', async () => {
    setRole('staff');
    renderList('/staff/contenido');
    await screen.findByRole('list', { name: 'Páginas del sitio' }, { timeout: 8000 });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Exportar$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Versiones de/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Editar Becas' })).toHaveAttribute('href', '/staff/contenido/21');
  });

  it('shows an error with «Reintentar» when the list fails', async () => {
    list.mockRejectedValueOnce(new Error('500'));
    renderList();
    expect(await screen.findByText('No se pudieron cargar las páginas', {}, { timeout: 8000 })).toBeInTheDocument();
  });
});
