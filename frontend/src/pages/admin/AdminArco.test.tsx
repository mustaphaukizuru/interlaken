import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-hot-toast', () => ({ default: { loading: vi.fn(() => 't1'), success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/api', async () => ({
  ...(await vi.importActual<typeof import('@/services/dataOps')>('@/services/dataOps')),
  downloadBlob: vi.fn(),
  legalApi: {
    adminListArco: vi.fn(),
    adminSetArcoStatus: vi.fn(),
    adminIntakeArco: vi.fn(),
    adminExportArco: vi.fn(),
    adminBulkArco: vi.fn(),
  },
}));

import { legalApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';
import AdminArco, { deadlineLabel } from './AdminArco';

const list = vi.mocked(legalApi.adminListArco);
const setStatus = vi.mocked(legalApi.adminSetArcoStatus);
const exportArco = vi.mocked(legalApi.adminExportArco);
const bulk = vi.mocked(legalApi.adminBulkArco);

const rows = [
  { id: 1, requester_email: 'a@x.mx', requester_name: 'Mamá López', channel: 'email', request_type: 'rectification', details: 'Teléfono', status: 'received', resolution_note: '', statutory_deadline: '2026-09-20', created_at: '2026-08-22T10:00:00Z', resolved_at: null, is_overdue: false, days_left: 12 },
  { id: 2, requester_email: 'b@x.mx', requester_name: '', channel: 'portal', request_type: 'access', details: '', status: 'in_review', resolution_note: '', statutory_deadline: '2026-08-01', created_at: '2026-07-01T10:00:00Z', resolved_at: null, is_overdue: true, days_left: -21 },
  { id: 3, requester_email: 'c@x.mx', requester_name: 'Carla', channel: 'whatsapp', request_type: 'opposition', details: '', status: 'resolved', resolution_note: 'Hecho', statutory_deadline: '2026-06-01', created_at: '2026-05-01T10:00:00Z', resolved_at: '2026-05-10T10:00:00Z', is_overdue: false, days_left: -100 },
];

beforeEach(() => {
  vi.clearAllMocks();
  stubViewport(1280);
  // overdue_count covers the whole filtered set, not just this page.
  list.mockResolvedValue({ data: { count: 45, next: 'p2', previous: null, results: rows, overdue_count: 7 } } as never);
  setStatus.mockResolvedValue({ data: {} } as never);
  exportArco.mockResolvedValue({ data: new Blob(['x']) } as never);
  bulk.mockImplementation(async (body) => ({
    data: { action: body.action, requested: body.ids.length, ok: 1, failed: [], skipped: body.ids.length > 1 ? [{ id: 2, reason: 'ya está en revisión' }] : [], dry_run: !!body.dry_run },
  }) as never);
});

describe('AdminArco', () => {
  it('deadlineLabel', () => {
    expect(deadlineLabel({ status: 'received', days_left: 3, is_overdue: false })).toBe('3 d restantes');
    expect(deadlineLabel({ status: 'in_review', days_left: -2, is_overdue: true })).toBe('Vencida hace 2 d');
    expect(deadlineLabel({ status: 'resolved', days_left: 0, is_overdue: false })).toBe('Cerrada');
  });

  it('defaults to the open queue; the overdue banner uses the server count for the whole set', async () => {
    renderWithProviders(<AdminArco />, { route: '/admin/arco' });
    expect(await screen.findByText('Mamá López')).toBeInTheDocument();
    expect(list).toHaveBeenLastCalledWith({ page: 1, q: undefined, status: 'open', type: undefined, overdue: undefined, from: undefined, to: undefined, ordering: undefined });
    expect(screen.getByRole('alert')).toHaveTextContent('7 solicitudes vencidas');
    expect(screen.getByText('Vencida hace 21 d')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Abiertas' })).toHaveAttribute('aria-selected', 'true');
  });

  it('maps URL filters and the deadline sort; the legacy ?status= still works', async () => {
    const { unmount } = renderWithProviders(<AdminArco />, { route: '/admin/arco?q=lopez&estado=all&tipo=access&vencidas=1&orden=deadline&page=2' });
    await screen.findByText('Mamá López');
    expect(list).toHaveBeenLastCalledWith({ page: 2, q: 'lopez', status: undefined, type: 'access', overdue: '1', from: undefined, to: undefined, ordering: 'deadline' });
    expect(screen.getByRole('columnheader', { name: 'Plazo' })).toHaveAttribute('aria-sort', 'ascending');
    unmount();
    renderWithProviders(<AdminArco />, { route: '/admin/arco?status=resolved' });
    await screen.findByText('Mamá López');
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'resolved' }));
  });

  it('shows the error state with a retry', async () => {
    list.mockRejectedValue(new Error('boom'));
    renderWithProviders(<AdminArco />, { route: '/admin/arco' });
    expect(await screen.findByRole('button', { name: /Reintentar/ })).toBeInTheDocument();
  });

  it('resolve needs a note; reopening a closed request asks for a reason', async () => {
    renderWithProviders(<AdminArco />, { route: '/admin/arco' });
    await screen.findByText('Mamá López');
    await userEvent.click(screen.getAllByRole('button', { name: 'Resolver' })[0]);
    let dialog = await screen.findByRole('dialog', { name: 'Resolver solicitud' });
    const confirm = within(dialog).getByRole('button', { name: 'Confirmar' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Qué se hizo (obligatorio)'), 'Teléfono actualizado');
    await userEvent.click(confirm);
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith(1, 'resolved', 'Teléfono actualizado'));

    await userEvent.click(screen.getByRole('button', { name: /Reabrir/ }));
    dialog = await screen.findByRole('dialog', { name: 'Reabrir solicitud' });
    expect(within(dialog).getByRole('button', { name: 'Confirmar' })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Motivo de la reapertura (obligatorio)'), 'Nuevos documentos');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(setStatus).toHaveBeenLastCalledWith(3, 'in_review', 'Nuevos documentos'));
  });

  it('bulk "Marcar en revisión" runs a dry-run plan first, then commits', async () => {
    renderWithProviders(<AdminArco />, { route: '/admin/arco' });
    await screen.findByText('Mamá López');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar solicitud 1 de Mamá López' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar solicitud 2 de b@x.mx' }));
    const bar = await screen.findByRole('region', { name: 'Acciones en lote' });
    await userEvent.click(within(bar).getByRole('button', { name: /Marcar en revisión/ }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(bulk).toHaveBeenCalledWith({ action: 'in_review', ids: [1, 2], all_matching: false, filters: undefined, dry_run: true }));
    expect(await within(dialog).findByText(/1 porque ya está en revisión/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Marcar en revisión (1)' }));
    await waitFor(() => expect(bulk).toHaveBeenLastCalledWith({ action: 'in_review', ids: [1, 2], all_matching: false, filters: undefined, payload: {}, dry_run: false }));
  });

  it('exports the current view with the same filters', async () => {
    renderWithProviders(<AdminArco />, { route: '/admin/arco?tipo=access' });
    await screen.findByText('Mamá López');
    await userEvent.click(screen.getByRole('button', { name: /^Exportar$/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /PDF/ }));
    await waitFor(() => expect(exportArco).toHaveBeenCalledWith({
      q: undefined, status: 'open', type: 'access', overdue: undefined, from: undefined, to: undefined, ordering: undefined, fmt: 'pdf', ids: undefined,
    }));
  });
});
