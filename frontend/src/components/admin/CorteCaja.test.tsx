import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/caja', () => ({
  corteApi: { get: vi.fn(), people: vi.fn(), close: vi.fn(), reopen: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { CorteCaja } from './CorteCaja';
import { corteApi } from '@/services/caja';
import { renderWithProviders } from '@/test/renderWithProviders';

const api = vi.mocked(corteApi);
const row = (over: Record<string, unknown> = {}) => ({
  id: 1, folio: 'R-000001', time: '09:00', student: 'Ana Prueba', amount: '200.00', desk_method: 'cash',
  desk_method_label: 'Efectivo', reference: '', loaded: true, voided: false, void_reason: '', voided_by: '',
  needs_verification: false, ...over,
});
const summary = (over: Record<string, unknown> = {}) => ({
  day: '2026-11-27', user: { id: 3, name: 'Veronica Prueba' },
  expected: { cash: '200.00', card: '150.00', link: '0.00' }, expected_total: '350.00', count: 2,
  pending_load: { count: 0, amount: '0.00' },
  topups: [row(), row({ id: 2, folio: 'R-000002', amount: '150.00', desk_method: 'card', desk_method_label: 'Tarjeta en recepción', reference: 'A1', needs_verification: true })],
  voids: [row({ id: 3, folio: 'R-000003', amount: '50.00', voided: true, void_reason: 'Error de captura', voided_by: 'Veronica Prueba' })],
  duplicates: [], close: null, is_today: true, ...over,
});
const closed = {
  id: 9, closed: true, closed_at: '2026-11-27T22:00:00Z', closed_by: 'Veronica Prueba',
  expected: { cash: '200.00', card: '150.00', link: '0.00' }, counted: { cash: '180.00', card: null, link: null },
  difference: { cash: '-20.00', card: null, link: null }, topups_count: 2, note: 'Faltan 20',
  reopened_at: null, reopened_by: '', reopen_reason: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ data: summary() } as never);
  api.people.mockResolvedValue({ data: { day: '2026-11-27', people: [] } } as never);
});

describe('CorteCaja', () => {
  it('shows what is expected by method, the day list and the voids', async () => {
    renderWithProviders(<CorteCaja isAdmin={false} meId={3} />);
    const list = await screen.findByRole('list', { name: 'Recargas del corte' });
    expect(within(list).getByText(/R-000002/)).toBeInTheDocument();
    expect(within(list).getByText('Por verificar')).toBeInTheDocument();
    expect(within(list).getByText(/Anulada por Veronica Prueba: Error de captura/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Persona')).toBeNull(); // only admins pick a person
  });

  it('warns about money still loading and likely duplicates', async () => {
    api.get.mockResolvedValue({ data: summary({
      pending_load: { count: 1, amount: '80.00' },
      duplicates: [{ first: 'R-000001', second: 'R-000004', student: 'Ana Prueba', amount: '200.00' }],
    }) } as never);
    renderWithProviders(<CorteCaja isAdmin={false} meId={3} />);
    expect(await screen.findByText(/aún no se carga en Loyverse/)).toBeInTheDocument();
    expect(screen.getByText(/Posibles duplicados/)).toBeInTheDocument();
  });

  it('shows the cash difference live and closes with the counted amounts', async () => {
    const user = userEvent.setup();
    api.close.mockResolvedValue({ data: summary({ close: closed }) } as never);
    renderWithProviders(<CorteCaja isAdmin={false} meId={3} />);
    const cash = await screen.findByLabelText('Efectivo contado');
    await user.type(cash, '180');
    expect(screen.getByText(/Diferencia en efectivo: .*falta/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Nota (opcional)'), 'Faltan 20');
    await user.click(screen.getByRole('button', { name: /Cerrar corte/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Cerrar corte' });
    api.get.mockResolvedValue({ data: summary({ close: closed }) } as never); // the server now has it closed
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar corte' }));
    await waitFor(() => expect(api.close).toHaveBeenCalledWith({
      day: expect.any(String), user: undefined, counted_cash: '180',
      counted_card: undefined, counted_link: undefined, note: 'Faltan 20',
    }));
    expect(await screen.findByText('Corte cerrado')).toBeInTheDocument();
  });

  it('a closed corte shows expected vs counted; only admins reopen it', async () => {
    api.get.mockResolvedValue({ data: summary({ close: closed }) } as never);
    const { unmount } = renderWithProviders(<CorteCaja isAdmin={false} meId={3} />);
    expect(await screen.findByText('Corte cerrado')).toBeInTheDocument();
    expect(screen.getAllByText('Sin contar').length).toBe(2);
    expect(screen.queryByRole('button', { name: /Reabrir/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Imprimir corte/ })).toBeInTheDocument();
    unmount();

    const user = userEvent.setup();
    api.reopen.mockResolvedValue({ data: summary({ close: { ...closed, closed: false, reopen_reason: 'Contó mal' } }) } as never);
    renderWithProviders(<CorteCaja isAdmin meId={1} />);
    await user.click(await screen.findByRole('button', { name: /Reabrir/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Reabrir corte' });
    const confirm = within(dialog).getByRole('button', { name: 'Reabrir corte' });
    expect(confirm).toBeDisabled(); // a reason is required
    await user.type(within(dialog).getByLabelText(/Motivo/), 'Contó mal');
    await user.click(confirm);
    await waitFor(() => expect(api.reopen).toHaveBeenCalledWith(9, 'Contó mal'));
  });

  it('admins choose whose corte to see', async () => {
    api.people.mockResolvedValue({ data: { day: '2026-11-27', people: [
      { user: { id: 3, name: 'Veronica Prueba' }, expected_total: '350.00', count: 2, closed: false },
    ] } } as never);
    const user = userEvent.setup();
    renderWithProviders(<CorteCaja isAdmin meId={1} />);
    const select = await screen.findByLabelText('Persona');
    await waitFor(() => expect(within(select).getByRole('option', { name: /Veronica Prueba/ })).toBeInTheDocument());
    await user.selectOptions(select, '3');
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith({ day: expect.any(String), user: 3 }));
  });
});
