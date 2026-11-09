import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

vi.mock('@/services/api', () => ({
  cafeteriaApi: {
    getStudentDetail: vi.fn(),
    adjustBalance: vi.fn(),
    refundTransaction: vi.fn(),
    exportStudent: vi.fn(),
  },
  downloadBlob: vi.fn(),
}));

vi.mock('@/services/cafeteriaAdmin', () => ({
  cafeteriaAdminApi: { transactions: vi.fn(), adjustments: vi.fn() },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

import toast from 'react-hot-toast';
import AdminCafeteriaStudent from './AdminCafeteriaStudent';
import { cafeteriaApi } from '@/services/api';
import { cafeteriaAdminApi } from '@/services/cafeteriaAdmin';
import { stubViewport } from '@/test/viewport';
import { renderWithProviders } from '@/test/renderWithProviders';

const getStudentDetail = vi.mocked(cafeteriaApi.getStudentDetail);
const adjustBalance = vi.mocked(cafeteriaApi.adjustBalance);
const refundTransaction = vi.mocked(cafeteriaApi.refundTransaction);
const toastSuccess = vi.mocked(toast.success);

const DETAIL = {
  balance: {
    id: 9,
    balance: '120.00',
    low_balance_threshold: '50',
    last_synced: '2026-08-01T12:00:00Z',
    student: {
      id: 7,
      student_id: 'A-007',
      grade: '3°',
      group: 'A',
      loyverse_id: '',
      user: {
        id: 70,
        email: 'luis@example.com',
        first_name: 'Luis',
        last_name: 'López',
        full_name: 'Luis López',
        role: 'student' as const,
        avatar: '',
        whatsapp: '',
        has_usable_password: true,
        notif_prefs: { email_enabled: true, in_app_enabled: true, push_enabled: false },
      },
    },
  },
  parents: [{ id: 1, full_name: 'Ana López', email: 'ana@example.com', whatsapp: '' }],
  transactions: [
    {
      id: 55,
      student_id: 7,
      transaction_type: 'purchase' as const,
      amount: '25.00',
      description: 'Jugo',
      items: [],
      balance_after: '95.00',
      date: '2026-08-02T15:00:00Z',
      loyverse_receipt_id: 'r-1',
    },
  ],
  adjustments: [
    {
      id: 3,
      kind: 'adjustment' as const,
      kind_display: 'Ajuste',
      amount: '20.00',
      reason: 'Cortesía',
      admin_name: 'Admin',
      status_after: '',
      amount_after: null,
      amount_paid_after: null,
      created_at: '2026-07-30T09:00:00Z',
      balance_after: '140.00',
    },
  ],
  consumption: { total: '0.00', since: null },
  loyverse: null,
};

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/cafeteria/:studentId" element={<AdminCafeteriaStudent />} />
    </Routes>,
    { route: '/admin/cafeteria/7' },
  );
}

describe('AdminCafeteriaStudent money actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubViewport(1280);
    getStudentDetail.mockResolvedValue({ data: { ...DETAIL, transactions: [], adjustments: [] } } as never);
    // The ledger and the adjustment trail are paged through the admin lists.
    vi.mocked(cafeteriaAdminApi.transactions).mockResolvedValue({ data: { count: 1, results: DETAIL.transactions } } as never);
    vi.mocked(cafeteriaAdminApi.adjustments).mockResolvedValue({ data: { count: 1, results: DETAIL.adjustments } } as never);
    adjustBalance.mockResolvedValue({ data: {} } as never);
    refundTransaction.mockResolvedValue({ data: {} } as never);
  });

  it('renders balance, movements, and adjustment history', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Luis López' })).toBeInTheDocument();
    expect(screen.getByText(/Matrícula A-007/i)).toBeInTheDocument();
    expect(screen.getByText(/Saldo actual/i)).toBeInTheDocument();
    expect(await screen.findByText('Jugo')).toBeInTheDocument();
    expect(await screen.findByText('Cortesía')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Devolver/i })).toBeInTheDocument();
    expect(getStudentDetail).toHaveBeenCalledWith(7, { ledger: 0 });
    expect(cafeteriaAdminApi.transactions).toHaveBeenCalledWith({ student: 7, page: 1 });
    expect(cafeteriaAdminApi.adjustments).toHaveBeenCalledWith({ student: 7, page: 1 });
  });

  it('abonars and descontar call adjustBalance with the signed amount', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Luis López' });

    await user.click(screen.getByRole('button', { name: /Ajustar saldo/i }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText(/Monto/i), { target: { value: '15' } });
    fireEvent.change(within(dialog).getByLabelText(/^Motivo$/i), {
      target: { value: 'Abono de prueba' },
    });
    await user.click(within(dialog).getByRole('button', { name: /Abonar \$15/i }));

    await waitFor(() => {
      expect(adjustBalance).toHaveBeenCalledWith(7, 15, 'Abono de prueba');
    });
    expect(toastSuccess).toHaveBeenCalledWith('Ajuste aplicado.');

    adjustBalance.mockClear();
    await user.click(screen.getByRole('button', { name: /Ajustar saldo/i }));
    const dialog2 = await screen.findByRole('dialog');
    await user.click(within(dialog2).getByRole('button', { name: /^Descontar$/i }));
    fireEvent.change(within(dialog2).getByLabelText(/Monto/i), { target: { value: '5' } });
    fireEvent.change(within(dialog2).getByLabelText(/^Motivo$/i), {
      target: { value: 'Descuento de prueba' },
    });
    await user.click(within(dialog2).getByRole('button', { name: /Descontar \$5/i }));

    await waitFor(() => {
      expect(adjustBalance).toHaveBeenCalledWith(7, -5, 'Descuento de prueba');
    });
  });

  it('keeps refund confirm disabled until DEVOLVER is typed', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Luis López' });

    await user.click(await screen.findByRole('button', { name: /Devolver/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: /Confirmar devolución/i })).toBeInTheDocument();

    const confirm = within(dialog).getByRole('button', { name: /Procesar devolución/i });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByPlaceholderText('DEVOLVER'), 'DEVOLVER');
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    await waitFor(() => {
      expect(refundTransaction).toHaveBeenCalledWith(55, '', false);
    });
    expect(toastSuccess).toHaveBeenCalledWith('Devolución procesada.');
  });
});

