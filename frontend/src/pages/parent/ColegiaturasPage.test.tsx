import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  financeApi: { getInvoices: vi.fn(), payInvoice: vi.fn(), downloadReceipt: vi.fn() },
  downloadBlob: vi.fn(),
}));

import ColegiaturasPage from './ColegiaturasPage';
import { financeApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const mockedInvoices = vi.mocked(financeApi.getInvoices);

describe('ColegiaturasPage states', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows an error state (not "Sin colegiaturas") and recovers on retry', async () => {
    mockedInvoices
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ data: { results: [] } } as never);

    renderWithProviders(<ColegiaturasPage />, { route: '/portal/colegiaturas' });

    expect(await screen.findByText('No se pudo cargar la información')).toBeInTheDocument();
    expect(screen.queryByText('Sin colegiaturas')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    expect(await screen.findByText('Sin colegiaturas')).toBeInTheDocument();
    expect(screen.queryByText('No se pudo cargar la información')).toBeNull();
    expect(mockedInvoices).toHaveBeenCalledTimes(2);
  });
});
