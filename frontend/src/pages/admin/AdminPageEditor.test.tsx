import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, Route, Routes } from 'react-router-dom';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/api', () => ({
  contentApi: {
    adminGetPage: vi.fn(),
    adminUpdatePage: vi.fn(),
    adminPageVersions: vi.fn(),
    adminRollbackPage: vi.fn(),
    adminPageChecks: vi.fn(),
    adminReviewPage: vi.fn(),
    adminPreviewToken: vi.fn(),
  },
}));
vi.mock('@/cms/editor/shell/publishApi', () => ({ publishPage: vi.fn() }));
let role = 'admin';
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: { user: { id: number; role: string } }) => unknown) => sel({ user: { id: 1, role } }),
}));

import toast from 'react-hot-toast';
import { contentApi } from '@/services/api';
import { publishPage } from '@/cms/editor/shell/publishApi';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';
import AdminPageEditor from './AdminPageEditor';
import { loadAllGroups } from '@/cms/sections/loaders';
import { originalBlocks } from '@/cms/editor/helpers';

const BLOCKS = [{ id: 'a', type: 'rich_text', props: { html: '<p>Hola</p>' } }];
const PAGE = {
  id: 7, slug: 'nosotros', title: 'Nosotros', template: 'simple', status: 'published', draft_blocks: BLOCKS, seo: {},
  published_version_number: 2, has_unpublished_changes: false, published_at: '2026-10-01T00:00:00Z',
  review_requested_at: null, review_requested_by_name: '', review_note: '', publish_at: null, unpublish_at: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
};
/** One of the nine old generic seeds: never published, generic blocks only. */
const LEGACY = { ...PAGE, status: 'draft', published_version_number: null, has_unpublished_changes: true };

const httpError = (status: number, data: Record<string, unknown>) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

function renderEditor(base = '/admin', query = '') {
  return renderWithProviders(
    <Routes>
      <Route path={`${base}/contenido/:id`} element={<><AdminPageEditor /><Link to={`${base}/contenido`}>Ir a la lista</Link></>} />
      <Route path={`${base}/contenido`} element={<p>Lista de páginas</p>} />
    </Routes>,
    { route: `${base}/contenido/7${query}` },
  );
}
/** The editor loads every page's section modules first (cold import in tests). */
const ready = () => screen.findByRole('button', { name: /Revisar/ }, { timeout: 8000 });
const openMore = async () => { await userEvent.click(screen.getByRole('button', { name: 'Más' })); return screen.findByRole('menu'); };
const lastPatch = () => vi.mocked(contentApi.adminUpdatePage).mock.calls.slice(-1)[0][1];

// Cold import of every section module once, outside the per-test timeouts.
beforeAll(async () => { await loadAllGroups(); }, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  role = 'admin';
  stubViewport(1280);
  vi.mocked(contentApi.adminGetPage).mockResolvedValue({ data: PAGE } as never);
  vi.mocked(contentApi.adminUpdatePage).mockImplementation(async (_id, data) => ({ data: { ...PAGE, ...data } }) as never);
});

