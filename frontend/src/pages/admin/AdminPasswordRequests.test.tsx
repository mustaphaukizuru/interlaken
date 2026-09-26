import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-hot-toast', () => ({ default: { loading: vi.fn(() => 't1'), success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/api', () => ({
  portalApi: {
    getPasswordRequests: vi.fn(),
    exportPasswordRequests: vi.fn(),
    passwordRequestsBulk: vi.fn(),
    updatePasswordRequest: vi.fn(),
    createPasswordRequest: vi.fn(),
  },
  downloadBlob: vi.fn(),
}));

import { portalApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';
import AdminPasswordRequests from './AdminPasswordRequests';

const base = { user: 7, user_name: 'Marta Ruiz', user_email: 'mama@x.mx', requested_email: 'mama@x.mx', requester_name: 'Marta', channel: 'whatsapp', note: '', status: 'open', created_by_name: '', created_at: '2026-09-20T10:00:00Z', resolved_by_name: '', resolved_at: null, delivered_via: '' };
const rows = [
  { ...base, id: 1 },
  { ...base, id: 2, user: null, user_name: '', user_email: '', requested_email: 'nadie@x.mx', requester_name: 'Nadie', channel: 'phone' },
];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  stubViewport(1280);
  vi.mocked(portalApi.getPasswordRequests).mockResolvedValue({ data: { count: 2, open_count: 2, next: null, previous: null, results: rows } } as never);
});

describe('AdminPasswordRequests (Data Ops Phase 3)', () => {
  it('defaults to the open inbox and keeps the status in the URL', async () => {
    renderWithProviders(<AdminPasswordRequests />, { route: '/admin/contrasenas' });
    expect(await screen.findByText('Marta Ruiz')).toBeInTheDocument();
    expect(portalApi.getPasswordRequests).toHaveBeenCalledWith({ page: 1, status: 'open' });
    expect(screen.getByRole('tab', { name: /Pendientes/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Pendientes/ })).toHaveTextContent('2');
    await userEvent.click(screen.getByRole('tab', { name: 'Todas' }));
    await waitFor(() => expect(portalApi.getPasswordRequests).toHaveBeenLastCalledWith({ page: 1 }));
  });

  it('maps search, canal, dates and orden', async () => {
    renderWithProviders(<AdminPasswordRequests />, { route: '/admin/contrasenas?estado=rejected&q=marta&canal=phone&desde=2026-09-01&hasta=2026-09-30&orden=requested_email' });
    await screen.findByText('Marta Ruiz');
    expect(portalApi.getPasswordRequests).toHaveBeenCalledWith({
      page: 1, q: 'marta', status: 'rejected', channel: 'phone', from: '2026-09-01', to: '2026-09-30', ordering: 'requested_email',
    });
  });

  it('bulk reject needs a note and sends it in the payload', async () => {
    const bulk = vi.mocked(portalApi.passwordRequestsBulk);
    bulk.mockImplementation(async (body) => ({ data: { action: 'reject', requested: 2, ok: 2, failed: [], skipped: [], dry_run: !!body.dry_run } }) as never);
    renderWithProviders(<AdminPasswordRequests />, { route: '/admin/contrasenas' });
    await screen.findByText('Marta Ruiz');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todas las filas de esta página' }));
    await userEvent.click(within(screen.getByRole('region', { name: 'Acciones en lote' })).getByRole('button', { name: 'Rechazar' }));
    const confirm = await screen.findByRole('button', { name: 'Rechazar (2)' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Motivo (obligatorio)'), 'No identificado');
    await userEvent.click(confirm);
    await waitFor(() => expect(bulk).toHaveBeenLastCalledWith({ action: 'reject', ids: [1, 2], all_matching: false, filters: undefined, payload: { note: 'No identificado' }, dry_run: false }));
  });

  it('exports the current view', async () => {
    vi.mocked(portalApi.exportPasswordRequests).mockResolvedValue({ data: new Blob(['x']) } as never);
    renderWithProviders(<AdminPasswordRequests />, { route: '/admin/contrasenas?estado=todas&canal=email' });
    await screen.findByText('Marta Ruiz');
    await userEvent.click(screen.getByRole('button', { name: /^Exportar$/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Excel/ }));
    await waitFor(() => expect(portalApi.exportPasswordRequests).toHaveBeenCalledWith({ channel: 'email', fmt: 'xlsx', ids: undefined }));
  });
});
