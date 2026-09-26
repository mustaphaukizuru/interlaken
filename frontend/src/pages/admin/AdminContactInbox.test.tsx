import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-hot-toast', () => ({ default: { loading: vi.fn(() => 't1'), success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/api', async () => ({
  ...(await vi.importActual<typeof import('@/services/dataOps')>('@/services/dataOps')),
  downloadBlob: vi.fn(),
  coreApi: {
    getContactMessages: vi.fn(),
    setContactHandled: vi.fn(),
    exportContactMessages: vi.fn(),
    bulkContactMessages: vi.fn(),
  },
}));

import { coreApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';
import AdminContactInbox from './AdminContactInbox';

const list = vi.mocked(coreApi.getContactMessages);
const toggle = vi.mocked(coreApi.setContactHandled);
const exportMessages = vi.mocked(coreApi.exportContactMessages);
const bulk = vi.mocked(coreApi.bulkContactMessages);

const messages = [
  { id: 1, name: 'Ana Ruiz', email: 'ana@x.mx', subject: 'Informes de primaria', message: 'Quisiera informes\nGracias', is_handled: false, created_at: '2026-09-20T10:00:00Z' },
  { id: 2, name: 'Beto Gil', email: 'beto@x.mx', subject: '[Facturación] RFC GIBE800101', message: 'Factura de septiembre', is_handled: false, created_at: '2026-09-21T10:00:00Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  stubViewport(1280);
  list.mockResolvedValue({ data: { count: 2, next: null, previous: null, results: messages } } as never);
  toggle.mockResolvedValue({ data: { ...messages[0], is_handled: true } } as never);
  exportMessages.mockResolvedValue({ data: new Blob(['x']) } as never);
  bulk.mockImplementation(async (body) => ({
    data: { action: body.action, requested: body.ids.length, ok: body.ids.length, failed: [], skipped: [], dry_run: !!body.dry_run },
  }) as never);
});

describe('AdminContactInbox', () => {
  it('defaults to the pending queue and maps URL filters and sort onto the list request', async () => {
    renderWithProviders(<AdminContactInbox />, { route: '/admin/mensajes' });
    expect(await screen.findByText('Informes de primaria')).toBeInTheDocument();
    expect(list).toHaveBeenLastCalledWith({ page: 1, q: undefined, handled: '0', from: undefined, to: undefined, ordering: undefined });
    expect(screen.getByText('Factura')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pendientes' })).toHaveAttribute('aria-selected', 'true');
  });

  it('reads q, estado, dates and orden from the URL', async () => {
    renderWithProviders(<AdminContactInbox />, { route: '/admin/mensajes?q=rfc&estado=all&desde=2026-09-01&hasta=2026-09-30&orden=-name&page=2' });
    await screen.findByText('Informes de primaria');
    expect(list).toHaveBeenLastCalledWith({ page: 2, q: 'rfc', handled: undefined, from: '2026-09-01', to: '2026-09-30', ordering: '-name' });
    expect(screen.getByRole('columnheader', { name: 'Nombre' })).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('tab', { name: 'Todos' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the error state with a retry', async () => {
    list.mockRejectedValue(new Error('boom'));
    renderWithProviders(<AdminContactInbox />, { route: '/admin/mensajes' });
    expect(await screen.findByRole('button', { name: /Reintentar/ })).toBeInTheDocument();
  });

  it('toggles one message and opens the message drawer on row click', async () => {
    renderWithProviders(<AdminContactInbox />, { route: '/admin/mensajes' });
    await screen.findByText('Informes de primaria');
    await userEvent.click(screen.getByRole('button', { name: 'Marcar atendido el mensaje de Ana Ruiz' }));
    await waitFor(() => expect(toggle).toHaveBeenCalledWith(1, true));

    await userEvent.click(screen.getByText('Factura de septiembre'));
    const dialog = await screen.findByRole('dialog', { name: '[Facturación] RFC GIBE800101' });
    expect(within(dialog).getByText('beto@x.mx')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /Responder por correo/ })).toHaveAttribute(
      'href',
      `mailto:beto@x.mx?subject=${encodeURIComponent('Re: [Facturación] RFC GIBE800101')}`,
    );
  });

  it('keyboard only: select a row, open the bulk action, confirm the dry-run plan', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminContactInbox />, { route: '/admin/mensajes' });
    await screen.findByText('Informes de primaria');
    const checkbox = screen.getByRole('checkbox', { name: 'Seleccionar mensaje de Ana Ruiz: Informes de primaria' });
    checkbox.focus();
    await user.keyboard(' ');
    expect(checkbox).toBeChecked();
    const bar = await screen.findByRole('region', { name: 'Acciones en lote' });
    expect(bar).toHaveTextContent('1 mensaje seleccionado');
    within(bar).getByRole('button', { name: /Marcar atendidos/ }).focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(bulk).toHaveBeenCalledWith({ action: 'mark_handled', ids: [1], all_matching: false, filters: undefined, dry_run: true }));
    const confirm = await within(dialog).findByRole('button', { name: 'Marcar atendidos (1)' });
    await waitFor(() => expect(confirm).toHaveFocus());
    await user.keyboard('{Enter}');
    await waitFor(() => expect(bulk).toHaveBeenLastCalledWith({ action: 'mark_handled', ids: [1], all_matching: false, filters: undefined, payload: {}, dry_run: false }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('1 mensajes procesados');
  });

  it('"select all matching" sends the API filters to the bulk endpoint', async () => {
    list.mockResolvedValue({ data: { count: 60, next: 'p2', previous: null, results: messages } } as never);
    renderWithProviders(<AdminContactInbox />, { route: '/admin/mensajes?q=rfc' });
    await screen.findByText('Informes de primaria');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todas las filas de esta página' }));
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar las 60 que coinciden' }));
    await userEvent.click(within(screen.getByRole('region', { name: 'Acciones en lote' })).getByRole('button', { name: /Reabrir/ }));
    await waitFor(() => expect(bulk).toHaveBeenCalledWith({
      action: 'reopen', ids: [], all_matching: true, filters: { q: 'rfc', handled: '0', from: undefined, to: undefined }, dry_run: true,
    }));
  });

  it('exports the current view and the selection', async () => {
    renderWithProviders(<AdminContactInbox />, { route: '/admin/mensajes?estado=1' });
    await screen.findByText('Informes de primaria');
    await userEvent.click(screen.getByRole('button', { name: /^Exportar$/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Excel/ }));
    await waitFor(() => expect(exportMessages).toHaveBeenCalledWith({
      q: undefined, handled: '1', from: undefined, to: undefined, ordering: undefined, fmt: 'xlsx', ids: undefined,
    }));
  });
});
