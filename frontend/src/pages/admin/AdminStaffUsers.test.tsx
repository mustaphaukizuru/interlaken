import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-hot-toast', () => ({ default: { loading: vi.fn(() => 't1'), success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  portalApi: {
    listStaff: vi.fn(),
    exportStaff: vi.fn(),
    staffBulk: vi.fn(),
    updateStaff: vi.fn(),
    resetStaffPassword: vi.fn(),
    inviteStaff: vi.fn(),
  },
  downloadBlob: vi.fn(),
}));
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: { user: { id: number } }) => unknown) => sel({ user: { id: 1 } }),
}));

import { portalApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';
import AdminStaffUsers from './AdminStaffUsers';

const me = { id: 1, email: 'yo@x.mx', first_name: 'Yo', last_name: 'Admin', full_name: 'Yo Admin', role: 'admin', is_active: true, is_superuser: false, last_login: null, date_joined: '2026-01-01T00:00:00Z', has_password: true };
const berta = { ...me, id: 2, email: 'berta@x.mx', full_name: 'Berta Zea', role: 'staff' };
const carlos = { ...me, id: 3, email: 'carlos@x.mx', full_name: 'Carlos Alba', role: 'staff', is_active: false };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  stubViewport(1280);
  vi.mocked(portalApi.listStaff).mockResolvedValue({ data: { count: 3, next: null, previous: null, results: [me, berta, carlos] } } as never);
});

