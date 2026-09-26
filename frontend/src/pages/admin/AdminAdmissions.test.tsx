import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';

vi.mock('@/services/api', async () => ({
  ...(await vi.importActual<typeof import('@/services/dataOps')>('@/services/dataOps')),
  downloadBlob: vi.fn(),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  admissionsAdminApi: {},
}));

vi.mock('@/components/admin/RegistrationReviewModal', () => ({
  RegistrationReviewModal: ({ open, id }: { open: boolean; id: number | null }) =>
    open ? <div role="dialog" aria-label="Revisión">{`Expediente #${id}`}</div> : null,
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), loading: vi.fn(() => 't'), dismiss: vi.fn() },
}));

import toast from 'react-hot-toast';
import AdminAdmissions from './AdminAdmissions';
import { api, downloadBlob } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const patch = vi.mocked(api.patch);
const toastSuccess = vi.mocked(toast.success);

const PRE = {
  id: 7,
  child_name: 'Ana Pérez',
  level: 'primaria',
  grade_applying: 'Primaria 1°',
  cycle: '2026-2027',
  parent_name: 'Roberto Pérez',
  parent_email: 'roberto@test.mx',
  parent_phone: '5551234567',
  wants_visit: true,
  status: 'pending',
  created_at: '2026-08-01T12:00:00Z',
};
const PRE_CONTACTED = { ...PRE, id: 8, child_name: 'Beto Ruiz', status: 'contacted' };

const REG = {
  id: 3,
  child_name: 'Luis Ruiz',
  level: 'primaria',
  grade_applying: 'Primaria 2°',
  cycle: '2026-2027',
  parent1_name: 'María Ruiz',
  parent1_email: 'maria@test.mx',
  parent1_phone: '5559999999',
  status: 'submitted',
  submitted_at: '2026-08-02T10:00:00Z',
  created_at: '2026-08-01T10:00:00Z',
  doc_count: 2,
  doc_verified: 1,
};

const page = <T,>(results: T[], count = results.length) => ({ data: { count, next: null, previous: null, results } });

function mockLists({ pre = [PRE, PRE_CONTACTED], regs = [REG] }: { pre?: unknown[]; regs?: unknown[] } = {}) {
  get.mockImplementation(async (url: string) => {
    if (url === '/admissions/pre-register/') return page(pre) as never;
    if (url === '/admissions/register/') return page(regs) as never;
    if (url.endsWith('/export/')) return { data: new Blob(['x']) } as never;
    throw new Error(`unexpected GET ${url}`);
  });
}

const plan = (over: Record<string, unknown> = {}) => ({
  data: { action: 'set_status', requested: 1, ok: 1, failed: [], skipped: [], dry_run: true, ...over },
});

