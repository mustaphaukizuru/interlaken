import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  paymentsApi: { verifyBanorte: vi.fn() },
  downloadBlob: vi.fn(),
}));

vi.mock('@/services/cafeteriaAdmin', () => ({
  cafeteriaAdminApi: {
    topups: vi.fn(), exportTopups: vi.fn(), bulkTopups: vi.fn(),
    applyPaidTopUp: vi.fn(), refundPaidTopUp: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), loading: vi.fn(() => 'id') });
  return { default: t };
});

import toast from 'react-hot-toast';
import { PaidTopUpQueue } from './PaidTopUpQueue';
import { cafeteriaAdminApi } from '@/services/cafeteriaAdmin';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';

const api = vi.mocked(cafeteriaAdminApi);
const applyPaid = vi.mocked(cafeteriaAdminApi.applyPaidTopUp);
const refundPaid = vi.mocked(cafeteriaAdminApi.refundPaidTopUp);
const ok = (data: unknown) => ({ data }) as never;

const row = {
  id: 7, student_id: 3, student_name: 'Luis Pérez', student_code: '09938', amount: '200.00',
  method: 'online' as const, method_display: 'Pago en Línea', status: 'paid' as const, status_display: 'Pagada · por aplicar',
  gateway: 'banorte', payment_status: 'success', gateway_tx_id: 'IK41', payment_id: 41,
  banorte: {
    control_number: 'IK41', referencia: '248233587990', codigo_aut: '214414', resultado: 'A' as const,
    mode: 'PRD', marca_tarjeta: 'VISA', verified_at: '2026-10-19T12:00:00Z', verified_by_name: 'Dirección',
    needs_verification: false,
  },
  created_at: '2026-10-16T23:00:00Z', processed_at: '2026-10-16T23:01:00Z',
  pos_loaded_at: null, pos_loaded_by_name: '', needs_pos_load: false,
  pos_unload_needed_at: null, pos_unloaded_at: null, pos_unloaded_by_name: '', needs_pos_unload: false,
  apply_due_at: '2026-10-19T13:30:00Z', applied_at: null, applied_via: '' as const, applied_by_name: '',
  needs_apply: true, apply_overdue: true, loyverse_code: 'ci09938', loyverse_points: '50.00', wallet_balance: '50.00',
  payer: { name: 'Ana Pérez', email: 'ana@familia.mx', phone: '5512345678', paid_at: '2026-10-19T03:00:00Z', card_brand: 'VISA' },
};

function axiosError(status: number, data: unknown) {
  return Object.assign(new Error('Request failed'), { isAxiosError: true, response: { status, data } });
}

describe('PaidTopUpQueue («Por aplicar»)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubViewport(1280);
    api.topups.mockResolvedValue(ok({ count: 1, next: null, previous: null, results: [row] }));
  });

  it('lists what staff type at the POS, with the overdue mark', async () => {
    renderWithProviders(<PaidTopUpQueue />);
    expect(await screen.findByText('Luis Pérez')).toBeInTheDocument();
    expect(api.topups).toHaveBeenCalledWith(expect.objectContaining({ needs_apply: 1 }));
    expect(screen.getAllByText('ci09938').length).toBeGreaterThan(0);
    expect(screen.getByText('1 vencida')).toBeInTheDocument();
    expect(screen.getAllByText('Vencida').length).toBeGreaterThan(0);
    // Who paid (owner, 2026-10-20).
    expect(screen.getByText('Ana Pérez')).toBeInTheDocument();
    expect(screen.getByText('ana@familia.mx')).toBeInTheDocument();
    expect(screen.getByText('5512345678')).toBeInTheDocument();
  });

  it('applies after the server confirms Loyverse has it', async () => {
    applyPaid.mockResolvedValue(ok({ id: 7, status: 'completed', balance: '250.00', detail: 'Recarga aplicada: ya está disponible para el alumno.' }));
    const u = userEvent.setup();
    renderWithProviders(<PaidTopUpQueue />);
    await u.click(await screen.findByRole('button', { name: 'Aplicar la recarga de Luis Pérez' }));
    const dialog = await screen.findByRole('dialog', { name: 'Aplicar recarga cargada en el POS' });
    await u.click(within(dialog).getByRole('button', { name: 'Ya la cargué: aplicar' }));

    await waitFor(() => expect(applyPaid).toHaveBeenCalledWith(7, {}));
    expect(toast.success).toHaveBeenCalledWith('Recarga aplicada: ya está disponible para el alumno.');
  });

  it('when Loyverse does not show it, explains and allows an audited override', async () => {
    applyPaid
      .mockRejectedValueOnce(axiosError(409, {
        detail: 'Loyverse aún no muestra esta recarga.', code: 'pos_not_loaded',
        loyverse_points: '50.00', wallet_balance: '50.00', amount: '200.00',
      }))
      .mockResolvedValueOnce(ok({ id: 7, status: 'completed', balance: '250.00', detail: 'Recarga aplicada sin verificar en Loyverse; quedó en «Cargar en POS».' }));
    const u = userEvent.setup();
    renderWithProviders(<PaidTopUpQueue />);
    await u.click(await screen.findByRole('button', { name: 'Aplicar la recarga de Luis Pérez' }));
    const dialog = await screen.findByRole('dialog');
    await u.click(within(dialog).getByRole('button', { name: 'Ya la cargué: aplicar' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Loyverse aún no muestra esta recarga.');
    await u.click(within(dialog).getByRole('checkbox'));
    const submit = within(dialog).getByRole('button', { name: 'Aplicar sin verificar' });
    expect(submit).toBeDisabled();
    await u.type(within(dialog).getByLabelText(/Motivo/), 'El alumno compró justo después');
    await u.click(submit);

    await waitFor(() => expect(applyPaid).toHaveBeenLastCalledWith(7, { force: true, note: 'El alumno compró justo después' }));
  });

  it('refund before apply needs the reason and both confirmations', async () => {
    refundPaid.mockResolvedValue(ok({ id: 7, status: 'refunded', detail: 'ok' }));
    const u = userEvent.setup();
    renderWithProviders(<PaidTopUpQueue />);
    await u.click(await screen.findByRole('button', { name: 'Devolver el pago de Luis Pérez' }));
    const dialog = await screen.findByRole('dialog', { name: 'Devolver pago sin aplicar' });
    const submit = within(dialog).getByRole('button', { name: 'Devolver pago' });

    await u.type(within(dialog).getByLabelText(/Motivo/), 'Pagó dos veces');
    expect(submit).toBeDisabled();
    await u.click(within(dialog).getByLabelText(/devolución del cargo en MultiCobros/));
    expect(submit).toBeDisabled();
    await u.click(within(dialog).getByLabelText(/no está cargado en el POS/));
    await u.click(submit);

    await waitFor(() => expect(refundPaid).toHaveBeenCalledWith(7, {
      note: 'Pagó dos veces', bank_refund_confirmed: true, pos_not_loaded_confirmed: true,
    }));
  });

  it('an unverified real approval asks for MultiCobros first', async () => {
    api.topups.mockResolvedValue(ok({ count: 1, next: null, previous: null, results: [{
      ...row, banorte: { ...row.banorte, verified_at: null, needs_verification: true },
    }] }));
    renderWithProviders(<PaidTopUpQueue />);
    expect(await screen.findByRole('button', { name: /Verificar en MultiCobros/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aplicar la recarga de Luis Pérez' })).toBeNull();
  });
});