describe('AdminPageEditor action bar', () => {
  it('shows the primary actions, the state chip and the rest under «Más»', async () => {
    renderEditor();
    await ready();
    expect(screen.getByRole('button', { name: /Vista previa/ })).toBeInTheDocument();
    // Published with nothing new: «Publicar» is there but has nothing to do.
    expect(screen.getByRole('button', { name: /Publicar/ })).toBeDisabled();
    expect(screen.getAllByText('Publicada')[0]).toBeInTheDocument();
    const menu = await openMore();
    const items = within(menu).getAllByRole('menuitem').map((i) => i.textContent);
    for (const label of ['Versiones', 'Enlace de vista previa', 'SEO', 'Programar', 'Diseño original', 'Retirar']) {
      expect(items.some((t) => t?.startsWith(label))).toBe(true);
    }
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Más' })).toHaveFocus();
  });

  it('autosaves, then shows the error with «Reintentar» when the save fails', async () => {
    vi.mocked(contentApi.adminUpdatePage).mockRejectedValueOnce(httpError(500, { detail: 'Error del servidor.' }));
    renderEditor();
    await userEvent.click(await screen.findByRole('button', { name: 'Ocultar del sitio' }, { timeout: 8000 }));
    expect(await screen.findByText('Cambios sin guardar')).toBeInTheDocument();
    expect(await screen.findByText('No se guardó el borrador', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Publicar/ })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: /Reintentar/ }));
    await waitFor(() => expect(contentApi.adminUpdatePage).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Guardado hace unos segundos/)).toBeInTheDocument();
  });

  it('asks before leaving through a console link while the last save failed', async () => {
    vi.mocked(contentApi.adminUpdatePage).mockRejectedValue(httpError(500, { detail: 'Error del servidor.' }));
    renderEditor();
    await userEvent.click(await screen.findByRole('button', { name: 'Ocultar del sitio' }, { timeout: 8000 }));
    await screen.findByText('No se guardó el borrador', {}, { timeout: 4000 });
    await userEvent.click(screen.getByRole('link', { name: 'Ir a la lista' }));
    const dialog = await screen.findByRole('dialog', { name: '¿Salir sin guardar?' });
    expect(screen.queryByText('Lista de páginas')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salir sin guardar' }));
    expect(await screen.findByText('Lista de páginas')).toBeInTheDocument();
    // The unsaved draft stays in this browser for the next visit.
    expect(localStorage.getItem('cms-local-copy:7')).toContain('"hidden":true');
  });

  it('a link inside the preview selects its section, even with a save pending', async () => {
    vi.mocked(contentApi.adminGetPage).mockResolvedValue({ data: { ...PAGE, draft_blocks: [{ id: 'a', type: 'rich_text', props: { html: '<p><a href="/contacto">Escríbanos</a></p>' } }] } } as never);
    renderEditor();
    await userEvent.click(await screen.findByRole('button', { name: 'Ocultar del sitio' }, { timeout: 8000 }));
    // The rich text renders from a lazy chunk.
    await userEvent.click(await screen.findByText('Escríbanos', { selector: 'a' }));
    expect(screen.getByRole('heading', { name: '1. Texto' })).toBeInTheDocument();
    expect(screen.queryByText('Lista de páginas')).not.toBeInTheDocument();
  });
});

