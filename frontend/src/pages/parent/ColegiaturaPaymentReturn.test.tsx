import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/api', () => ({
  paymentsApi: { getPaymentStatus: vi.fn() },
}));

import toast from 'react-hot-toast';
import ColegiaturaPaymentReturn from './ColegiaturaPaymentReturn';
import { paymentsApi } from '@/services/api';

const getStatus = vi.mocked(paymentsApi.getPaymentStatus);
const toastSuccess = vi.mocked(toast.success);

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/portal/colegiaturas/retorno${search}`]}>
      <Routes>
        <Route path="/portal/colegiaturas/retorno" element={<ColegiaturaPaymentReturn />} />
        <Route path="/portal/colegiaturas" element={<div>Colegiaturas</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ColegiaturaPaymentReturn polling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows failed when payment_id is missing', () => {
    renderAt('');
    expect(screen.getByText('El pago no se completó')).toBeInTheDocument();
    expect(getStatus).not.toHaveBeenCalled();
  });

  it('shows success and toasts when status is success', async () => {
    getStatus.mockResolvedValue({ data: { status: 'success' } } as never);
    renderAt('?payment_id=9');

    expect(await screen.findByText('Pago confirmado')).toBeInTheDocument();
    expect(toastSuccess).toHaveBeenCalledWith('Pago de colegiatura confirmado.');
  });

  it('shows failed when status is failed or refunded', async () => {
    getStatus.mockResolvedValue({ data: { status: 'refunded' } } as never);
    renderAt('?payment_id=9');

    expect(await screen.findByText('El pago no se completó')).toBeInTheDocument();
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

    expect(screen.getByText('Pago en proceso')).toBeInTheDocument();
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
