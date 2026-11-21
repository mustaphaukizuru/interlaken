import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
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

import AdminAdmissions from './AdminAdmissions';
import { api, downloadBlob } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';
import { makeCase } from '@/test/caseFixtures';

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);

const CASE = {
  id: 7,
  child_name: 'Ana Pérez',
  parent_name: 'Roberto Pérez',
  parent_phone: '5551234567',
  parent_email: 'roberto@ejemplo.test',
  level: 'primaria',
  level_label: 'Primaria',
  grade_applying: '1° Primaria',
  cycle: '2027-2028',
  stage: 'informes',
  stage_label: 'Informes',
  closed_outcome: '',
  closed_outcome_label: '',
  status: 'pending',
  next_action: { code: 'send_costs', label: 'Enviar cuotas' },
  days_waiting: 9,
  stage_changed_at: '2026-11-12T12:00:00Z',
  exam_at: null,
  created_at: '2026-11-12T12:00:00Z',
  updated_at: '2026-11-12T12:00:00Z',
};
const CASE_CLOSED = {
  ...CASE, id: 8, child_name: 'Beto Ruiz', stage: 'cerrado', stage_label: 'Cerrado',
  closed_outcome: 'no_aceptado', closed_outcome_label: 'No aceptado', next_action: null, days_waiting: 0,
};
const COUNTS = { informes: 4, visita: 3, examen: 2, documentacion: 1, inscrito: 12, cerrado: 5 };

const REG = {
  id: 3,
  child_name: 'Luis Ruiz',
  level: 'primaria',
  grade_applying: 'Primaria 2°',
  cycle: '2026-2027',
  parent1_name: 'María Ruiz',
  parent1_email: 'maria@ejemplo.test',
  parent1_phone: '5559999999',
  status: 'submitted',
  submitted_at: '2026-08-02T10:00:00Z',
  created_at: '2026-08-01T10:00:00Z',
  doc_count: 2,
  doc_verified: 1,
  pre_registration: 7,
};

const page = <T,>(results: T[], count = results.length) => ({ data: { count, next: null, previous: null, results } });

function mockLists({ cases = [CASE, CASE_CLOSED], regs = [REG], count }: { cases?: unknown[]; regs?: unknown[]; count?: number } = {}) {
  get.mockImplementation(async (url: string) => {
    if (url === '/admissions/admin/cases/') return { data: { ...page(cases, count).data, counts: COUNTS } } as never;
    if (url === '/admissions/register/') return page(regs) as never;
    if (url.endsWith('/export/')) return { data: new Blob(['x']) } as never;
    throw new Error(`unexpected GET ${url}`);
  });
}

function renderPage(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/admisiones" element={<AdminAdmissions />} />
      <Route path="/admin/admisiones/:caseId" element={<p>Expediente abierto</p>} />
    </Routes>,
    { route },
  );
}

