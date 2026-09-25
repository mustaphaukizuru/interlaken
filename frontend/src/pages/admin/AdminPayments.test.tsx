import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-hot-toast', () => ({ default: { loading: vi.fn(() => 't1'), success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/api', async () => ({
  ...(await vi.importActual<typeof import('@/services/dataOps')>('@/services/dataOps')),
  downloadBlob: vi.fn(),
  paymentsApi: { adminList: vi.fn(), adminSummary: vi.fn(), adminExport: vi.fn() },
}));

import { paymentsApi, downloadBlob } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';
import AdminPayments from './AdminPayments';

const adminList = vi.mocked(paymentsApi.adminList);
const adminSummary = vi.mocked(paymentsApi.adminSummary);
const adminExport = vi.mocked(paymentsApi.adminExport);

const payments = [
  { id: 11, payment_type: 'cafeteria', amount: '150.00', currency: 'MXN', description: 'Ana Tutor', status: 'success', gateway: 'banorte', gateway_label: 'Banorte', gateway_tx_id: 'TX-1', student_id: 5, student_name: 'Emma Quintana', created_at: '2026-09-20T10:00:00Z', updated_at: '2026-09-20T10:00:00Z' },
  { id: 12, payment_type: 'cafeteria', amount: '80.00', currency: 'MXN', description: '', status: 'failed', gateway: 'global_payments', gateway_tx_id: '', student_id: null, created_at: '2026-09-21T10:00:00Z', updated_at: '2026-09-21T10:00:00Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  stubViewport(1280);
  adminList.mockResolvedValue({ data: { count: 2, next: null, previous: null, results: payments } } as never);
  adminSummary.mockResolvedValue({ data: { days: 30, since: '2026-08-22', by_status: { success: { count: 1, total: '150.00' } }, stuck_pending: 0, series: [] } } as never);
  adminExport.mockResolvedValue({ data: new Blob(['x']) } as never);
});

const ROUTE = '/admin/pagos?q=ana&estado=success&pasarela=banorte&alumno=5&desde=2026-09-01&hasta=2026-09-24&orden=-amount&page=2';

describe('AdminPayments (reference page)', () => {
  it('maps q, estado, pasarela, alumno, desde, hasta and orden onto the admin list request', async () => {
    renderWithProviders(<AdminPayments />, { route: ROUTE });
    expect(await screen.findByText('Emma Quintana')).toBeInTheDocument();
    expect(adminList).toHaveBeenCalledWith({
      page: 2, q: 'ana', status: 'success', gateway: 'banorte', student: '5', from: '2026-09-01', to: '2026-09-24', ordering: '-amount',
    });
    expect(screen.getByRole('columnheader', { name: 'Monto' })).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('button', { name: 'Quitar filtro: Alumno: 5' })).toBeInTheDocument();
    // "Referencia" is hidden by default and reachable from the columns popover.
    expect(screen.queryByRole('columnheader', { name: 'Referencia' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Columnas/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Referencia' }));
    expect(screen.getByRole('columnheader', { name: 'Referencia' })).toBeInTheDocument();
    expect(screen.getByText('TX-1')).toBeInTheDocument();
  });

  it('exports the current view through GET /payments/admin/export/ with the same filters', async () => {
    renderWithProviders(<AdminPayments />, { route: ROUTE });
    await screen.findByText('Emma Quintana');
    await userEvent.click(screen.getByRole('button', { name: /^Exportar$/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /PDF/ }));
    await waitFor(() => expect(adminExport).toHaveBeenCalledWith({
      q: 'ana', status: 'success', gateway: 'banorte', student: '5', from: '2026-09-01', to: '2026-09-24', ordering: '-amount', fmt: 'pdf', ids: undefined,
    }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toMatch(/^pagos_\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it('selecting rows shows the bulk bar and "Exportar seleccionados" sends ids=', async () => {
    renderWithProviders(<AdminPayments />, { route: '/admin/pagos' });
    await screen.findByText('Emma Quintana');
    expect(screen.queryByRole('region', { name: 'Acciones en lote' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar pago 11 de Emma Quintana' }));
    const bar = await screen.findByRole('region', { name: 'Acciones en lote' });
    expect(bar).toHaveTextContent('1 pago seleccionada');
    await userEvent.click(screen.getByRole('button', { name: /Exportar seleccionados/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /CSV/ }));
    await waitFor(() => expect(adminExport).toHaveBeenCalledWith({ fmt: 'csv', ids: '11' }));
  });

  it('"select all matching" exports the whole view instead of ids', async () => {
    adminList.mockResolvedValue({ data: { count: 250, next: 'p2', previous: null, results: payments } } as never);
    renderWithProviders(<AdminPayments />, { route: '/admin/pagos?estado=failed' });
    await screen.findByText('Emma Quintana');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todas las filas de esta página' }));
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar las 250 que coinciden' }));
    expect(screen.getByRole('region', { name: 'Acciones en lote' })).toHaveTextContent('250 pagos que coinciden con los filtros seleccionadas');
    await userEvent.click(screen.getByRole('button', { name: /Exportar seleccionados/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Excel/ }));
    await waitFor(() => expect(adminExport).toHaveBeenCalledWith({ status: 'failed', fmt: 'xlsx', ids: undefined }));
  });
});
