import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  cafeteriaApi: { getMyBalance: vi.fn(), getTransactions: vi.fn(), requestTopUp: vi.fn() },
}));

import CafeteriaPage from './CafeteriaPage';
import { cafeteriaApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const mockedBalance = vi.mocked(cafeteriaApi.getMyBalance);
const mockedTx = vi.mocked(cafeteriaApi.getTransactions);

// History card renders when the family has any cafeteria balance row.
const account = {
  id: 1,
  student: {
    id: 10,
    user: { full_name: 'Emma Quintana' },
    student_id: '09824',
    grade: '4°',
    group: 'A',
    loyverse_id: 'loy-emma',
  },
  balance: '150.00',
  low_balance_threshold: '50',
  last_synced: '2026-07-17T12:00:00Z',
};

const unlinkedAccount = {
  ...account,
  id: 2,
  student: { ...account.student, id: 11, loyverse_id: '' },
};

describe('CafeteriaPage states', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows an error state when balances fail, and recovers on retry', async () => {
    mockedBalance
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ data: [account] } as never);
    mockedTx.mockResolvedValue({ data: { results: [] } } as never);

    renderWithProviders(<CafeteriaPage />, { route: '/portal/cafeteria' });

    expect(await screen.findByText('No se pudo cargar la información')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    // Once balances resolve, the real page (transactions card) renders.
    expect(await screen.findByText('Historial de movimientos')).toBeInTheDocument();
    expect(screen.queryByText('No se pudo cargar la información')).toBeNull();
    expect(mockedBalance).toHaveBeenCalledTimes(2);
  });

  it('paginates history: shows the total count and a pager when there are >1 page', async () => {
    // Regression: the page read only the first 20 rows and showed that as the
    // total, so older movements were unreachable.
    mockedBalance.mockResolvedValue({ data: [account] } as never);
    mockedTx.mockResolvedValue({
      data: { count: 45, results: [{
        id: 1, transaction_type: 'purchase', amount: '25.00',
        date: '2026-07-10T12:00:00Z', balance_after: '125.00', items: [],
      }] },
    } as never);

    renderWithProviders(<CafeteriaPage />, { route: '/portal/cafeteria' });

    expect(await screen.findByText('45 movimientos')).toBeInTheDocument();  // total, not page length
    expect(screen.getByRole('button', { name: /página siguiente/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /página siguiente/i }));
    // Page 2 was requested from the API.
    expect(mockedTx).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
  });

  it('hides Recargar when the student is not linked to Loyverse', async () => {
    mockedBalance.mockResolvedValue({ data: [unlinkedAccount] } as never);
    mockedTx.mockResolvedValue({ data: { results: [], count: 0 } } as never);

    renderWithProviders(<CafeteriaPage />, { route: '/portal/cafeteria' });

    expect(
      await screen.findByText(/aún no está vinculado a cafetería\/Loyverse/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Recargar/i })).not.toBeInTheDocument();
  });

  it('shows Recargar for a linked cafeteria account', async () => {
    mockedBalance.mockResolvedValue({ data: [account] } as never);
    mockedTx.mockResolvedValue({ data: { results: [], count: 0 } } as never);

    renderWithProviders(<CafeteriaPage />, { route: '/portal/cafeteria' });

    expect(await screen.findByRole('button', { name: /Recargar/i })).toBeInTheDocument();
    expect(screen.queryByText(/aún no está vinculado a cafetería\/Loyverse/i)).toBeNull();
  });
});
