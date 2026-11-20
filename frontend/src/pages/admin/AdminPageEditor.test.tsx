import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/api', () => ({
  contentApi: {
    adminGetPage: vi.fn(),
    adminUpdatePage: vi.fn(),
    adminPublishPage: vi.fn(),
    adminPageVersions: vi.fn(),
    adminRollbackPage: vi.fn(),
    adminPageChecks: vi.fn(),
    adminReviewPage: vi.fn(),
    adminPreviewToken: vi.fn(),
  },
}));
let role = 'admin';
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: { user: { id: number; role: string } }) => unknown) => sel({ user: { id: 1, role } }),
}));

import toast from 'react-hot-toast';
import { contentApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import AdminPageEditor from './AdminPageEditor';
import { loadAllGroups } from '@/cms/sections/loaders';

const BLOCKS = [{ id: 'a', type: 'rich_text', props: { html: '<p>Hola</p>' } }];
const PAGE = {
  id: 7, slug: 'nosotros', title: 'Nosotros', template: 'simple', status: 'published', draft_blocks: BLOCKS, seo: {},
  published_version_number: 2, has_unpublished_changes: false, published_at: '2026-10-01T00:00:00Z',
  review_requested_at: null, review_requested_by_name: '', review_note: '', publish_at: null, unpublish_at: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
};

function renderEditor(base = '/admin') {
  return renderWithProviders(
    <Routes><Route path={`${base}/contenido/:id`} element={<AdminPageEditor />} /></Routes>,
    { route: `${base}/contenido/7` },
  );
}

// The editor imports every page's section modules before it renders: do that
// cold import once here, outside the per-test timeouts.
beforeAll(async () => { await loadAllGroups(); }, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  role = 'admin';
  vi.mocked(contentApi.adminGetPage).mockResolvedValue({ data: PAGE } as never);
});

describe('AdminPageEditor versions', () => {
  it('hides «Versiones» from staff (admin-only endpoint)', async () => {
    role = 'staff';
    renderEditor('/staff');
    // The editor loads every page's section modules first (cold import in tests).
    await screen.findByRole('button', { name: /Revisar/ }, { timeout: 8000 });
    expect(screen.queryByRole('button', { name: /Versiones/ })).not.toBeInTheDocument();
    expect(contentApi.adminPageVersions).not.toHaveBeenCalled();
  });

  it('asks for confirmation and restores into the draft without publishing', async () => {
    vi.mocked(contentApi.adminPageVersions).mockResolvedValue({
      data: [{ id: 11, number: 1, author_name: 'Ana', created_at: '2026-09-01T00:00:00Z', blocks: BLOCKS }],
    } as never);
    vi.mocked(contentApi.adminRollbackPage).mockResolvedValue({
      data: { restored_from: 1, page: { ...PAGE, has_unpublished_changes: true } },
    } as never);
    renderEditor();
    await userEvent.click(await screen.findByRole('button', { name: /Versiones/ }, { timeout: 8000 }));
    await userEvent.click(await screen.findByRole('button', { name: 'Restaurar' }));
    expect(contentApi.adminRollbackPage).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: /Restaurar la versión 1 en el borrador/ });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Restaurar en el borrador' }));
    await waitFor(() => expect(contentApi.adminRollbackPage).toHaveBeenCalledWith(7, 1));
    expect(contentApi.adminPublishPage).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('restaurada en el borrador'));
  });

  it('shows an error (not "aún no se ha publicado") when versions fail to load', async () => {
    vi.mocked(contentApi.adminPageVersions).mockRejectedValue(new Error('403'));
    renderEditor();
    await userEvent.click(await screen.findByRole('button', { name: /Versiones/ }, { timeout: 8000 }));
    expect(await screen.findByText('No se pudieron cargar las versiones')).toBeInTheDocument();
    expect(screen.queryByText('Esta página aún no se ha publicado.')).not.toBeInTheDocument();
  });

  it('staff autosave never sends slug or schedule fields', async () => {
    role = 'staff';
    vi.mocked(contentApi.adminUpdatePage).mockResolvedValue({ data: PAGE } as never);
    renderEditor('/staff');
    await userEvent.click(await screen.findByRole('button', { name: 'SEO' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Dirección (slug)')).toBeDisabled();
    expect(within(dialog).getByLabelText('Publicar automáticamente el')).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Título de la página'), ' 2');
    await waitFor(() => expect(contentApi.adminUpdatePage).toHaveBeenCalled(), { timeout: 4000 });
    const payload = vi.mocked(contentApi.adminUpdatePage).mock.calls[0][1];
    expect(payload).not.toHaveProperty('slug');
    expect(payload).not.toHaveProperty('publish_at');
    expect(payload).not.toHaveProperty('unpublish_at');
  });
});

describe('AdminPageEditor designed sections (CMS-COMPLETION-PLAN)', () => {
  beforeEach(() => {
    vi.mocked(contentApi.adminUpdatePage).mockImplementation(async (_id, data) => ({ data: { ...PAGE, ...data } }) as never);
    localStorage.removeItem('cms-clipboard');
  });

  it('hides a block without deleting it, and undo brings it back', async () => {
    renderEditor();
    const hide = await screen.findByRole('button', { name: 'Ocultar del sitio' }, { timeout: 8000 });
    await userEvent.click(hide);
    await waitFor(() => expect(contentApi.adminUpdatePage).toHaveBeenCalled(), { timeout: 4000 });
    expect(vi.mocked(contentApi.adminUpdatePage).mock.calls.slice(-1)[0][1].draft_blocks).toEqual([{ ...BLOCKS[0], hidden: true }]);
    await userEvent.click(screen.getByRole('button', { name: /Deshacer/ }));
    expect(await screen.findByRole('button', { name: 'Ocultar del sitio' })).toBeInTheDocument();
  });

  it('copies a section and pastes it as a new block', async () => {
    renderEditor();
    await userEvent.click(await screen.findByRole('button', { name: /^1\. Texto/ }, { timeout: 8000 }));
    await userEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    await userEvent.click(await screen.findByRole('button', { name: /Pegar/ }));
    expect(screen.getByRole('button', { name: /^2\. Texto/ })).toBeInTheDocument();
  });

  it('offers the current design on an old generic draft that was never published', async () => {
    vi.mocked(contentApi.adminGetPage).mockResolvedValue({ data: { ...PAGE, status: 'draft', published_version_number: null } } as never);
    renderEditor();
    await userEvent.click(await screen.findByRole('button', { name: 'Cargar el diseño actual' }, { timeout: 8000 }));
    // Nosotros starts with its photo hero, then its designed sections.
    expect(await screen.findByRole('button', { name: /^1\. Portada con foto/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Diseño original/ })).toBeInTheDocument();
  });
});
