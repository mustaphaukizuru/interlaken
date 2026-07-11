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

describe('CafeteriaPage states', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows an error state when balances fail, and recovers on retry', async () => {
    mockedBalance
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ data: [] } as never);
    mockedTx.mockResolvedValue({ data: { results: [] } } as never);

    renderWithProviders(<CafeteriaPage />, { route: '/portal/cafeteria' });

    expect(await screen.findByText('No se pudo cargar la información')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    // Once balances resolve, the real page (transactions card) renders.
    expect(await screen.findByText('Historial de movimientos')).toBeInTheDocument();
    expect(screen.queryByText('No se pudo cargar la información')).toBeNull();
    expect(mockedBalance).toHaveBeenCalledTimes(2);
  });
});