describe('AdminPageEditor versions', () => {
  it('hides «Versiones» from staff (admin-only endpoint)', async () => {
    role = 'staff';
    renderEditor('/staff');
    await ready();
    const menu = await openMore();
    expect(within(menu).queryByRole('menuitem', { name: /Versiones/ })).not.toBeInTheDocument();
    expect(contentApi.adminPageVersions).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Solicitar aprobación/ })).toBeInTheDocument();
  });

  it('asks for confirmation and restores into the draft without publishing', async () => {
    vi.mocked(contentApi.adminPageVersions).mockResolvedValue({
      data: [{ id: 11, number: 1, author_name: 'Ana', created_at: '2026-09-01T00:00:00Z', blocks: BLOCKS }],
    } as never);
    vi.mocked(contentApi.adminRollbackPage).mockResolvedValue({
      data: { restored_from: 1, page: { ...PAGE, has_unpublished_changes: true } },
    } as never);
    renderEditor();
    await ready();
    await userEvent.click(within(await openMore()).getByRole('menuitem', { name: /Versiones/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Restaurar' }));
    expect(contentApi.adminRollbackPage).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: /Restaurar la versión 1 en el borrador/ });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Restaurar en el borrador' }));
    await waitFor(() => expect(contentApi.adminRollbackPage).toHaveBeenCalledWith(7, 1));
    expect(publishPage).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('restaurada en el borrador'));
  });

  it('opens «Versiones» straight from the list link (?versiones=1)', async () => {
    vi.mocked(contentApi.adminPageVersions).mockResolvedValue({ data: [] } as never);
    renderEditor('/admin', '?versiones=1');
    expect(await screen.findByRole('dialog', { name: 'Versiones publicadas' }, { timeout: 8000 })).toBeInTheDocument();
  });

  it('shows an error (not "aún no se ha publicado") when versions fail to load', async () => {
    vi.mocked(contentApi.adminPageVersions).mockRejectedValue(new Error('403'));
    renderEditor();
    await ready();
    await userEvent.click(within(await openMore()).getByRole('menuitem', { name: /Versiones/ }));
    expect(await screen.findByText('No se pudieron cargar las versiones')).toBeInTheDocument();
    expect(screen.queryByText('Esta página aún no se ha publicado.')).not.toBeInTheDocument();
  });

  it('staff autosave never sends slug or schedule fields', async () => {
    role = 'staff';
    renderEditor('/staff');
    await ready();
    await userEvent.click(within(await openMore()).getByRole('menuitem', { name: /SEO/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Título, dirección y SEO' });
    expect(within(dialog).getByLabelText('Dirección (slug)')).toBeDisabled();
    // Scheduling left the SEO dialog.
    expect(within(dialog).queryByLabelText(/Publicar automáticamente/)).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Título de la página'), ' 2');
    await waitFor(() => expect(contentApi.adminUpdatePage).toHaveBeenCalled(), { timeout: 4000 });
    const payload = lastPatch();
    expect(payload).not.toHaveProperty('slug');
    expect(payload).not.toHaveProperty('publish_at');
    expect(payload).not.toHaveProperty('unpublish_at');
  });
});

describe('AdminPageEditor «Programar»', () => {
  it('saves publish and withdraw dates in Mexico City time, right away', async () => {
    renderEditor();
    await ready();
    await userEvent.click(within(await openMore()).getByRole('menuitem', { name: /Programar/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Programar publicación' });
    expect(within(dialog).getByText(/Ciudad de México/)).toBeInTheDocument();
    const publishAt = within(dialog).getByLabelText('Fecha y hora de publicación');
    const unpublishAt = within(dialog).getByLabelText('Fecha y hora de retiro');
    await userEvent.type(publishAt, '2030-12-03T08:00');
    expect(within(dialog).getByText(/se publicará el borrador tal como esté/)).toBeInTheDocument();
    await userEvent.type(unpublishAt, '2030-12-01T08:00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar programación' }));
    expect(within(dialog).getByText('El retiro debe ser después de la publicación.')).toBeInTheDocument();
    expect(contentApi.adminUpdatePage).not.toHaveBeenCalled();
    await userEvent.clear(unpublishAt);
    await userEvent.type(unpublishAt, '2031-01-10T18:30');
    expect(within(dialog).getByText(/vuelve a mostrar el diseño original/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar programación' }));
    // Saved without waiting for the autosave delay; 08:00 in Mexico City is 14:00 UTC (UTC-6).
    await waitFor(() => expect(contentApi.adminUpdatePage).toHaveBeenCalled());
    expect(lastPatch()).toMatchObject({ publish_at: '2030-12-03T14:00:00.000Z', unpublish_at: '2031-01-11T00:30:00.000Z' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith('Programación guardada.');
  });

  it('cancels a schedule and shows «Programada» while one is set', async () => {
    vi.mocked(contentApi.adminGetPage).mockResolvedValue({ data: { ...PAGE, has_unpublished_changes: true, publish_at: '2030-12-03T14:00:00Z' } } as never);
    renderEditor();
    await ready();
    expect(screen.getByText('Programada')).toBeInTheDocument();
    await userEvent.click(within(await openMore()).getByRole('menuitem', { name: /Programar/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Programar publicación' });
    expect(within(dialog).getByLabelText('Fecha y hora de publicación')).toHaveValue('2030-12-03T08:00');
    await userEvent.click(within(dialog).getByRole('button', { name: /Cancelar la publicación programada/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Quitar la programación' }));
    await waitFor(() => expect(contentApi.adminUpdatePage).toHaveBeenCalled());
    expect(lastPatch()).toMatchObject({ publish_at: null, unpublish_at: null });
  });

  it('shows staff the schedule read-only', async () => {
    role = 'staff';
    renderEditor('/staff');
    await ready();
    await userEvent.click(within(await openMore()).getByRole('menuitem', { name: /Programar/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Programar publicación' });
    expect(within(dialog).getByLabelText('Fecha y hora de publicación')).toBeDisabled();
    expect(within(dialog).queryByRole('button', { name: /Guardar programación/ })).not.toBeInTheDocument();
  });
});

describe('AdminPageEditor contract C1 (old generic seed drafts)', () => {
  it('warns on open and, before publishing, recommends loading the current design', async () => {
    vi.mocked(contentApi.adminGetPage).mockResolvedValue({ data: { ...LEGACY, legacy_seed: true } } as never);
    renderEditor();
    await ready();
    expect(screen.getByText('Este borrador se creó con bloques sencillos', { exact: false })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Publicar/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Este borrador usa el formato antiguo' });
    expect(publishPage).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: /Cargar el diseño actual/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Nosotros starts with its photo hero, then its designed sections.
    expect(await screen.findByRole('button', { name: /^1\. Portada con foto/ })).toBeInTheDocument();
    expect(publishPage).not.toHaveBeenCalled();
    await waitFor(() => expect(contentApi.adminUpdatePage).toHaveBeenCalled(), { timeout: 4000 });
    expect(lastPatch().draft_blocks).toEqual(originalBlocks('nosotros'));
  });

  it('«Publicar de todos modos» resends with confirm_legacy', async () => {
    vi.mocked(contentApi.adminGetPage).mockResolvedValue({ data: { ...LEGACY, legacy_seed: true } } as never);
    vi.mocked(publishPage).mockResolvedValue({ data: { ...LEGACY, status: 'published', published_version_number: 1, version: 1 } } as never);
    renderEditor();
    await ready();
    await userEvent.click(screen.getByRole('button', { name: /Publicar/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Este borrador usa el formato antiguo' });
    await userEvent.click(within(dialog).getByRole('button', { name: /Publicar de todos modos/ }));
    await waitFor(() => expect(publishPage).toHaveBeenCalledWith(7, 'publish', true));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('opens the same dialog when the backend answers 409 legacy_seed_draft, and «Cancelar» publishes nothing', async () => {
    // The page is not flagged locally (legacy_seed false), the backend still refuses.
    vi.mocked(contentApi.adminGetPage).mockResolvedValue({ data: { ...PAGE, has_unpublished_changes: true, legacy_seed: false } } as never);
    vi.mocked(publishPage).mockRejectedValue(httpError(409, { code: 'legacy_seed_draft', detail: 'Borrador antiguo.' }));
    renderEditor();
    await ready();
    expect(screen.queryByText('Borrador antiguo')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Publicar/ }));
    await waitFor(() => expect(publishPage).toHaveBeenCalledWith(7, 'publish', false));
    const dialog = await screen.findByRole('dialog', { name: 'Este borrador usa el formato antiguo' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(publishPage).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('without the backend field, still recognises a generic-only draft (today\'s behaviour)', async () => {
    vi.mocked(contentApi.adminGetPage).mockResolvedValue({ data: LEGACY } as never);
    renderEditor();
    await userEvent.click(await screen.findByRole('button', { name: 'Cargar el diseño actual' }, { timeout: 8000 }));
    expect(await screen.findByRole('button', { name: /^1\. Portada con foto/ })).toBeInTheDocument();
    expect(screen.queryByText('Este borrador se creó con bloques sencillos', { exact: false })).not.toBeInTheDocument();
  });
});

describe('AdminPageEditor contract C2 (two people on one page)', () => {
  const CONFLICT = { code: 'draft_conflict', draft_revision: 5, draft_updated_by: 'Ana Ruiz', draft_updated_at: new Date(Date.now() - 120_000).toISOString() };

  it('sends draft_revision, pauses on a conflict and «Conservar los míos» overwrites with the new revision', async () => {
    vi.mocked(contentApi.adminGetPage).mockResolvedValue({ data: { ...PAGE, draft_revision: 3 } } as never);
    vi.mocked(contentApi.adminUpdatePage)
      .mockRejectedValueOnce(httpError(409, CONFLICT))
      .mockImplementation(async (_id, data) => ({ data: { ...PAGE, ...data, draft_revision: 6 } }) as never);
    renderEditor();
    await userEvent.click(await screen.findByRole('button', { name: 'Ocultar del sitio' }, { timeout: 8000 }));
    const banner = await screen.findByRole('alert', {}, { timeout: 4000 });
    expect(banner).toHaveTextContent('Ana Ruiz guardó cambios en esta página hace 2 min');
    expect(vi.mocked(contentApi.adminUpdatePage).mock.calls[0][1]).toMatchObject({ draft_revision: 3 });
    // Autosave is paused: another edit is kept locally, not sent.
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar en el sitio' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar del sitio' }));
    await act(() => new Promise((r) => setTimeout(r, 1800)));
    expect(contentApi.adminUpdatePage).toHaveBeenCalledTimes(1);
    await userEvent.click(within(banner).getByRole('button', { name: /Conservar los míos/ }));
    await waitFor(() => expect(contentApi.adminUpdatePage).toHaveBeenCalledTimes(2));
    expect(lastPatch()).toMatchObject({ draft_revision: 5, draft_blocks: [{ ...BLOCKS[0], hidden: true }] });
    await waitFor(() => expect(screen.queryByText(/guardó cambios en esta página/)).not.toBeInTheDocument());
    // The next save starts from the revision the server returned.
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar en el sitio' }));
    await waitFor(() => expect(contentApi.adminUpdatePage).toHaveBeenCalledTimes(3), { timeout: 4000 });
    expect(lastPatch()).toMatchObject({ draft_revision: 6 });
  }, 20_000);

  it('«Ver sus cambios (recargar)» loads theirs and keeps a copy of mine to recover', async () => {
    const theirs = [{ id: 'z', type: 'rich_text', props: { html: '<p>De Ana</p>' } }];
    vi.mocked(contentApi.adminGetPage)
      .mockResolvedValueOnce({ data: { ...PAGE, draft_revision: 3 } } as never)
      .mockResolvedValue({ data: { ...PAGE, draft_revision: 5, draft_blocks: theirs } } as never);
    vi.mocked(contentApi.adminUpdatePage).mockRejectedValueOnce(httpError(409, CONFLICT));
    renderEditor();
    await userEvent.click(await screen.findByRole('button', { name: 'Ocultar del sitio' }, { timeout: 8000 }));
    const banner = await screen.findByRole('alert', {}, { timeout: 4000 });
    await userEvent.click(within(banner).getByRole('button', { name: /Ver sus cambios/ }));
    expect(await screen.findByRole('button', { name: /^1\. Texto.*De Ana/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Recuperar mis cambios' }));
    expect(await screen.findByRole('button', { name: 'Mostrar en el sitio' })).toBeInTheDocument();
    await waitFor(() => expect(contentApi.adminUpdatePage).toHaveBeenCalledTimes(2), { timeout: 4000 });
    expect(lastPatch()).toMatchObject({ draft_revision: 5, draft_blocks: [{ ...BLOCKS[0], hidden: true }] });
  });

  it('sends no draft_revision when the backend has none (last save wins, as before)', async () => {
    renderEditor();
    await userEvent.click(await screen.findByRole('button', { name: 'Ocultar del sitio' }, { timeout: 8000 }));
    await waitFor(() => expect(contentApi.adminUpdatePage).toHaveBeenCalled(), { timeout: 4000 });
    expect(lastPatch()).not.toHaveProperty('draft_revision');
  });

  it('does not publish over a conflict', async () => {
    vi.mocked(contentApi.adminGetPage).mockResolvedValue({ data: { ...PAGE, draft_revision: 3 } } as never);
    vi.mocked(contentApi.adminUpdatePage).mockRejectedValue(httpError(409, CONFLICT));
    renderEditor();
    await userEvent.click(await screen.findByRole('button', { name: 'Ocultar del sitio' }, { timeout: 8000 }));
    await screen.findByRole('alert', {}, { timeout: 4000 });
    await userEvent.click(screen.getByRole('button', { name: /Publicar/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('otra persona guardó cambios')));
    expect(publishPage).not.toHaveBeenCalled();
  });
});

describe('AdminPageEditor sections', () => {
  it('hides a block without deleting it, and undo brings it back', async () => {
    renderEditor();
    const hide = await screen.findByRole('button', { name: 'Ocultar del sitio' }, { timeout: 8000 });
    await userEvent.click(hide);
    expect(screen.getByText('Oculta en el sitio')).toBeInTheDocument();
    await waitFor(() => expect(contentApi.adminUpdatePage).toHaveBeenCalled(), { timeout: 4000 });
    expect(lastPatch().draft_blocks).toEqual([{ ...BLOCKS[0], hidden: true }]);
    await userEvent.click(screen.getByRole('button', { name: /Deshacer/ }));
    expect(await screen.findByRole('button', { name: 'Ocultar del sitio' })).toBeInTheDocument();
  });

  it('opens a section\'s form, steps back to the list, copies and pastes it', async () => {
    renderEditor();
    await userEvent.click(await screen.findByRole('button', { name: /^1\. Texto/ }, { timeout: 8000 }));
    expect(screen.getByRole('heading', { name: '1. Texto' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Secciones' }));
    await userEvent.click(await screen.findByRole('button', { name: /Pegar/ }));
    expect(await screen.findByRole('heading', { name: '2. Texto' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Secciones' }));
    expect(screen.getByRole('button', { name: /^2\. Texto/ })).toBeInTheDocument();
  });

  it('reorders with Alt+arrow keys and announces the new position', async () => {
    vi.mocked(contentApi.adminGetPage).mockResolvedValue({ data: { ...PAGE, draft_blocks: [...BLOCKS, { id: 'b', type: 'video', props: { url: '' } }] } } as never);
    renderEditor();
    const first = await screen.findByRole('button', { name: /^1\. Texto/ }, { timeout: 8000 });
    first.focus();
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(screen.getByRole('button', { name: /^2\. Texto/ })).toBeInTheDocument();
    expect(screen.getByText(/posición 2 de 2/)).toBeInTheDocument();
  });

  it('shows the four-step guide once and remembers it was closed', async () => {
    const { unmount } = renderEditor();
    await ready();
    expect(screen.getByRole('heading', { name: /Cómo editar una página/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Cerrar la guía/ }));
    expect(localStorage.getItem('cms-onboarding-dismissed')).toBe('1');
    unmount();
    renderEditor();
    await ready();
    expect(screen.queryByRole('heading', { name: /Cómo editar una página/ })).not.toBeInTheDocument();
  });
});

describe('AdminPageEditor on phones and tablets', () => {
  beforeEach(() => stubViewport(390));

  it('switches between «Editar» and «Vista previa» and keeps the actions in a bottom bar', async () => {
    renderEditor();
    const tabs = await screen.findByRole('tablist', { name: 'Modo del editor' }, { timeout: 8000 });
    const bar = screen.getByRole('region', { name: 'Acciones de la página' });
    expect(within(bar).getByRole('button', { name: /Revisar/ })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: /Publicar/ })).toBeInTheDocument();
    expect(within(tabs).getByRole('tab', { name: /Editar/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('region', { name: 'Vista previa' })).not.toBeInTheDocument();

    await userEvent.click(within(tabs).getByRole('tab', { name: /Vista previa/ }));
    expect(screen.getByRole('region', { name: 'Vista previa' })).toBeInTheDocument();
    // A tap on a section in the preview opens its form, focused, on the «Editar» tab.
    await userEvent.click(screen.getByRole('button', { name: 'Editar bloque: Texto' }));
    expect(within(tabs).getByRole('tab', { name: /Editar/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: '1. Texto' })).toHaveFocus();
  });
});
