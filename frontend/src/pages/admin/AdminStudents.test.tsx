import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';

vi.mock('react-hot-toast', () => ({ default: { loading: vi.fn(() => 't1'), success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  portalApi: {
    getStudents: vi.fn(),
    getStudent: vi.fn(),
    exportStudents: vi.fn(),
    studentsBulk: vi.fn(),
    importLoyverse: vi.fn(),
    linkLoyverse: vi.fn(),
  },
  downloadBlob: vi.fn(),
}));

import AdminStudents from './AdminStudents';
import { api, portalApi, downloadBlob } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';

const mockedStudents = vi.mocked(portalApi.getStudents);

/** Exposes the router's current URL so tests can assert on filter sync. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

describe('AdminStudents states', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows an error state (not "Sin alumnos") and recovers on retry', async () => {
    mockedStudents
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ data: { results: [], count: 0 } } as never);

    renderWithProviders(<AdminStudents />, { route: '/admin/alumnos' });

    expect(await screen.findByText('No se pudo cargar la información')).toBeInTheDocument();
    expect(screen.queryByText('Sin alumnos')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    expect(await screen.findByText('Sin alumnos')).toBeInTheDocument();
    expect(screen.queryByText('No se pudo cargar la información')).toBeNull();
    expect(mockedStudents).toHaveBeenCalledTimes(2);
  });
});

describe('AdminStudents URL-synced filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedStudents.mockResolvedValue({ data: { results: [], count: 0 } } as never);
  });

  it('writes the debounced search to the URL (?q=)', async () => {
    renderWithProviders(
      <>
        <AdminStudents />
        <LocationProbe />
      </>,
      { route: '/admin/alumnos' },
    );

    await userEvent.type(screen.getByLabelText('Buscar alumnos'), 'ana');

    // Debounced (300 ms): the URL catches up once, not per keystroke.
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/admin/alumnos?q=ana'));
    await waitFor(() =>
      expect(mockedStudents).toHaveBeenCalledWith({ page: 1, q: 'ana' }));
  });

  it('mounting from a URL with filters restores the state', async () => {
    renderWithProviders(
      <>
        <AdminStudents />
        <LocationProbe />
      </>,
      { route: '/admin/alumnos?q=garcia&page=3' },
    );

    // Input restored from ?q=, and the query fires with the URL's filter+page.
    expect(screen.getByLabelText('Buscar alumnos')).toHaveValue('garcia');
    await waitFor(() =>
      expect(mockedStudents).toHaveBeenCalledWith({ page: 3, q: 'garcia' }));

    // Active-filter chip row appears with the search chip.
    expect(await screen.findByLabelText('Filtros activos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Quitar filtro: Búsqueda/ })).toBeInTheDocument();
  });

  it('clearing the chip removes the filter from the URL', async () => {
    renderWithProviders(
      <>
        <AdminStudents />
        <LocationProbe />
      </>,
      { route: '/admin/alumnos?q=garcia' },
    );

    await userEvent.click(
      await screen.findByRole('button', { name: /Quitar filtro: Búsqueda/ }));

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/admin\/alumnos$/));
    expect(screen.getByLabelText('Buscar alumnos')).toHaveValue('');
  });

  it('on 2xl screens a row click opens the detail pane instead of navigating (P1-B10)', async () => {
    const mql = window.matchMedia;
    window.matchMedia = ((q: string) => ({ ...mql(q), matches: q.includes('1536') })) as typeof window.matchMedia;
    const student = { id: 5, student_id: 'A-5', grade: '2° Primaria', group: 'A', status: 'active', user: { id: 9, first_name: 'Ana', last_name: 'López', full_name: 'Ana López', email: 'ana@x.mx' } };
    (portalApi.getStudents as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { results: [student], count: 1 } } as never);
    (portalApi.getStudent as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { ...student, guardians: [], allergies: '', medical_notes: '' } } as never);
    renderWithProviders(<AdminStudents />, { route: '/admin/alumnos' });
    const link = (await screen.findAllByRole('link', { name: 'Ana López' }))[0];
    await userEvent.setup().click(link);
    expect(await screen.findByRole('complementary', { name: 'Detalle del alumno' })).toBeInTheDocument();
    window.matchMedia = mql;
  });
});

const ana = {
  id: 5, student_id: '09932', loyverse_code: 'ci09932', grade: '1° Primaria', group: 'A', status: 'active', balance: '80.00',
  user: { id: 9, first_name: 'Ana', last_name: 'López', full_name: 'Ana López', email: 'ana@x.mx', last_login: null },
};
const beto = { ...ana, id: 6, student_id: '09933', loyverse_code: '09933', balance: '0.00', user: { ...ana.user, id: 10, first_name: 'Beto', full_name: 'Beto Ruiz' } };

describe('AdminStudents on DataTable v2 (Data Ops Phase 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    stubViewport(1280);
    mockedStudents.mockResolvedValue({ data: { count: 2, next: null, previous: null, results: [ana, beto] } } as never);
  });

  it('maps the URL vocabulary onto the list contract and marks the sorted column', async () => {
    renderWithProviders(<AdminStudents />, {
      route: '/admin/alumnos?estado=on_leave&nivel=primaria&grado=1%C2%B0+Primaria&grupo=B&acceso=never&vinculado=0&orden=-balance&page=2',
    });
    expect(await screen.findByText('Ana López')).toBeInTheDocument();
    expect(mockedStudents).toHaveBeenCalledWith({
      page: 2, status: 'on_leave', level: 'primaria', grade: '1° Primaria', group: 'B', access: 'never', linked: '0', ordering: '-balance',
    });
    expect(screen.getByRole('columnheader', { name: 'Saldo' })).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByText('ci09932')).toBeInTheDocument();
    expect(screen.getByText('$80.00')).toBeInTheDocument();
    // Correo is hidden by default and comes back from the columns popover (prefs key `students`).
    expect(screen.queryByRole('columnheader', { name: 'Correo' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Columnas/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Correo' }));
    expect(screen.getByRole('columnheader', { name: 'Correo' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('interlaken:table:students') || '{}').hidden).not.toContain('email');
  });

  it('exports the current view and the selection', async () => {
    vi.mocked(portalApi.exportStudents).mockResolvedValue({ data: new Blob(['x']) } as never);
    renderWithProviders(<AdminStudents />, { route: '/admin/alumnos?q=lopez&estado=active&orden=name' });
    await screen.findByText('Ana López');
    await userEvent.click(screen.getByRole('button', { name: /^Exportar$/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Excel/ }));
    await waitFor(() => expect(portalApi.exportStudents).toHaveBeenCalledWith({ q: 'lopez', status: 'active', ordering: 'name', fmt: 'xlsx', ids: undefined }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toMatch(/^alumnos_\d{4}-\d{2}-\d{2}\.xlsx$/);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Beto Ruiz' }));
    await userEvent.click(screen.getByRole('button', { name: /Exportar seleccionados/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /PDF/ }));
    await waitFor(() => expect(portalApi.exportStudents).toHaveBeenLastCalledWith({ q: 'lopez', status: 'active', ordering: 'name', fmt: 'pdf', ids: '6' }));
  });

  it('keyboard-only: select, pick a status, see the wallet warning in the plan, confirm', async () => {
    const bulk = vi.mocked(portalApi.studentsBulk);
    bulk.mockImplementation(async (body) => ({
      data: {
        action: 'status', requested: 2, ok: 2, failed: [], skipped: [], dry_run: !!body.dry_run,
        ...(body.dry_run ? { warnings: [{ id: 5, message: 'Ana López (09932) tiene $80.00 de saldo en cafetería.' }] } : {}),
      },
    }) as never);
    const user = userEvent.setup();
    renderWithProviders(<AdminStudents />, { route: '/admin/alumnos' });
    await screen.findByText('Ana López');

    screen.getByRole('checkbox', { name: 'Seleccionar todas las filas de esta página' }).focus();
    await user.keyboard(' ');
    const bar = await screen.findByRole('region', { name: 'Acciones en lote' });
    expect(bar).toHaveTextContent('2 alumnos seleccionados');
    expect(screen.getByRole('checkbox', { name: 'Seleccionar Ana López' }).closest('tr')).toHaveAttribute('aria-selected', 'true');

    within(bar).getByRole('button', { name: 'Cambiar estado' }).focus();
    await user.keyboard('{Enter}');
    const picker = await screen.findByRole('dialog');
    await user.selectOptions(within(picker).getByLabelText('Nuevo estado'), 'withdrawn');
    within(picker).getByRole('button', { name: 'Continuar' }).focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('list', { name: 'Avisos' })).toHaveTextContent('Ana López (09932) tiene $80.00');
    expect(bulk).toHaveBeenCalledWith({ action: 'status', ids: [5, 6], all_matching: false, filters: undefined, payload: { value: 'withdrawn' }, dry_run: true });
    const confirm = screen.getByRole('button', { name: /Baja definitiva.*\(2\)/ });
    await waitFor(() => expect(confirm).toHaveFocus());
    await user.keyboard('{Enter}');
    await waitFor(() => expect(bulk).toHaveBeenLastCalledWith({ action: 'status', ids: [5, 6], all_matching: false, filters: undefined, payload: { value: 'withdrawn' }, dry_run: false }));
    expect(await screen.findByText(/procesados/)).toBeInTheDocument();
  });

  it('opens the generic ImportDialog with the students template', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: new Blob(['x']) } as never);
    renderWithProviders(<AdminStudents />, { route: '/admin/alumnos' });
    await screen.findByText('Ana López');
    await userEvent.click(screen.getByRole('button', { name: /Más acciones/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Importar archivo/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Importar alumnos' });
    await userEvent.click(within(dialog).getByRole('button', { name: /plantilla Excel/ }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/accounts/admin/students/import/template/', { params: { fmt: 'xlsx' }, responseType: 'blob' }));
  });
});
