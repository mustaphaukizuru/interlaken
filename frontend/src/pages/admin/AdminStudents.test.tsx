import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { loading: vi.fn(() => 't1'), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }) }));
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
import { useAuthStore } from '@/store/authStore';
import toast from 'react-hot-toast';

const mockedStudents = vi.mocked(portalApi.getStudents);

/** Exposes the router's current URL so tests can assert on filter sync. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

describe('AdminStudents states', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows an error state (not "Sin alumnos") and recovers on retry', async () => {
    // The leavers notice and the Archivados count run their own queries: only the roster itself fails here.
    let roster = 0;
    mockedStudents.mockImplementation(async (params) => {
      if (params?.linked === 'missing' || params?.archived === '1') return { data: { results: [], count: 0 } } as never;
      roster += 1;
      if (roster === 1) throw new Error('network down');
      return { data: { results: [], count: 0 } } as never;
    });

    renderWithProviders(<AdminStudents />, { route: '/admin/alumnos' });

    expect(await screen.findByText('No se pudo cargar la información')).toBeInTheDocument();
    expect(screen.queryByText('Sin alumnos')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    expect(await screen.findByText('Sin alumnos')).toBeInTheDocument();
    expect(screen.queryByText('No se pudo cargar la información')).toBeNull();
    expect(roster).toBe(2);
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
      expect(mockedStudents).toHaveBeenCalledWith({ page: 1, q: 'ana', status: 'active' }));
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
      expect(mockedStudents).toHaveBeenCalledWith({ page: 3, q: 'garcia', status: 'active' }));

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
    // A destructive action opens on Cancelar, so a stray Enter never confirms it.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus());
    const confirm = screen.getByRole('button', { name: /Baja definitiva.*\(2\)/ });
    confirm.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(bulk).toHaveBeenLastCalledWith({ action: 'status', ids: [5, 6], all_matching: false, filters: undefined, payload: { value: 'withdrawn' }, dry_run: false }));
    expect(await screen.findByText(/procesados/)).toBeInTheDocument();
  });

  describe('archiving and removing students', () => {
    const asRole = (role: 'admin' | 'staff') => useAuthStore.setState({ user: { id: 1, email: 'x@x.mx', role, staff_areas: ['alumnos'] } as never });
    const roster = ({ leavers = 0, archived = 0 } = {}) => mockedStudents.mockImplementation(async (params) => {
      if (params?.linked === 'missing') return { data: { count: leavers, next: null, previous: null, results: leavers ? [ana, beto] : [] } } as never;
      if (params?.archived === '1') return { data: { count: archived, next: null, previous: null, results: archived ? [{ ...beto, archived_at: '2026-11-08T10:00:00Z', status: 'withdrawn', is_active: false }] : [] } } as never;
      return { data: { count: 2, next: null, previous: null, results: [ana, beto] } } as never;
    });
    const bulk = () => vi.mocked(portalApi.studentsBulk);
    const respond = (outcomes: Record<string, number>) => bulk().mockImplementation(async (body) => {
      const total = Object.values(outcomes).reduce((a, b) => a + b, 0);
      return { data: { action: body.action, requested: total, ok: total, failed: [], skipped: [], dry_run: !!body.dry_run, outcomes } } as never;
    });

    beforeEach(() => asRole('admin'));

    it('opens on the active students and keeps that URL clean', async () => {
      roster();
      renderWithProviders(<><AdminStudents /><LocationProbe /></>, { route: '/admin/alumnos' });
      await screen.findByText('Ana López');
      expect(mockedStudents).toHaveBeenCalledWith({ page: 1, status: 'active' });
      expect(screen.getByRole('tab', { name: 'Activo' })).toHaveAttribute('aria-selected', 'true');

      await userEvent.click(screen.getByRole('tab', { name: 'Todos' }));
      await waitFor(() => expect(mockedStudents).toHaveBeenLastCalledWith({ page: 1 }));
      await userEvent.click(screen.getByRole('tab', { name: 'Activo' }));
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/admin\/alumnos$/));
    });

    it('the Archivados tab shows its count and lists only archived students, with Restaurar', async () => {
      roster({ archived: 1 });
      const user = userEvent.setup();
      renderWithProviders(<AdminStudents />, { route: '/admin/alumnos' });
      const tab = await screen.findByRole('tab', { name: /Archivados/ });
      await waitFor(() => expect(tab).toHaveTextContent('1'));

      await user.click(tab);
      await waitFor(() => expect(mockedStudents).toHaveBeenCalledWith({ page: 1, archived: '1' }));
      expect(await screen.findByText('Archivado')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Más acciones para Beto Ruiz' }));
      expect(screen.getByRole('menuitem', { name: 'Restaurar' })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Archivar' })).toBeNull();
    });

    it('the notice leads to the leavers, and Eliminar says how many are erased and how many archived', async () => {
      roster({ leavers: 35 });
      respond({ erased: 16, archived: 19 });
      const user = userEvent.setup();
      renderWithProviders(<><AdminStudents /><LocationProbe /></>, { route: '/admin/alumnos' });

      await user.click(await screen.findByRole('link', { name: /35 alumnos.*ya no tienen cliente en Loyverse/ }));
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('vinculado=missing'));
      await user.click(await screen.findByRole('button', { name: /Seleccionar los 35/ }));
      const bar = await screen.findByRole('region', { name: 'Acciones en lote' });
      await user.click(within(bar).getByRole('button', { name: 'Eliminar' }));

      const dialog = await screen.findByRole('dialog', { name: /Eliminar/ });
      const plan = await within(dialog).findByRole('list', { name: 'Resultado de eliminar' });
      expect(plan).toHaveTextContent('16 se eliminarán por completo');
      expect(plan).toHaveTextContent('19 se archivarán');
      expect(bulk()).toHaveBeenCalledWith(expect.objectContaining({
        action: 'delete', all_matching: true, dry_run: true, filters: expect.objectContaining({ linked: 'missing', status: 'active' }),
      }));
      // Opens on Cancelar; the coral button runs it, sending the confirmation itself.
      expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
      await user.click(within(dialog).getByRole('button', { name: /Eliminar \(35\)/ }));
      await waitFor(() => expect(bulk()).toHaveBeenLastCalledWith(expect.objectContaining({
        action: 'delete', dry_run: false, payload: { confirm: 'ELIMINAR' },
      })));
    });

    it('archives one row from its menu and offers to undo it', async () => {
      roster();
      respond({ archived: 1 });
      const user = userEvent.setup();
      renderWithProviders(<AdminStudents />, { route: '/admin/alumnos' });
      await screen.findByText('Ana López');

      await user.click(screen.getByRole('button', { name: 'Más acciones para Ana López' }));
      await user.click(screen.getByRole('menuitem', { name: 'Archivar' }));
      const dialog = await screen.findByRole('dialog', { name: 'Archivar: Ana López' });
      expect(await within(dialog).findByText(/Salen de todas las listas/)).toBeInTheDocument();
      expect(bulk()).toHaveBeenCalledWith({ action: 'archive', ids: [5], all_matching: false, filters: undefined, dry_run: true });

      await user.click(within(dialog).getByRole('button', { name: /Archivar \(1\)/ }));
      await waitFor(() => expect(bulk()).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'archive', ids: [5], dry_run: false })));
      await waitFor(() => expect(vi.mocked(toast)).toHaveBeenCalled());

      // «Deshacer» puts back the status they had, not «Baja definitiva» (launch review).
      respond({ restored: 1 });
      const toastBody = vi.mocked(toast).mock.lastCall![0] as unknown as (t: { id: string }) => Parameters<typeof renderWithProviders>[0];
      renderWithProviders(toastBody({ id: 't-undo' }));
      await user.click(screen.getByRole('button', { name: 'Deshacer' }));
      await waitFor(() => expect(bulk()).toHaveBeenLastCalledWith({ action: 'restore', ids: [5], all_matching: false, payload: { undo: true }, dry_run: false }));
    });

    it('shows the Cafetería shortcut only to who may open the cafetería', async () => {
      roster();
      asRole('staff'); // alumnos only: the link used to bounce silently
      const first = renderWithProviders(<AdminStudents />, { route: '/admin/alumnos' });
      await screen.findByText('Ana López');
      expect(screen.queryByRole('link', { name: 'Cafetería de Ana López' })).toBeNull();
      first.unmount();

      asRole('admin');
      renderWithProviders(<AdminStudents />, { route: '/admin/alumnos' });
      expect(await screen.findByRole('link', { name: 'Cafetería de Ana López' })).toBeInTheDocument();
    });

    it('on a phone the row actions are plain buttons named after the student', async () => {
      stubViewport(390);
      roster();
      renderWithProviders(<AdminStudents />, { route: '/admin/alumnos' });
      await screen.findByText('Ana López');
      // Below lg the table folds the row's actions into one «Acciones» popover.
      await userEvent.click(screen.getByRole('button', { name: /Acciones de Ana López/ }));
      expect(await screen.findByRole('button', { name: 'Archivar a Ana López' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Eliminar a Ana López' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Más acciones para Ana López' })).toBeNull();
      stubViewport(1280);
    });

    it('a staff account can archive but is not offered the delete', async () => {
      asRole('staff');
      roster();
      const user = userEvent.setup();
      renderWithProviders(<AdminStudents />, { route: '/admin/alumnos' });
      await screen.findByText('Ana López');

      await user.click(screen.getByRole('button', { name: 'Más acciones para Ana López' }));
      expect(screen.getByRole('menuitem', { name: 'Archivar' })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Eliminar' })).toBeNull();
      await user.keyboard('{Escape}');

      await user.click(screen.getByRole('checkbox', { name: 'Seleccionar Ana López' }));
      const bar = await screen.findByRole('region', { name: 'Acciones en lote' });
      expect(within(bar).getByRole('button', { name: 'Archivar' })).toBeInTheDocument();
      expect(within(bar).queryByRole('button', { name: 'Eliminar' })).toBeNull();
    });

    it('flags a student whose customer is gone', async () => {
      mockedStudents.mockResolvedValue({ data: { count: 1, next: null, previous: null, results: [{ ...ana, loyverse_missing_since: '2026-09-23T00:00:00Z' }] } } as never);
      renderWithProviders(<AdminStudents />, { route: '/admin/alumnos' });
      expect(await screen.findByText('Sin cliente en Loyverse')).toBeInTheDocument();
    });
  });

  it('opens the generic ImportDialog with the students template', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: new Blob(['x']) } as never);
    renderWithProviders(<AdminStudents />, { route: '/admin/alumnos' });
    await screen.findByText('Ana López');
    await userEvent.click(screen.getByRole('button', { name: 'Más acciones' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Importar archivo/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Importar alumnos' });
    await userEvent.click(within(dialog).getByRole('button', { name: /plantilla Excel/ }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/accounts/admin/students/import/template/', { params: { fmt: 'xlsx' }, responseType: 'blob' }));
  });
});

describe('AdminStudents · Familia column (hermanos)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the family as a link to Familias, and a dash without one', async () => {
    mockedStudents.mockResolvedValue({
      data: { count: 2, next: null, previous: null, results: [{ ...ana, family: { id: 3, name: 'Familia López' } }, { ...beto, family: null }] },
    } as never);
    renderWithProviders(<AdminStudents />, { route: '/admin/alumnos' });
    const link = await screen.findByRole('link', { name: 'Familia López' });
    expect(link).toHaveAttribute('href', '/admin/familias?q=Familia%20L%C3%B3pez');
    expect(screen.getAllByRole('columnheader', { name: /Familia/ }).length).toBeGreaterThan(0);
  });
});