describe('AdminStaffUsers (Data Ops Phase 3)', () => {
  it('maps q, rol, activo and orden onto the list contract', async () => {
    renderWithProviders(<AdminStaffUsers />, { route: '/admin/usuarios?q=zea&rol=staff&activo=1&orden=-last_login&page=2' });
    expect(await screen.findByText('Berta Zea')).toBeInTheDocument();
    expect(portalApi.listStaff).toHaveBeenCalledWith({ page: 2, q: 'zea', role: 'staff', active: '1', ordering: '-last_login' });
    expect(screen.getByRole('columnheader', { name: 'Último acceso' })).toHaveAttribute('aria-sort', 'descending');
    // The acting admin gets no row actions and no editable role.
    expect(screen.queryByRole('combobox', { name: 'Rol de yo@x.mx' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Rol de berta@x.mx' })).toBeInTheDocument();
  });

  it('bulk deactivate runs the dry run, shows the skip reasons and commits', async () => {
    const bulk = vi.mocked(portalApi.staffBulk);
    bulk.mockImplementation(async (body) => ({
      data: {
        action: 'deactivate', requested: 3, ok: 1, failed: [], dry_run: !!body.dry_run,
        skipped: [{ id: 1, reason: 'No puede desactivar su propia cuenta.' }, { id: 3, reason: 'Ya está desactivada.' }],
      },
    }) as never);
    renderWithProviders(<AdminStaffUsers />, { route: '/admin/usuarios' });
    await screen.findByText('Berta Zea');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todas las filas de esta página' }));
    const bar = screen.getByRole('region', { name: 'Acciones en lote' });
    await userEvent.click(within(bar).getByRole('button', { name: 'Desactivar' }));
    const reasons = await screen.findByRole('list', { name: 'Motivos de omisión' });
    expect(reasons).toHaveTextContent('1 porque No puede desactivar su propia cuenta.');
    expect(bulk).toHaveBeenCalledWith(expect.objectContaining({ action: 'deactivate', ids: [1, 2, 3], dry_run: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar (1)' }));
    await waitFor(() => expect(bulk).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'deactivate', dry_run: false })));
  });

  it('exports and opens the invite-by-file dialog', async () => {
    vi.mocked(portalApi.exportStaff).mockResolvedValue({ data: new Blob(['x']) } as never);
    renderWithProviders(<AdminStaffUsers />, { route: '/admin/usuarios?activo=0' });
    await screen.findByText('Berta Zea');
    await userEvent.click(screen.getByRole('button', { name: /^Exportar$/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /CSV/ }));
    await waitFor(() => expect(portalApi.exportStaff).toHaveBeenCalledWith({ active: '0', fmt: 'csv', ids: undefined }));
    await userEvent.click(screen.getByRole('button', { name: /Importar/ }));
    expect(await screen.findByRole('dialog', { name: 'Invitar personal desde un archivo' })).toBeInTheDocument();
  });

  it('offers «Contraseña» for staff rows but never for another admin', async () => {
    const dora = { ...me, id: 4, email: 'dora@x.mx', full_name: 'Dora Paz', role: 'admin' };
    vi.mocked(portalApi.listStaff).mockResolvedValue({ data: { count: 3, next: null, previous: null, results: [me, berta, dora] } } as never);
    renderWithProviders(<AdminStaffUsers />, { route: '/admin/usuarios' });
    await screen.findByText('Dora Paz');
    expect(screen.getAllByRole('button', { name: 'Generar contraseña para berta@x.mx' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Generar contraseña para dora@x.mx' })).not.toBeInTheDocument();
    // Other row actions stay available on the admin row.
    expect(screen.getAllByRole('button', { name: 'Desactivar dora@x.mx' }).length).toBeGreaterThan(0);
  });
});

describe('AdminStaffUsers: puesto y áreas de la consola', () => {
  it('shows each account’s puesto and areas', async () => {
    vi.mocked(portalApi.listStaff).mockResolvedValue({ data: { count: 2, next: null, previous: null, results: [
      me, { ...berta, staff_title: 'Recepción', staff_areas: ['visitas', 'mensajes'] },
    ] } } as never);
    renderWithProviders(<AdminStaffUsers />, { route: '/admin/usuarios' });
    expect(await screen.findByText('Recepción')).toBeInTheDocument();
    expect(screen.getByText('Visitas y agenda')).toBeInTheDocument();
    expect(screen.getByText('Todas las áreas')).toBeInTheDocument(); // the admin row
  });

  it('invites a cafeteria cashier with only the Cafetería area', async () => {
    vi.mocked(portalApi.inviteStaff).mockResolvedValue({ data: { ...berta, id: 9, temporary_password: 'Tmp-123456' } } as never);
    renderWithProviders(<AdminStaffUsers />, { route: '/admin/usuarios' });
    await screen.findByText('Berta Zea');
    await userEvent.click(screen.getAllByRole('button', { name: /Invitar/ })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Invitar al personal' });
    await userEvent.type(within(dialog).getByLabelText('Correo'), 'caja@x.mx');
    await userEvent.type(within(dialog).getByLabelText('Nombre'), 'Caja');
    // Secretaría is the default puesto; switch to Cafetería.
    expect(within(dialog).getByLabelText('Admisiones')).toBeChecked();
    await userEvent.selectOptions(within(dialog).getByLabelText('Puesto'), 'cafeteria');
    expect(within(dialog).getByLabelText('Admisiones')).not.toBeChecked();
    expect(within(dialog).getByLabelText('Cafetería y pagos')).toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: /Crear cuenta/ }));
    await waitFor(() => expect(portalApi.inviteStaff).toHaveBeenCalledWith(expect.objectContaining({
      email: 'caja@x.mx', role: 'staff', staff_title: 'Cafetería', staff_areas: ['cafeteria'],
    })));
  });

  it('edits the areas of a staff account from «Acceso»', async () => {
    vi.mocked(portalApi.updateStaff).mockResolvedValue({ data: berta } as never);
    vi.mocked(portalApi.listStaff).mockResolvedValue({ data: { count: 2, next: null, previous: null, results: [
      me, { ...berta, staff_title: 'Recepción', staff_areas: ['visitas', 'mensajes'] },
    ] } } as never);
    renderWithProviders(<AdminStaffUsers />, { route: '/admin/usuarios' });
    await userEvent.click(await screen.findByRole('button', { name: 'Puesto y áreas de berta@x.mx' }));
    const dialog = await screen.findByRole('dialog', { name: 'Puesto y áreas de la consola' });
    expect(within(dialog).getByLabelText('Puesto')).toHaveValue('recepcion');
    await userEvent.click(within(dialog).getByLabelText('Comunicados y calendario'));
    expect(within(dialog).getByLabelText('Puesto')).toHaveValue('custom');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar acceso' }));
    await waitFor(() => expect(portalApi.updateStaff).toHaveBeenCalledWith(2, {
      staff_title: 'Recepción', staff_areas: ['visitas', 'mensajes', 'comunicados'],
    }));
  });
});
