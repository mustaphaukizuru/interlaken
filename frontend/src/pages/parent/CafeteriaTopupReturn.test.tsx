import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/api', () => ({
  paymentsApi: { getPaymentStatus: vi.fn(), getAvailability: vi.fn(), getReceipt: vi.fn() },
  downloadBlob: vi.fn(),
}));

import toast from 'react-hot-toast';
import CafeteriaTopupReturn from './CafeteriaTopupReturn';
import { paymentsApi } from '@/services/api';

const getStatus = vi.mocked(paymentsApi.getPaymentStatus);
const getAvailability = vi.mocked(paymentsApi.getAvailability);
const toastSuccess = vi.mocked(toast.success);

const POLICY = { mode: 'scheduled', apply_time: '07:30', whatsapp: '5553791188', next_apply_at: null };

function renderAt(search: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/portal/cafeteria/recarga/retorno${search}`]}>
        <Routes>
          <Route path="/portal/cafeteria/recarga/retorno" element={<CafeteriaTopupReturn />} />
          <Route path="/portal/cafeteria" element={<div>Cafetería</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CafeteriaTopupReturn polling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAvailability.mockResolvedValue({ data: { online: true, test_mode: false, topup_policy: POLICY } } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows failed when payment_id is missing', () => {
    renderAt('');
    expect(screen.getByText('La recarga no se completó')).toBeInTheDocument();
    expect(getStatus).not.toHaveBeenCalled();
  });

  it('shows success and toasts when status is success', async () => {
    getStatus.mockResolvedValue({ data: { status: 'success' } } as never);
    renderAt('?payment_id=9');

    expect(await screen.findByText('Pago confirmado')).toBeInTheDocument();
    expect(screen.getByText(/cargará el monto en el POS/i)).toBeInTheDocument();
    expect(toastSuccess).toHaveBeenCalledWith(
      'Pago confirmado. El colegio cargará el saldo en el POS.',
    );
  });

  it('a paid top-up waiting for the POS load says when it applies and offers WhatsApp', async () => {
    getStatus.mockResolvedValue({ data: {
      id: 41, status: 'success', amount: '200.00', student_name: 'Ana', gateway_tx_id: 'IK9',
      topup: { id: 7, status: 'paid', apply_due_at: '2030-01-07T13:30:00Z', applied_at: null },
    } } as never);
    renderAt('?payment_id=41');

    expect(await screen.findByText('Pago recibido')).toBeInTheDocument();
    expect(screen.getByText(/el saldo se actualizará al siguiente día hábil a las 7:30 a\.m\./)).toBeInTheDocument();
    expect(screen.getByText('Se aplica')).toBeInTheDocument();
    expect(screen.getByText('el lunes 7 de enero a las 7:30 a.m.')).toBeInTheDocument();
    expect(screen.getByText('41')).toBeInTheDocument(); // folio
    const wa = await screen.findByRole('link', { name: /La necesito hoy: WhatsApp 55 5379 1188/ });
    expect(wa.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/525553791188\?text=/);
    expect(decodeURIComponent(wa.getAttribute('href') ?? '')).toContain('Folio: 41');
    expect(decodeURIComponent(wa.getAttribute('href') ?? '')).not.toContain('Ana');
    expect(screen.getByRole('button', { name: /Descargar comprobante/ })).toBeInTheDocument();
    expect(screen.queryByText(/el saldo ya aparece en el portal/)).not.toBeInTheDocument();
    expect(toastSuccess).toHaveBeenCalledWith('Pago recibido. El colegio aplicará el saldo en la próxima carga.');
  });

  it('says the payment was refunded, not that nothing was charged', async () => {
    getStatus.mockResolvedValue({ data: { status: 'refunded' } } as never);
    renderAt('?payment_id=9');

    expect(await screen.findByText('Pago devuelto')).toBeInTheDocument();
    expect(screen.queryByText(/No se realizó ningún cargo/)).not.toBeInTheDocument();
  });

  it('explains the real cause of a failure', async () => {
    getStatus.mockResolvedValue({ data: { status: 'failed', failure_reason: 'cancelled' } } as never);
    renderAt('?payment_id=9');

    expect(await screen.findByText('La recarga no se completó: cancelado')).toBeInTheDocument();
    expect(screen.getByText(/Se canceló el pago en la ventana de Banorte/)).toBeInTheDocument();
    expect(screen.queryByText(/banco rechazó/)).not.toBeInTheDocument();
  });

  it('shows the bank reference and authorisation of a confirmed payment', async () => {
    getStatus.mockResolvedValue({ data: {
      status: 'success', amount: '200.00', student_name: 'Ana', gateway_tx_id: 'IK9ABC',
      bank_reference: '248233587990', auth_code: '214414',
    } } as never);
    renderAt('?payment_id=9');

    expect(await screen.findByText('248233587990')).toBeInTheDocument();
    expect(screen.getByText('214414')).toBeInTheDocument();
    expect(screen.getByText('Referencia bancaria')).toBeInTheDocument();
  });

  it('shows pending after polling is exhausted while still pending', async () => {
    vi.useFakeTimers();
    getStatus.mockResolvedValue({ data: { status: 'pending' } } as never);
    renderAt('?payment_id=9');

    // Flush the initial poll + each of the remaining MAX_POLLS-1 intervals.
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
    }

    expect(screen.getByText('Recarga en proceso')).toBeInTheDocument();
    expect(getStatus.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('clears the poll timer on unmount', async () => {
    vi.useFakeTimers();
    getStatus.mockResolvedValue({ data: { status: 'pending' } } as never);
    const { unmount } = renderAt('?payment_id=9');

    await act(async () => {
      await Promise.resolve();
    });
    const callsBefore = getStatus.mock.calls.length;
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(getStatus.mock.calls.length).toBe(callsBefore);
  });
});
