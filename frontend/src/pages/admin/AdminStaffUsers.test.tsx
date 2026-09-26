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
});
