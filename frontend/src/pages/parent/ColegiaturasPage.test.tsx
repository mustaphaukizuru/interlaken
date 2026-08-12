import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  financeApi: { getInvoices: vi.fn(), payInvoice: vi.fn(), downloadReceipt: vi.fn() },
  portalApi: { getDashboard: vi.fn() },
  downloadBlob: vi.fn(),
}));

import ColegiaturasPage from './ColegiaturasPage';
import { financeApi, portalApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { useSelectedChildStore } from '@/store/selectedChildStore';

const mockedInvoices = vi.mocked(financeApi.getInvoices);
const mockedDashboard = vi.mocked(portalApi.getDashboard);

function invoice(id: number, periodLabel: string) {
  return {
    id,
    student_id: 1,
    student_name: 'Luis López',
    student_code: 'A-1',
    grade: '3°',
    period: `2026-${String(id).padStart(2, '0')}`,
    period_label: periodLabel,
    due_date: '2026-08-10',
    amount: '5000.00',
    amount_paid: '0.00',
    balance_due: '5000.00',
    currency: 'MXN',
    status: 'pending',
    status_display: 'Pendiente',
  };
}

describe('ColegiaturasPage states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSelectedChildStore.setState({ childId: null });
    mockedDashboard.mockResolvedValue({
      data: {
        children: [{ id: 1, name: 'Luis López', grade: '3°', group: 'A', student_id: 'A-1' }],
        children_count: 1,
      },
    } as never);
  });

  it('shows an error state (not "Sin colegiaturas") and recovers on retry', async () => {
    mockedInvoices
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ data: { results: [], count: 0 } } as never);

    renderWithProviders(<ColegiaturasPage />, { route: '/portal/colegiaturas' });

    expect(await screen.findByText('No se pudo cargar la información')).toBeInTheDocument();
    expect(screen.queryByText('Sin colegiaturas')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    expect(await screen.findByText('Sin colegiaturas')).toBeInTheDocument();
    expect(screen.queryByText('No se pudo cargar la información')).toBeNull();
    expect(mockedInvoices).toHaveBeenCalledTimes(2);
  });

  it('requests page 2 and renders the next invoice slice', async () => {
    mockedInvoices
      .mockResolvedValueOnce({
        data: {
          count: 21,
          results: [invoice(1, 'Agosto 2026')],
        },
      } as never)
      .mockResolvedValueOnce({
        data: {
          count: 21,
          results: [invoice(2, 'Septiembre 2026')],
        },
      } as never);

    renderWithProviders(<ColegiaturasPage />, { route: '/portal/colegiaturas' });

    expect((await screen.findAllByText(/Agosto 2026/i)).length).toBeGreaterThan(0);
    expect(screen.getByText(/Saldo pendiente \(página actual\)/i)).toBeInTheDocument();
    expect(mockedInvoices).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1 }),
    );

    await userEvent.click(screen.getByRole('button', { name: /siguiente/i }));

    await waitFor(() => {
      expect(mockedInvoices).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 }),
      );
    });
    expect((await screen.findAllByText(/Septiembre 2026/i)).length).toBeGreaterThan(0);
  });
});
