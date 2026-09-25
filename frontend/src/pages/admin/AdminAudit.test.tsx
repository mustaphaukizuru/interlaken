import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-hot-toast', () => ({ default: { loading: vi.fn(() => 't1'), success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/api', async () => ({
  ...(await vi.importActual<typeof import('@/services/dataOps')>('@/services/dataOps')),
  downloadBlob: vi.fn(),
  coreApi: { getAuditLog: vi.fn(), exportAuditLog: vi.fn() },
}));

import { coreApi, downloadBlob } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';
import AdminAudit from './AdminAudit';

const getAuditLog = vi.mocked(coreApi.getAuditLog);
const exportAuditLog = vi.mocked(coreApi.exportAuditLog);

const entries = [
  { id: 1, actor: 1, actor_label: 'ana@x.mx', action: 'update', action_display: 'Modificación', object_type: 'StudentProfile', object_id: '9', changes: { grade: ['1°', '2°'] }, context: 'import:students', created_at: '2026-09-20T10:00:00Z' },
  { id: 2, actor: null, actor_label: '', action: 'create', action_display: 'Creación', object_type: 'Payment', object_id: '4', changes: {}, context: '', created_at: '2026-09-21T10:00:00Z' },
  { id: 3, actor: 9, actor_label: 'ada@interlaken.mx', action: 'update', action_display: 'Modificación', object_type: 'cafeteria.balanceadjustment', object_id: '42', changes: { reason: 'Pago en caja', amount: '150.00' }, context: 'cafeteria.adjust', created_at: '2026-08-14T10:30:00Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  stubViewport(1280);
  getAuditLog.mockResolvedValue({ data: { count: 42, next: null, previous: null, results: entries } } as never);
  exportAuditLog.mockResolvedValue({ data: new Blob(['x']) } as never);
});

describe('AdminAudit (reference page)', () => {
  it('renders audit rows with actor, action, context and the reason-first change summary', async () => {
    renderWithProviders(<AdminAudit />, { route: '/admin/auditoria' });
    expect(await screen.findByText('ada@interlaken.mx')).toBeInTheDocument();
    expect(screen.getByText('system')).toBeInTheDocument();
    expect(screen.getByText('cafeteria.adjust')).toBeInTheDocument();
    expect(screen.getByText(/Motivo: Pago en caja · amount: 150.00/)).toBeInTheDocument();
    expect(screen.getByText('cafeteria.balanceadjustment#42')).toBeInTheDocument();
    expect(getAuditLog).toHaveBeenCalledWith({ page: 1, actor: undefined, action: undefined, from: undefined, to: undefined, ordering: undefined });
  });

  it('shows the empty state, and "Sin resultados" when filters are active', async () => {
    getAuditLog.mockResolvedValue({ data: { results: [], count: 0 } } as never);
    const { unmount } = renderWithProviders(<AdminAudit />, { route: '/admin/auditoria' });
    expect(await screen.findByText('Sin registros de auditoría')).toBeInTheDocument();
    unmount();
    renderWithProviders(<AdminAudit />, { route: '/admin/auditoria?actor=ada&desde=2026-08-01' });
    expect(await screen.findByText('Sin resultados')).toBeInTheDocument();
    // The toolbar stays usable in the empty state so the filters can be changed.
    expect(screen.getByRole('textbox', { name: 'Buscar por actor' })).toHaveValue('ada');
  });

  it('maps the URL filters and sort onto the list request and renders the rows', async () => {
    renderWithProviders(<AdminAudit />, { route: '/admin/auditoria?actor=ana&accion=update&desde=2026-09-01&hasta=2026-09-24&orden=-date&page=2' });
    expect(await screen.findByText('ana@x.mx')).toBeInTheDocument();
    expect(screen.getByText('system')).toBeInTheDocument();
    expect(screen.getByText('StudentProfile#9')).toBeInTheDocument();
    expect(getAuditLog).toHaveBeenCalledWith({ page: 2, actor: 'ana', action: 'update', from: '2026-09-01', to: '2026-09-24', ordering: '-date' });
    expect(screen.getByRole('columnheader', { name: 'Fecha' })).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('tab', { name: 'Modificación' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Quitar filtro: Actor: “ana”' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Columnas/ })).toBeInTheDocument();
  });

  it('exports the current view through the audit export endpoint (CSV and Excel only)', async () => {
    renderWithProviders(<AdminAudit />, { route: '/admin/auditoria?accion=create&orden=actor' });
    await screen.findByText('ana@x.mx');
    await userEvent.click(screen.getByRole('button', { name: /^Exportar$/ }));
    expect(screen.queryByRole('menuitem', { name: /PDF/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: /Excel/ }));
    await waitFor(() => expect(exportAuditLog).toHaveBeenCalledWith({ action: 'create', ordering: 'actor', fmt: 'xlsx' }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toMatch(/^auditoria_\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it('sorting a column writes ?orden= and resets the page', async () => {
    renderWithProviders(<AdminAudit />, { route: '/admin/auditoria?page=3' });
    await screen.findByText('ana@x.mx');
    await userEvent.click(screen.getByRole('button', { name: 'Actor' }));
    await waitFor(() => expect(getAuditLog).toHaveBeenLastCalledWith({ page: 1, ordering: '-actor' }));
  });
});
