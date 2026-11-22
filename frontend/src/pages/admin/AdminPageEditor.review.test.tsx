/**
 * «Revisión antes de publicar» inside the page editor, on the «costos» incident
 * of 2026-11-21 (synthetic data): «Publicar» opens the review, quick fixes
 * write the field, warnings need «Entiendo las advertencias», leaving with
 * unpublished edits asks, old drafts get a banner, «Descartar cambios».
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, Route, Routes } from 'react-router-dom';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));
vi.mock('@/services/api', () => ({
  contentApi: {
    adminGetPage: vi.fn(), adminUpdatePage: vi.fn(), adminPageVersions: vi.fn(), adminRollbackPage: vi.fn(),
    adminReviewPage: vi.fn(), adminPreviewToken: vi.fn(),
  },
}));
vi.mock('@/cms/editor/shell/publishApi', () => ({ publishPage: vi.fn() }));
vi.mock('@/cms/editor/review/reviewApi', async (orig) => ({ ...(await orig<object>()), reviewApi: { check: vi.fn(), discard: vi.fn() } }));
let role = 'admin';
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: { user: { id: number; role: string } }) => unknown) => sel({ user: { id: 1, role } }),
}));

import toast from 'react-hot-toast';
import { contentApi } from '@/services/api';
import { publishPage } from '@/cms/editor/shell/publishApi';
import { reviewApi } from '@/cms/editor/review/reviewApi';
import { COSTOS_BLOCKS, FICHA, GLUED, ONLY_FEES, ONLY_TUITION, VISIT, report } from '@/cms/editor/review/review.fixtures';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';
import { loadAllGroups } from '@/cms/sections/loaders';
import AdminPageEditor from './AdminPageEditor';

const DAY = 86_400_000;
const LIVE_BLOCKS = [COSTOS_BLOCKS[0], { ...COSTOS_BLOCKS[1], props: { ctaPrimary: FICHA } }];
const PAGE = {
  id: 7, slug: 'costos', title: 'Costos', template: 'simple', status: 'published', draft_blocks: COSTOS_BLOCKS, seo: {},
  published_version_number: 1, has_unpublished_changes: true, published_at: '2026-11-01T00:00:00Z',
  review_requested_at: null, review_requested_by_name: '', review_note: '', publish_at: null, unpublish_at: null,
  draft_revision: 4, unpublished_since: new Date(Date.now() - 5 * DAY).toISOString(),
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-11-16T00:00:00Z',
};
const httpError = (status: number, data: Record<string, unknown>) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

function renderEditor() {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/contenido/:id" element={<><AdminPageEditor /><Link to="/admin/contenido">Ir a la lista</Link></>} />
      <Route path="/admin/contenido" element={<p>Lista de páginas</p>} />
    </Routes>,
    { route: '/admin/contenido/7' },
  );
}
const ready = () => screen.findByRole('button', { name: /Revisar$/ }, { timeout: 8000 });
const openReview = async () => {
  await userEvent.click(screen.getByRole('button', { name: /^Publicar$/ }));
  return screen.findByRole('dialog', { name: 'Revisión antes de publicar' });
};
const lastCheck = () => vi.mocked(reviewApi.check).mock.calls.slice(-1)[0];

beforeAll(async () => { await loadAllGroups(); }, 60_000);
beforeEach(() => {
  vi.clearAllMocks();
  role = 'admin';
  stubViewport(1280);
  vi.mocked(contentApi.adminGetPage).mockResolvedValue({ data: PAGE } as never);
  vi.mocked(contentApi.adminUpdatePage).mockImplementation(async (_id, data) => ({ data: { ...PAGE, ...data, draft_revision: 5 } }) as never);
  vi.mocked(reviewApi.check).mockResolvedValue({ data: report() } as never);
});

describe('AdminPageEditor «Revisión antes de publicar»', () => {
  it('«Publicar» reviews the draft on screen and stops on the private link', async () => {
    renderEditor();
    await ready();
    const dialog = await openReview();
    expect(lastCheck()).toEqual([7, { draft_blocks: COSTOS_BLOCKS, seo: {} }]);
    expect(await within(dialog).findByText(/todavía no se puede publicar/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /^Publicar$/ })).toBeDisabled();
    expect(publishPage).not.toHaveBeenCalled();
  });

  it('a quick fix writes the field, autosaves it and reviews again', async () => {
    renderEditor();
    await ready();
    const dialog = await openReview();
    vi.mocked(reviewApi.check).mockResolvedValue({ data: report({ errors: [] }) } as never);
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Cambiar por «Agendar visita»' }));
    expect(toast.success).toHaveBeenCalledWith('Corregido: Cambiar por «Agendar visita».');
    await waitFor(() => expect(vi.mocked(reviewApi.check)).toHaveBeenCalledTimes(2));
    expect((lastCheck()[1]!.draft_blocks[1].props as Record<string, unknown>).ctaPrimary).toEqual(VISIT);
    await waitFor(() => expect(contentApi.adminUpdatePage).toHaveBeenCalled(), { timeout: 4000 });
    const saved = vi.mocked(contentApi.adminUpdatePage).mock.calls.slice(-1)[0][1];
    expect((saved.draft_blocks![1].props as Record<string, unknown>).ctaPrimary).toEqual(VISIT);
    // Now only warnings: «Publicar» waits for the tick.
    expect(await within(dialog).findByText(/puede publicarse, pero revise las 3 advertencias/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /^Publicar$/ })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Entiendo las advertencias' }));
    expect(within(dialog).getByRole('button', { name: /^Publicar$/ })).toBeEnabled();
  });

  it('publishes with the acknowledged warnings, and a new server warning reopens the review', async () => {
    vi.mocked(reviewApi.check).mockResolvedValue({ data: report({ errors: [], warnings: [GLUED, ONLY_TUITION] }) } as never);
    vi.mocked(publishPage).mockRejectedValueOnce(httpError(409, { code: 'publish_warnings', detail: 'Revise', ...report({ errors: [], warnings: [GLUED, ONLY_TUITION, ONLY_FEES] }) }));
    renderEditor();
    await ready();
    const dialog = await openReview();
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Entiendo las advertencias' }));
    await userEvent.click(within(dialog).getByRole('button', { name: /^Publicar$/ }));
    await waitFor(() => expect(publishPage).toHaveBeenCalledWith(7, 'publish', false, [GLUED.key, ONLY_TUITION.key]));
    // Someone added a slip meanwhile: the review shows it and the tick is off again.
    expect(await within(dialog).findByRole('region', { name: /Advertencias \(3\)/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: 'Entiendo las advertencias' })).not.toBeChecked();
    expect(toast.error).toHaveBeenCalledWith('Apareció una advertencia nueva: revísela antes de publicar.');

    vi.mocked(publishPage).mockResolvedValueOnce({ data: { ...PAGE, has_unpublished_changes: false, version: 2 } } as never);
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Entiendo las advertencias' }));
    await userEvent.click(within(dialog).getByRole('button', { name: /^Publicar$/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Publicada (versión 2).'));
    expect(screen.queryByRole('dialog', { name: 'Revisión antes de publicar' })).not.toBeInTheDocument();
  });

  it('shows the review warnings under their field («Ir al campo»)', async () => {
    renderEditor();
    await ready();
    const dialog = await openReview();
    await userEvent.click((await within(dialog).findAllByRole('button', { name: /Ir al campo/ }))[1]);
    expect(screen.queryByRole('dialog', { name: 'Revisión antes de publicar' })).not.toBeInTheDocument();
    await waitFor(() => expect(document.getElementById('f-costos-2-daycareYear-warn')).toHaveTextContent('quedó pegado al texto'));
    expect(document.getElementById('f-costos-2-ctaPrimary-error')).toHaveTextContent('La ficha de inscripción es personal');
    expect(screen.getByText('Revisión:')).toBeInTheDocument();
  });

  it('an old unpublished draft gets a banner that opens the review', async () => {
    renderEditor();
    await ready();
    const banner = screen.getByText(/Este borrador tiene cambios sin publicar desde el/).closest('[role="status"]') as HTMLElement;
    expect(banner).toHaveTextContent('(hace 5 días)');
    await userEvent.click(within(banner).getByRole('button', { name: 'Revisar los cambios' }));
    expect(await screen.findByRole('dialog', { name: 'Revisión antes de publicar' })).toBeInTheDocument();
  });

  it('no banner for recent edits', async () => {
    vi.mocked(contentApi.adminGetPage).mockResolvedValue({ data: { ...PAGE, unpublished_since: new Date(Date.now() - DAY).toISOString() } } as never);
    renderEditor();
    await ready();
    expect(screen.queryByText(/Este borrador tiene cambios sin publicar desde el/)).not.toBeInTheDocument();
  });

  it('asks before leaving with saved but unpublished edits', async () => {
    renderEditor();
    await ready();
    await userEvent.click(screen.getAllByRole('button', { name: 'Ocultar del sitio' })[0]);
    await waitFor(() => expect(contentApi.adminUpdatePage).toHaveBeenCalled(), { timeout: 4000 });
    await userEvent.click(screen.getByRole('link', { name: 'Ir a la lista' }));
    const ask = await screen.findByRole('dialog', { name: '¿Salir sin publicar?' });
    expect(ask).toHaveTextContent('el sitio no los muestra hasta que los publique');
    await userEvent.click(within(ask).getByRole('button', { name: 'Salir sin publicar' }));
    expect(await screen.findByText('Lista de páginas')).toBeInTheDocument();
  });

  it('leaves without asking when nothing was edited here', async () => {
    renderEditor();
    await ready();
    await userEvent.click(screen.getByRole('link', { name: 'Ir a la lista' }));
    expect(await screen.findByText('Lista de páginas')).toBeInTheDocument();
  });

  it('«Descartar cambios» brings the draft back to the published version', async () => {
    vi.mocked(reviewApi.discard).mockResolvedValue({ data: { ...PAGE, draft_blocks: LIVE_BLOCKS, has_unpublished_changes: false, unpublished_since: null, draft_revision: 5 } } as never);
    renderEditor();
    await ready();
    const dialog = await openReview();
    await userEvent.click(await within(dialog).findByRole('button', { name: /Descartar cambios/ }));
    const confirm = await screen.findByRole('dialog', { name: '¿Descartar los cambios sin publicar?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Descartar cambios' }));
    await waitFor(() => expect(reviewApi.discard).toHaveBeenCalledWith(7, 4));
    expect(toast.success).toHaveBeenCalledWith('Cambios descartados: el borrador es igual a lo que muestra el sitio.');
    expect(screen.queryByRole('dialog', { name: 'Revisión antes de publicar' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Este borrador tiene cambios sin publicar/)).not.toBeInTheDocument();
  });

  it('staff ask for approval from the review', async () => {
    role = 'staff';
    vi.mocked(reviewApi.check).mockResolvedValue({ data: report({ errors: [] }) } as never);
    vi.mocked(contentApi.adminReviewPage).mockResolvedValue({ data: { ...PAGE, review_requested_at: '2026-11-21T10:00:00Z' } } as never);
    renderEditor();
    await ready();
    await userEvent.click(screen.getByRole('button', { name: /Solicitar aprobación/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Revisión antes de publicar' });
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    await userEvent.click(await within(dialog).findByRole('button', { name: /Solicitar aprobación/ }));
    await waitFor(() => expect(contentApi.adminReviewPage).toHaveBeenCalledWith(7, 'request', undefined));
    expect(publishPage).not.toHaveBeenCalled();
  });
});
