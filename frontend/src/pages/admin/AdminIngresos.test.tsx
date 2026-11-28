import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/ingresos', () => ({ ingresosApi: { report: vi.fn(), export: vi.fn() } }));

import AdminIngresos from './AdminIngresos';
import { ingresosApi } from '@/services/ingresos';
import { renderWithProviders } from '@/test/renderWithProviders';

const api = vi.mocked(ingresosApi);
const CHANNELS = [
  { key: 'portal', label: 'Portal (tarjeta en línea)' },
  { key: 'desk_cash', label: 'Recepción · efectivo' },
  { key: 'desk_card', label: 'Recepción · tarjeta' },
  { key: 'desk_link', label: 'Recepción · liga de pago' },
  { key: 'pos', label: 'Caja de cafetería (POS)' },
];
const zero = { portal: '0.00', desk_cash: '0.00', desk_card: '0.00', desk_link: '0.00', pos: '0.00', total: '0.00', count: 0, pending_load: '0.00', to_verify: '0.00' };

beforeEach(() => {
  vi.clearAllMocks();
  api.report.mockResolvedValue({ data: {
    start: '2026-11-01', end: '2026-11-30', channels: CHANNELS,
    rows: [
      { ...zero, day: '2026-11-26', portal: '300.00', desk_cash: '240.00', pos: '100.00', total: '640.00', count: 4, pending_load: '40.00' },
      { ...zero, day: '2026-11-27' },
    ],
    totals: { ...zero, portal: '300.00', desk_cash: '240.00', pos: '100.00', total: '640.00', count: 4, pending_load: '40.00', to_verify: '150.00' },
  } } as never);
});

describe('AdminIngresos', () => {
  it('shows the period totals by channel, the day rows and the notes', async () => {
    renderWithProviders(<AdminIngresos />, { route: '/admin/ingresos' });
    const table = await screen.findByRole('table', { name: 'Ingresos por día y canal' });
    expect(within(table).getAllByRole('row')).toHaveLength(4); // header, 2 days, total
    const totals = screen.getByLabelText('Totales del periodo');
    expect(within(totals).getByText('Caja de cafetería (POS)')).toBeInTheDocument();
    expect(within(totals).getByText('4 recargas')).toBeInTheDocument();
    expect(screen.getByText(/aún no se carga en Loyverse/)).toBeInTheDocument();
    expect(screen.getByText(/por verificar en MultiCobros/)).toBeInTheDocument();
    expect(api.report).toHaveBeenCalledWith({ month: expect.stringMatching(/^\d{4}-\d{2}$/) });
  });

  it('switches to a date range', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminIngresos />, { route: '/admin/ingresos' });
    await screen.findByRole('table', { name: 'Ingresos por día y canal' });
    await user.click(screen.getByRole('tab', { name: 'Rango de fechas' }));
    await waitFor(() => expect(api.report).toHaveBeenLastCalledWith({ from: expect.any(String), to: expect.any(String) }));
  });
});
