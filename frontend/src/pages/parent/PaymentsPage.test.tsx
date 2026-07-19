import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/services/api', () => ({
  paymentsApi: { getMyPayments: vi.fn(), initiatePayment: vi.fn() },
}));

import PaymentsPage from './PaymentsPage';
import { paymentsApi } from '@/services/api';

const mockedPayments = vi.mocked(paymentsApi.getMyPayments);

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/portal/pagos']}>
        <PaymentsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PaymentsPage states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows an error state (not a misleading empty list) and recovers on retry', async () => {
    // A failed fetch must not read as "Sin pagos" — that would tell a parent
    // they have no payments when the request actually errored.
    mockedPayments
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ data: { results: [] } } as never);

    renderPage();

    expect(await screen.findByText('No se pudo cargar la información')).toBeInTheDocument();
    expect(screen.queryByText('Sin pagos')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    // After the retry resolves empty, the genuine empty state shows.
    expect(await screen.findByText('Sin pagos')).toBeInTheDocument();
    expect(screen.queryByText('No se pudo cargar la información')).toBeNull();
    expect(mockedPayments).toHaveBeenCalledTimes(2);
  });

  it('labels a SUCCESS payment "Completado", not "Pendiente"', async () => {
    // Regression: statusMeta was keyed 'completed' while the backend sends
    // 'success', so paid rows fell through to the 'pending' default.
    mockedPayments.mockResolvedValue({
      data: { results: [{
        id: 1, status: 'success', payment_type: 'tuition',
        amount: '1500.00', currency: 'MXN', created_at: '2026-07-10T12:00:00Z',
      }] },
    } as never);

    renderPage();

    expect(await screen.findByText('Completado')).toBeInTheDocument();
    expect(screen.queryByText('Pendiente')).toBeNull();
  });
});