describe('AdminCafeteriaStudent «Consumo registrado» (owner, 2026-11-08)', () => {
  const tz = process.env.TZ;
  // Loyverse's own snapshot: wallet purchases are points, so total_spent is $0.00.
  const LOYVERSE = {
    customer_code: 'ci0007', name: 'López Luis-3PRI', email: '', phone_number: '', address_code: '3PRI',
    note: '', first_visit: '2024-08-26T14:00:00Z', last_visit: '2026-11-06T18:30:00Z', total_visits: 274,
    total_spent: '0.00', total_points: '120.00', loyverse_created_at: null, synced_at: '2026-11-07T12:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    stubViewport(1280);
    // In Mexico City, '2024-09-03' read as UTC midnight is still 2 September.
    process.env.TZ = 'America/Mexico_City';
    vi.mocked(cafeteriaAdminApi.transactions).mockResolvedValue({ data: { count: 0, results: [] } } as never);
    vi.mocked(cafeteriaAdminApi.adjustments).mockResolvedValue({ data: { count: 0, results: [] } } as never);
  });

  afterEach(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });

  it('shows the ledger consumption and names Loyverse total_spent for what it is', async () => {
    getStudentDetail.mockResolvedValue({ data: {
      ...DETAIL, transactions: [], adjustments: [],
      consumption: { total: '907.00', since: '2024-09-03' }, loyverse: LOYVERSE,
    } } as never);
    renderPage();

    const consumo = (await screen.findByText('Consumo registrado')).parentElement as HTMLElement;
    expect(within(consumo).getByText('$907.00')).toBeInTheDocument();
    expect(within(consumo).getByText('Compras desde el 3 de sep 2024')).toBeInTheDocument();
    expect(screen.queryByText('Gasto total')).toBeNull();
    const cash = screen.getByText('Efectivo/tarjeta en caja').parentElement as HTMLElement;
    expect(within(cash).getByText('$0.00')).toBeInTheDocument();
  });

  it('says so when the student has no purchase yet', async () => {
    getStudentDetail.mockResolvedValue({ data: { ...DETAIL, transactions: [], adjustments: [] } } as never);
    renderPage();
    const consumo = (await screen.findByText('Consumo registrado')).parentElement as HTMLElement;
    expect(within(consumo).getByText('$0.00')).toBeInTheDocument();
    expect(within(consumo).getByText('Sin compras registradas')).toBeInTheDocument();
  });
});