describe('AdminAdmissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubViewport(1280);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    mockLists();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('maps the URL state onto the pre-registros list request', async () => {
    renderWithProviders(<AdminAdmissions />, {
      route: '/admin/admisiones?q=ana&estado=pending&nivel=primaria&ciclo=2026-2027&visita=true&desde=2026-08-01&hasta=2026-08-31&orden=-child&page=2',
    });
    expect(await screen.findByText('Ana Pérez')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/admissions/pre-register/', {
      params: {
        page: 2, q: 'ana', status: 'pending', level: 'primaria', cycle: '2026-2027', wants_visit: 'true',
        from: '2026-08-01', to: '2026-08-31', ordering: '-child',
      },
    });
    expect(screen.getByRole('columnheader', { name: 'Alumno' })).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('tab', { name: 'Pre-registros' })).toHaveAttribute('aria-selected', 'true');
  });

  it('offers only allowed transitions and patches forward moves directly', async () => {
    const user = userEvent.setup();
    patch.mockResolvedValue({ data: {} } as never);
    renderWithProviders(<AdminAdmissions />, { route: '/admin/admisiones' });
    const select = await screen.findByLabelText('Cambiar estado del pre-registro de Ana Pérez');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Pendiente', 'Contactado', 'Inscrito', 'No procedió']);
    await user.selectOptions(select, 'contacted');
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/admissions/pre-register/7/', { status: 'contacted' }));
    expect(toastSuccess).toHaveBeenCalledWith('Estado actualizado.');
  });

  it('a reverse move opens the confirm dialog and requires a note', async () => {
    const user = userEvent.setup();
    post.mockImplementation(async (_url: string, body: unknown) => {
      const b = body as { dry_run?: boolean };
      return plan({ dry_run: !!b.dry_run }) as never;
    });
    renderWithProviders(<AdminAdmissions />, { route: '/admin/admisiones' });
    await user.selectOptions(await screen.findByLabelText('Cambiar estado del pre-registro de Beto Ruiz'), 'pending');
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(post).toHaveBeenCalledWith('/admissions/admin/pre-registrations/bulk/', {
      action: 'set_status', ids: [8], all_matching: false, filters: undefined, dry_run: true, payload: { status: 'pending' },
    }));
    const confirm = await within(dialog).findByRole('button', { name: /Regresar a pendiente \(1\)/ });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Motivo (obligatorio)'), 'Se reabre');
    await user.click(confirm);
    await waitFor(() => expect(post).toHaveBeenLastCalledWith('/admissions/admin/pre-registrations/bulk/', {
      action: 'set_status', ids: [8], all_matching: false, filters: undefined, dry_run: false,
      payload: { note: 'Se reabre', status: 'pending' },
    }));
    expect(patch).not.toHaveBeenCalled();
  });

  it('bulk "select all matching" sends the list filters to set_status', async () => {
    const user = userEvent.setup();
    get.mockImplementation(async (url: string) => (url === '/admissions/pre-register/' ? page([PRE, PRE_CONTACTED], 120) : page([])) as never);
    post.mockImplementation(async (_u: string, body: unknown) => plan({ requested: 120, ok: 118, dry_run: !!(body as { dry_run?: boolean }).dry_run }) as never);
    renderWithProviders(<AdminAdmissions />, { route: '/admin/admisiones?nivel=secundaria' });
    await screen.findByText('Ana Pérez');
    await user.click(screen.getByRole('checkbox', { name: 'Seleccionar todas las filas de esta página' }));
    await user.click(screen.getByRole('button', { name: 'Seleccionar las 120 que coinciden' }));
    const bar = screen.getByRole('region', { name: 'Acciones en lote' });
    await user.click(within(bar).getByRole('button', { name: 'Marcar contactados' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/admissions/admin/pre-registrations/bulk/', expect.objectContaining({
      action: 'set_status', all_matching: true, ids: [], dry_run: true,
      filters: expect.objectContaining({ level: 'secundaria' }), payload: { status: 'contacted' },
    })));
    expect(await screen.findByText(/Se marcarán como contactados/)).toBeInTheDocument();
  });

  it('invites a family from the row action and shows the link banner', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ data: { invite_url: 'https://interlaken.edu.mx/inscripcion?rid=1&token=abc' } } as never);
    renderWithProviders(<AdminAdmissions />, { route: '/admin/admisiones' });
    await user.click(await screen.findByRole('button', { name: 'Invitar a inscripción: Ana Pérez' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/admissions/pre-register/7/invite/'));
    expect(await screen.findByText(/Invitación generada para Ana Pérez/)).toBeInTheDocument();
  });

  it('exports the current pre-registros view', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminAdmissions />, { route: '/admin/admisiones?estado=pending' });
    await screen.findByText('Ana Pérez');
    await user.click(screen.getByRole('button', { name: /^Exportar$/ }));
    await user.click(screen.getByRole('menuitem', { name: /Excel/ }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/admissions/pre-register/export/', {
      params: { status: 'pending', fmt: 'xlsx', ids: undefined, q: undefined, level: undefined, cycle: undefined, wants_visit: undefined, from: undefined, to: undefined, ordering: undefined },
      responseType: 'blob',
    }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
  });

  it('opens the import dialog with the pre-registros template', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminAdmissions />, { route: '/admin/admisiones' });
    await screen.findByText('Ana Pérez');
    await user.click(screen.getByRole('button', { name: 'Importar' }));
    expect(await screen.findByRole('dialog', { name: /Importar pre-registros/ })).toBeInTheDocument();
    get.mockResolvedValueOnce({ data: new Blob(['x']) } as never);
    await user.click(screen.getByRole('button', { name: 'Descargar plantilla CSV' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/admissions/admin/pre-registrations/import/template/', { params: { fmt: 'csv' }, responseType: 'blob' }));
  });

  it('switches to inscripciones, filters and bulk-approves with the notify checkbox', async () => {
    const user = userEvent.setup();
    post.mockImplementation(async (_u: string, body: unknown) => ({
      data: { action: 'approve', requested: 1, ok: 1, failed: [], skipped: [], dry_run: !!(body as { dry_run?: boolean }).dry_run },
    }) as never);
    renderWithProviders(<AdminAdmissions />, { route: '/admin/admisiones?q=ana' });
    await screen.findByText('Ana Pérez');
    await user.click(screen.getByRole('tab', { name: 'Inscripciones' }));
    expect(await screen.findByText('Luis Ruiz')).toBeInTheDocument();
    // Switching section starts from a clean filter set.
    expect(get).toHaveBeenLastCalledWith('/admissions/register/', { params: { page: 1 } });
    await user.click(screen.getByRole('checkbox', { name: 'Seleccionar inscripción de Luis Ruiz' }));
    await user.click(within(screen.getByRole('region', { name: 'Acciones en lote' })).getByRole('button', { name: 'Aprobar' }));
    const dialog = await screen.findByRole('dialog');
    const notify = await within(dialog).findByRole('checkbox', { name: 'Notificar a las familias' });
    await user.click(notify);
    await user.click(within(dialog).getByRole('button', { name: /Aprobar \(1\)/ }));
    await waitFor(() => expect(post).toHaveBeenLastCalledWith('/admissions/admin/registrations/bulk/', {
      action: 'approve', ids: [3], all_matching: false, filters: undefined, dry_run: false, payload: { notify: false },
    }));
  });

  it('maps inscripciones filters and opens the review from the row action', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminAdmissions />, { route: '/admin/admisiones?vista=inscripciones&docs=true&estado=reviewing&orden=submitted_at' });
    expect(await screen.findByText('Luis Ruiz')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/admissions/register/', {
      params: { page: 1, status: 'reviewing', documents_pending: 'true', ordering: 'submitted_at' },
    });
    await user.click(screen.getByRole('button', { name: 'Revisar expediente de Luis Ruiz' }));
    expect(await screen.findByRole('dialog', { name: /revisión/i })).toHaveTextContent('Expediente #3');
  });

  it('the ?inscripcion= deep link opens the review on the inscripciones tab', async () => {
    renderWithProviders(<AdminAdmissions />, { route: '/admin/admisiones?inscripcion=3' });
    expect(await screen.findByRole('dialog', { name: /revisión/i })).toHaveTextContent('Expediente #3');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Inscripciones' })).toHaveAttribute('aria-selected', 'true'));
  });

  it('renders cards with checkboxes on phones (no bespoke mobile list)', async () => {
    stubViewport(375);
    renderWithProviders(<AdminAdmissions />, { route: '/admin/admisiones' });
    expect(await screen.findByText('Ana Pérez')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Seleccionar pre-registro de Ana Pérez' })).toBeInTheDocument();
  });

  it.each([
    ['pre-registros', '/admin/admisiones', 'Ana Pérez'],
    ['inscripciones', '/admin/admisiones?vista=inscripciones', 'Luis Ruiz'],
  ])('%s has no serious/critical axe violations', async (_name, route, text) => {
    const { container } = renderWithProviders(<AdminAdmissions />, { route });
    expect(await screen.findByText(text)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('checkbox')[1]);
    await screen.findByRole('region', { name: 'Acciones en lote' });
    const results = await axe(container);
    expect(results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual([]);
  });
});