describe('AdminAdmissions · Expedientes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubViewport(1280);
    mockLists();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('maps the URL state onto the cases request and shows the stage counts', async () => {
    renderPage('/admin/admisiones?q=ana&etapa=examen&nivel=primaria&ciclo=2027-2028&desde=2026-11-01&hasta=2026-11-30&orden=-child&page=2');
    expect(await screen.findByText('Ana Pérez')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/admissions/admin/cases/', {
      params: {
        page: 2, q: 'ana', stage: 'examen', level: 'primaria', cycle: '2027-2028',
        from: '2026-11-01', to: '2026-11-30', ordering: '-child',
      },
    });
    const tabs = screen.getByRole('tablist', { name: 'Filtrar por etapa' });
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Todos27', 'Informes4', 'Visita3', 'Examen2', 'Documentación1', 'Inscritos12', 'Cerrados5',
    ]);
    expect(within(tabs).getByRole('tab', { name: /Examen/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Expedientes' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the stage, the next step and the days waiting; closed cases show their outcome', async () => {
    renderPage('/admin/admisiones');
    const row = (await screen.findByText('Ana Pérez')).closest('tr')!;
    expect(row).toHaveTextContent('Informes');
    expect(row).toHaveTextContent('Enviar cuotas');
    expect(row).toHaveTextContent('9 días');
    expect(row).toHaveTextContent('Roberto Pérez');
    expect(row).toHaveTextContent('5551234567');
    const closed = screen.getByText('Beto Ruiz').closest('tr')!;
    expect(closed).toHaveTextContent('Cerrado · No aceptado');
  });

  it('a stage chip filters the list', async () => {
    const user = userEvent.setup();
    renderPage('/admin/admisiones');
    await screen.findByText('Ana Pérez');
    await user.click(screen.getByRole('tab', { name: /Cerrados/ }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/admissions/admin/cases/', { params: { page: 1, stage: 'cerrado' } }));
  });

  it('a row opens its Expediente', async () => {
    const user = userEvent.setup();
    renderPage('/admin/admisiones');
    const row = (await screen.findByText('Beto Ruiz')).closest('tr')!;
    await user.click(within(row).getByText('Cerrado · No aceptado'));
    expect(await screen.findByText('Expediente abierto')).toBeInTheDocument();
  });

  it('«Nuevo prospecto» warns about duplicates with links, then creates and opens the Expediente', async () => {
    const user = userEvent.setup();
    post.mockImplementation(async (_url: string, _body: unknown, cfg?: { params?: unknown }) => {
      if ((cfg?.params as { dry_run?: number } | undefined)?.dry_run) return { data: { created: false, duplicates: [CASE] } } as never;
      return { data: { ...makeCase('informes', { id: 31, child_name: 'Sofía Pérez' }), duplicates: [CASE] } } as never;
    });
    renderPage('/admin/admisiones');
    await screen.findByText('Ana Pérez');
    await user.click(screen.getByRole('button', { name: /Nuevo prospecto/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo prospecto' });
    await user.click(within(dialog).getByRole('button', { name: 'Crear expediente' }));
    expect(within(dialog).getAllByText('Escriba el nombre del alumno.').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('Elija el grado.').length).toBeGreaterThan(0);
    expect(post).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText('Nombre del alumno'), 'Sofía Pérez');
    await user.type(within(dialog).getByLabelText('Nombre del tutor'), 'Roberto Pérez');
    await user.type(within(dialog).getByLabelText('Celular'), '55 5123 4567');
    await user.selectOptions(within(dialog).getByLabelText('Grado al que ingresa'), '3° Primaria');
    await user.type(within(dialog).getByLabelText('Edad (opcional)'), '8');
    await user.type(within(dialog).getByLabelText('Colegio de procedencia (opcional)'), 'Colegio Ficticio');
    await user.click(within(dialog).getByRole('button', { name: 'Crear expediente' }));

    const body = {
      child_name: 'Sofía Pérez', parent_name: 'Roberto Pérez', parent_phone: '55 5123 4567', grade_applying: '3° Primaria',
      cycle: 'proximo', previous_school: 'Colegio Ficticio', child_age: 8, parent_email: '',
    };
    await waitFor(() => expect(post).toHaveBeenCalledWith('/admissions/admin/cases/', body, { params: { dry_run: 1 } }));
    const warning = await within(dialog).findByRole('alert');
    expect(warning).toHaveTextContent('Ya hay un expediente con ese celular o correo.');
    expect(within(warning).getByRole('link', { name: 'Ana Pérez' })).toHaveAttribute('href', '/admin/admisiones/7');

    await user.click(within(dialog).getByRole('button', { name: 'Crear de todos modos' }));
    await waitFor(() => expect(post).toHaveBeenLastCalledWith('/admissions/admin/cases/', body, undefined));
    expect(await screen.findByText('Expediente abierto')).toBeInTheDocument();
  });

  it('«Nuevo prospecto» without duplicates creates right away; server field errors stay on the form', async () => {
    const user = userEvent.setup();
    post.mockRejectedValueOnce({ response: { status: 400, data: { parent_phone: ['Escriba un celular de 10 dígitos.'] } } });
    renderPage('/admin/admisiones');
    await screen.findByText('Ana Pérez');
    await user.click(screen.getByRole('button', { name: /Nuevo prospecto/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo prospecto' });
    await user.type(within(dialog).getByLabelText('Nombre del alumno'), 'Sofía Pérez');
    await user.type(within(dialog).getByLabelText('Nombre del tutor'), 'Roberto Pérez');
    await user.type(within(dialog).getByLabelText('Celular'), '5551234567');
    await user.selectOptions(within(dialog).getByLabelText('Grado al que ingresa'), 'Maternal');
    await user.click(within(dialog).getByRole('radio', { name: /ciclo en curso/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Crear expediente' }));
    expect(await within(dialog).findAllByText(/Escriba un celular de 10 dígitos/)).toHaveLength(2);
    expect(within(dialog).getByLabelText('Celular')).toHaveAttribute('aria-invalid', 'true');

    post.mockImplementation(async (_u: string, _b: unknown, cfg?: { params?: unknown }) =>
      ((cfg?.params as { dry_run?: number } | undefined)?.dry_run
        ? { data: { created: false, duplicates: [] } }
        : { data: { ...makeCase('informes', { id: 32 }), duplicates: [] } }) as never);
    await user.click(within(dialog).getByRole('button', { name: 'Crear expediente' }));
    await waitFor(() => expect(post).toHaveBeenLastCalledWith('/admissions/admin/cases/', expect.objectContaining({ cycle: 'actual', grade_applying: 'Maternal' }), undefined));
    expect(await screen.findByText('Expediente abierto')).toBeInTheDocument();
  });

  it('exports the current view with the stage filter (pre-registro export)', async () => {
    const user = userEvent.setup();
    renderPage('/admin/admisiones?etapa=visita&orden=stage_changed_at');
    await screen.findByText('Ana Pérez');
    await user.click(screen.getByRole('button', { name: /^Exportar$/ }));
    await user.click(screen.getByRole('menuitem', { name: /Excel/ }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/admissions/pre-register/export/', {
      params: { q: undefined, stage: 'visita', level: undefined, cycle: undefined, from: undefined, to: undefined, ordering: undefined, fmt: 'xlsx', ids: undefined },
      responseType: 'blob',
    }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
  });

  it('selected rows offer only «Exportar seleccionados» (no bulk stage moves)', async () => {
    const user = userEvent.setup();
    renderPage('/admin/admisiones');
    await screen.findByText('Ana Pérez');
    await user.click(screen.getByRole('checkbox', { name: 'Seleccionar expediente de Ana Pérez' }));
    const bar = screen.getByRole('region', { name: 'Acciones en lote' });
    expect(within(bar).queryByRole('button', { name: /Marcar|Invitar|No procedió/ })).not.toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: /Exportar seleccionados/ })).toBeInTheDocument();
  });

  it('opens the import dialog with the pre-registros template', async () => {
    const user = userEvent.setup();
    renderPage('/admin/admisiones');
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
    renderPage('/admin/admisiones?q=ana&etapa=informes');
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

  it('maps inscripciones filters, opens the review and links each ficha to its Expediente', async () => {
    const user = userEvent.setup();
    renderPage('/admin/admisiones?vista=inscripciones&docs=true&estado=reviewing&orden=submitted_at');
    expect(await screen.findByText('Luis Ruiz')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/admissions/register/', {
      params: { page: 1, status: 'reviewing', documents_pending: 'true', ordering: 'submitted_at' },
    });
    expect(screen.getByRole('link', { name: 'Abrir el expediente de admisión de Luis Ruiz' })).toHaveAttribute('href', '/admin/admisiones/7');
    await user.click(screen.getByRole('button', { name: 'Revisar expediente de Luis Ruiz' }));
    expect(await screen.findByRole('dialog', { name: /revisión/i })).toHaveTextContent('Expediente #3');
  });

  it('the ?inscripcion= deep link opens the review on the inscripciones tab', async () => {
    renderPage('/admin/admisiones?inscripcion=3');
    expect(await screen.findByRole('dialog', { name: /revisión/i })).toHaveTextContent('Expediente #3');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Inscripciones' })).toHaveAttribute('aria-selected', 'true'));
  });

  it('renders cards with checkboxes on phones (no bespoke mobile list)', async () => {
    stubViewport(375);
    renderPage('/admin/admisiones');
    expect(await screen.findByText('Ana Pérez')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Seleccionar expediente de Ana Pérez' })).toBeInTheDocument();
  });

  it.each([
    ['expedientes', '/admin/admisiones', 'Ana Pérez'],
    ['inscripciones', '/admin/admisiones?vista=inscripciones', 'Luis Ruiz'],
  ])('%s has no serious/critical axe violations', async (_name, route, text) => {
    const { container } = renderPage(route);
    expect(await screen.findByText(text)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('checkbox')[1]);
    await screen.findByRole('region', { name: 'Acciones en lote' });
    const results = await axe(container);
    expect(results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual([]);
  });
});
