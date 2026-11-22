/**
 * Editor round «editor fields» (contracts C3 to C5) inside the page editor:
 * the error summary before publishing, structured publish errors next to
 * their field, and «jump to field» (into the shell's form, not its heading).
 * Kept apart from AdminPageEditor.test.tsx (the editor shell's own tests).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));
vi.mock('@/services/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  contentApi: {
    adminGetPage: vi.fn(), adminUpdatePage: vi.fn(), adminPublishPage: vi.fn(), adminPageVersions: vi.fn(), adminRollbackPage: vi.fn(),
    adminPageChecks: vi.fn(), adminReviewPage: vi.fn(), adminPreviewToken: vi.fn(), getSettings: vi.fn(), adminListPages: vi.fn(),
  },
}));
vi.mock('@/cms/editor/shell/publishApi', () => ({ publishPage: vi.fn() }));
vi.mock('@/cms/editor/review/reviewApi', async (orig) => ({ ...(await orig<object>()), reviewApi: { check: vi.fn(), discard: vi.fn() } }));
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: { user: { id: number; role: string } }) => unknown) => sel({ user: { id: 1, role: 'admin' } }),
}));

import toast from 'react-hot-toast';
import { contentApi } from '@/services/api';
import { publishPage } from '@/cms/editor/shell/publishApi';
import { reviewApi } from '@/cms/editor/review/reviewApi';
import { renderWithProviders } from '@/test/renderWithProviders';
import { loadAllGroups } from '@/cms/sections/loaders';
import AdminPageEditor from './AdminPageEditor';

const PAGE = {
  id: 7, slug: 'pruebas', title: 'Pruebas', template: 'simple', status: 'draft', seo: {},
  draft_blocks: [
    { id: 'a', type: 'hero', props: { title: '' } },
    { id: 'b', type: 'cta_band', props: { title: 'Visítenos', cta: { label: 'Ir', href: '/no-existe' } } },
  ],
  published_version_number: null, has_unpublished_changes: true, published_at: null,
  review_requested_at: null, review_requested_by_name: '', review_note: '', publish_at: null, unpublish_at: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
};

const renderEditor = () => renderWithProviders(
  <Routes><Route path="/admin/contenido/:id" element={<AdminPageEditor />} /></Routes>,
  { route: '/admin/contenido/7' },
);

beforeAll(async () => { await loadAllGroups(); }, 60_000);
beforeEach(() => {
  vi.mocked(contentApi.adminGetPage).mockResolvedValue({ data: PAGE } as never);
  vi.mocked(contentApi.getSettings).mockResolvedValue({ data: {} } as never);
  vi.mocked(contentApi.adminListPages).mockResolvedValue({ data: [] } as never);
});

describe('AdminPageEditor field errors', () => {
  it('lists what blocks publishing before «Publicar», and jumps to the field', async () => {
    renderEditor();
    expect(await screen.findByRole('heading', { name: 'Antes de publicar, corrija 1 campo' }, { timeout: 8000 })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /1\. Portada \(hero\) › Título/ }));
    const title = document.getElementById('f-a-title') as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(screen.getAllByText('Este campo es obligatorio.').length).toBeGreaterThan(0);
  });

  it('shows the review errors next to their field, and «Ir al campo» focuses it', async () => {
    const broken = {
      level: 'error', code: 'broken_link', key: 'broken_link:b:cta', block_id: 'b', block_index: 1, block_label: 'Llamado a la acción',
      field: 'cta', field_label: 'Botón', message: 'Enlace roto. Sección 2 (Llamado a la acción), campo «Botón»: /no-existe no lleva a ninguna página.',
      field_message: 'Enlace roto: /no-existe no lleva a ninguna página ni redirección. Elija otro destino.', value: null, preview: '', fix: null,
    };
    vi.mocked(reviewApi.check).mockResolvedValue({ data: { ok: false, errors: [broken], warnings: [], suggestions: [], issues: [broken], changes: [], baseline: 'none' } } as never);
    renderEditor();
    await userEvent.click(await screen.findByRole('button', { name: /Publicar/ }, { timeout: 8000 }));
    const dialog = await screen.findByRole('dialog', { name: 'Revisión antes de publicar' });
    expect(await within(dialog).findByRole('button', { name: /^Publicar$/ })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: /Ir al campo/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(publishPage).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: 'Antes de publicar, corrija 2 campos' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /2\. Llamado a la acción › Botón/ }));
    await waitFor(() => expect(document.activeElement?.id).toBe('f-b-cta'));
    expect(document.getElementById('f-b-cta-error')).toHaveTextContent('Enlace roto: /no-existe');
  });
});
