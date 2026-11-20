/**
 * «Cargar el diseño actual» and «Diseño original» also bring back the design's
 * SEO when the SEO fields still hold the old seed_cms values (docs/cms/safe-publish.md).
 */
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
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: { user: { id: number; role: string } }) => unknown) => sel({ user: { id: 1, role: 'admin' } }),
}));

import { contentApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';
import AdminPageEditor from './AdminPageEditor';
import { loadAllGroups } from '@/cms/sections/loaders';

const SEED_SEO = { title: 'Costos · Colegio Interlaken', description: 'Inscripción, colegiaturas, seguros, extraescolares y estancia por nivel.' };
const PAGE = {
  id: 7, slug: 'costos', title: 'Costos', template: 'simple', status: 'draft',
  draft_blocks: [{ id: 'a', type: 'hero', props: { title: 'Costos' } }],
  seo: { ...SEED_SEO, og_image: 3 }, seed_seo: SEED_SEO,
  published_version_number: null, has_unpublished_changes: true, published_at: null,
  review_requested_at: null, review_requested_by_name: '', review_note: '', publish_at: null, unpublish_at: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
};

const renderEditor = () => renderWithProviders(
  <Routes><Route path="/admin/contenido/:id" element={<AdminPageEditor />} /></Routes>,
  { route: '/admin/contenido/7' },
);
const lastSave = () => vi.mocked(contentApi.adminUpdatePage).mock.calls.slice(-1)[0][1];

beforeAll(async () => { await loadAllGroups(); }, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  stubViewport(1280);
  vi.mocked(contentApi.adminUpdatePage).mockImplementation(async (_id, data) => ({ data: { ...PAGE, ...data } }) as never);
});

describe('AdminPageEditor: the design brings its own SEO', () => {
  it('«Cargar el diseño actual» drops the seed SEO and keeps the share image', async () => {
    vi.mocked(contentApi.adminGetPage).mockResolvedValue({ data: PAGE } as never);
    renderEditor();
    await userEvent.click(await screen.findByRole('button', { name: 'Cargar el diseño actual' }, { timeout: 8000 }));
    await waitFor(() => expect(contentApi.adminUpdatePage).toHaveBeenCalled(), { timeout: 4000 });
    expect(lastSave().seo).toEqual({ og_image: 3 });
    expect(lastSave().draft_blocks?.[0].type).toBe('costos.hero');
  }, 20_000);

  it('«Diseño original» keeps SEO the school wrote', async () => {
    const own = { title: 'Costos y becas', description: SEED_SEO.description };
    vi.mocked(contentApi.adminGetPage).mockResolvedValue({
      data: { ...PAGE, seo: own, seed_seo: { description: SEED_SEO.description }, draft_blocks: [{ id: 'costos-1', type: 'costos.hero', props: { title: 'Otro' } }] },
    } as never);
    renderEditor();
    await userEvent.click(await screen.findByRole('button', { name: 'Más' }, { timeout: 8000 }));
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /Diseño original/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Restablecer borrador' }));
    await waitFor(() => expect(contentApi.adminUpdatePage).toHaveBeenCalled(), { timeout: 4000 });
    expect(lastSave().seo).toEqual({ title: 'Costos y becas' });
  }, 20_000);
});
