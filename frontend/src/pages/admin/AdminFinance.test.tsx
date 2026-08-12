import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  financeApi: {
    getDashboard: vi.fn(),
    getAdminInvoices: vi.fn(),
    refundOverpayment: vi.fn(),
    generate: vi.fn(),
    markPaid: vi.fn(),
    cancelInvoice: vi.fn(),
    adjustInvoice: vi.fn(),
    getAdminInvoice: vi.fn(),
    bulkAction: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

import toast from 'react-hot-toast';
import AdminFinance from './AdminFinance';
import { financeApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const getDashboard = vi.mocked(financeApi.getDashboard);
const getAdminInvoices = vi.mocked(financeApi.getAdminInvoices);
const refundOverpayment = vi.mocked(financeApi.refundOverpayment);
const toastSuccess = vi.mocked(toast.success);
const toastError = vi.mocked(toast.error);

const overpaidInvoice = {
  id: 42,
  student_id: 7,
  student_name: 'Ana López',
  student_code: 'A-001',
  grade: '3°',
  period: '2026-08',
  period_label: 'Agosto 2026',
  due_date: '2026-08-10',
  currency: 'MXN',
  amount: '1000.00',
  amount_paid: '1050.00',
  balance_due: '-50.00',
  status: 'paid',
  status_display: 'Pagada',
};

function dashboardPayload(overpaid = 1) {
  return {
    data: {
      period: '2026-08',
      billed: '1000.00',
      collected: '1200.00',
      outstanding: '0.00',
      collection_rate: 100,
      invoices: 1,
      paid: 1,
      overdue: 0,
      pending: 0,
      overpaid,
      overpaid_credit: '50.00',
    },
  };
}

function invoicesPayload(results = [overpaidInvoice]) {
  return { data: { results, count: results.length } };
}

async function openRefundDialog(user: ReturnType<typeof userEvent.setup>) {
  const buttons = await screen.findAllByRole('button', {
    name: /Registrar devolución de la colegiatura de Ana López/i,
  });
  await user.click(buttons[0]);
  return screen.findByRole('dialog');
}

function confirmField(dialog: HTMLElement) {
  // ConfirmDialog Input builds id from the label (incl. «»); placeholder is stable.
  return within(dialog).getByPlaceholderText('DEVOLVER');
}

describe('AdminFinance overpayment refund', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDashboard.mockResolvedValue(dashboardPayload() as never);
    getAdminInvoices.mockResolvedValue(invoicesPayload() as never);
    refundOverpayment.mockResolvedValue({ data: {} } as never);
  });

  it('shows the overpaid banner and filters to overpaid invoices', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminFinance />, { route: '/admin/finanzas' });

    expect(await screen.findByText(/1 colegiatura\(s\) con saldo a favor/i)).toBeInTheDocument();
    expect(screen.getByText(/Crédito total \$50\.00/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Ver sobrepagadas/i }));

    await waitFor(() => {
      expect(getAdminInvoices).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'overpaid', page: 1 }),
      );
    });
    expect(screen.getByRole('option', { name: /A favor \(sobrepagada\)/i })).toBeInTheDocument();
  });

  it('opens the refund dialog and keeps confirm disabled until DEVOLVER', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminFinance />, { route: '/admin/finanzas' });

    expect((await screen.findAllByText('A favor')).length).toBeGreaterThan(0);
    const dialog = await openRefundDialog(user);

    expect(within(dialog).getByRole('heading', { name: 'Registrar devolución' })).toBeInTheDocument();
    expect(within(dialog).getByText(/Ana López/)).toBeInTheDocument();
    expect(within(dialog).getByText(/\$50\.00/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Escriba «DEVOLVER» para confirmar/i)).toBeInTheDocument();

    const confirm = within(dialog).getByRole('button', { name: 'Registrar devolución' });
    expect(confirm).toBeDisabled();

    await user.type(confirmField(dialog), 'DEVOLVER');
    expect(confirm).toBeEnabled();
  });

  it('requires a reason before calling refundOverpayment', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminFinance />, { route: '/admin/finanzas' });

    const dialog = await openRefundDialog(user);
    await user.type(confirmField(dialog), 'DEVOLVER');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar devolución' }));

    expect(toastError).toHaveBeenCalledWith('Indique el motivo de la devolución.');
    expect(refundOverpayment).not.toHaveBeenCalled();
  });

  it('registers the refund with reason and toasts success', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminFinance />, { route: '/admin/finanzas' });

    const dialog = await openRefundDialog(user);
    fireEvent.change(within(dialog).getByLabelText('Motivo de la devolución'), {
      target: { value: 'Doble cobro devolucion en transferencia' },
    });
    await user.type(confirmField(dialog), 'DEVOLVER');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar devolución' }));

    await waitFor(() => {
      expect(refundOverpayment).toHaveBeenCalledWith(
        42,
        'Doble cobro devolucion en transferencia',
      );
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      'Devolución registrada. El pago quedó como reembolsado.',
    );
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
