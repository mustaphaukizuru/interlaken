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

  it('shows the allergies only when the API sends them (school switch + family authorisation)', async () => {
    const withStudent = (extra: Record<string, unknown>) => ({
      data: { ...DETAIL, transactions: [], adjustments: [],
        balance: { ...DETAIL.balance, student: { ...DETAIL.balance.student, ...extra } } },
    });
    getStudentDetail.mockResolvedValue(withStudent({ allergies_shared: true, allergies: 'Cacahuate' }) as never);
    const on = renderPage();
    expect(await screen.findByRole('note', { name: 'Alergias' })).toHaveTextContent('Alergias: Cacahuate');
    on.unmount();

    // Switch off: the API sends no allergy key and the page says nothing about them.
    getStudentDetail.mockResolvedValue(withStudent({}) as never);
    const off = renderPage();
    await screen.findByRole('heading', { name: 'Luis López' });
    expect(screen.queryByRole('note', { name: 'Alergias' })).toBeNull();
    expect(screen.queryByText(/alergias/i)).toBeNull();
    off.unmount();

    getStudentDetail.mockResolvedValue(withStudent({ allergies_shared: false }) as never);
    renderPage();
    expect(await screen.findByText(/La familia no ha autorizado compartir los datos de salud/)).toBeInTheDocument();
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

  it('a «Descontar» adjustment reads as a debit in Movimientos, a credit as a credit (QA 2026-11-24)', async () => {
    const tx = (id: number, extra: Record<string, unknown>) => ({
      id, student_id: 7, transaction_type: 'adjustment', items: [], date: '2026-08-02T15:00:00Z', loyverse_receipt_id: '', ...extra,
    });
    vi.mocked(cafeteriaAdminApi.transactions).mockResolvedValue({ data: { count: 4, results: [
      // From the trail below (its audit row is −12.50).
      tx(60, { amount: '12.50', description: 'Ajuste manual: Doble cobro', balance_after: '107.50' }),
      // Not in the trail: the step from the older row says it (130.00 → 120.00).
      tx(59, { amount: '10.00', description: 'Ajuste manual: Corrección', balance_after: '120.00' }),
      tx(58, { amount: '5.00', description: 'Ajuste manual: Cortesía', balance_after: '130.00' }),
      tx(57, { transaction_type: 'purchase', amount: '25.00', description: 'Jugo', balance_after: '125.00' }),
    ] } } as never);
    vi.mocked(cafeteriaAdminApi.adjustments).mockResolvedValue({ data: { count: 1, results: [
      { ...DETAIL.adjustments[0], id: 4, amount: '-12.50', reason: 'Doble cobro', transaction: 60, balance_after: '107.50' },
    ] } } as never);
    renderPage();

    const table = await screen.findByRole('table', { name: 'Movimientos del alumno' });
    const row = (text: string) => within(table).getByText(text).closest('tr') as HTMLElement;
    await within(table).findByText('Ajuste manual: Doble cobro');
    expect(row('Ajuste manual: Doble cobro')).toHaveTextContent('−$12.50');
    expect(within(row('Ajuste manual: Doble cobro')).getByText(/−\$12\.50/)).toHaveClass('text-coral-600');
    expect(row('Ajuste manual: Corrección')).toHaveTextContent('−$10.00');
    expect(row('Ajuste manual: Cortesía')).toHaveTextContent('+$5.00');
    // Purchases read as before.
    expect(row('Jugo')).toHaveTextContent('$25.00');
    expect(row('Jugo')).not.toHaveTextContent('−$25.00');
  });

  it('a wallet that does not exist (404) says so with the way back to Cafetería (QA 2026-11-24)', async () => {
    getStudentDetail.mockRejectedValue({ isAxiosError: true, response: { status: 404, data: { detail: 'No encontrado.' } } });
    renderPage();
    expect(await screen.findByText('No encontramos este registro')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a Cafetería' })).toHaveAttribute('href', '/admin/cafeteria');
    expect(screen.queryByRole('button', { name: /Reintentar/i })).toBeNull();
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
      expect(adjustBalance).toHaveBeenCalledWith(7, 15, 'Abono de prueba', expect.any(String));
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
      expect(adjustBalance).toHaveBeenCalledWith(7, -5, 'Descuento de prueba', expect.any(String));
    });
  });

  it('previews the resulting balance and shows server errors next to the field', async () => {
    const user = userEvent.setup();
    adjustBalance.mockRejectedValueOnce({ isAxiosError: true, response: { status: 400, data: { amount: ['El saldo no puede quedar negativo.'] } } });
    renderPage();
    await screen.findByRole('heading', { name: 'Luis López' });
    await user.click(screen.getByRole('button', { name: /Ajustar saldo/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^Descontar$/i }));
    fireEvent.change(within(dialog).getByLabelText(/Monto/i), { target: { value: '150' } });
    // Display only: $120.00 − $150.00.
    expect(within(dialog).getByText(/Saldo:/)).toHaveTextContent('Saldo: $120.00 → -$30.00');
    fireEvent.change(within(dialog).getByLabelText(/^Motivo$/i), { target: { value: 'Corrección' } });
    await user.click(within(dialog).getByRole('button', { name: /Descontar \$150/i }));
    await waitFor(() => expect(adjustBalance).toHaveBeenCalledWith(7, -150, 'Corrección', expect.any(String)));
    expect(await within(dialog).findByText('El saldo no puede quedar negativo.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Monto/i)).toHaveAttribute('aria-invalid', 'true');
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it('sends one adjustment for a double submit and stays disabled while it runs', async () => {
    const user = userEvent.setup();
    let resolve: (v: unknown) => void = () => {};
    adjustBalance.mockImplementationOnce(() => new Promise((r) => { resolve = r; }) as never);
    renderPage();
    await screen.findByRole('heading', { name: 'Luis López' });
    await user.click(screen.getByRole('button', { name: /Ajustar saldo/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Monto/i), { target: { value: '15' } });
    fireEvent.change(within(dialog).getByLabelText(/^Motivo$/i), { target: { value: 'Abono' } });
    const submit = within(dialog).getByRole('button', { name: /Abonar \$15/i });
    // Two submits in the same tick (double click / Enter twice): one request.
    fireEvent.submit(submit.closest('form')!);
    fireEvent.submit(submit.closest('form')!);
    await waitFor(() => expect(adjustBalance).toHaveBeenCalled());
    await waitFor(() => expect(submit).toBeDisabled());
    expect(adjustBalance).toHaveBeenCalledTimes(1);
    const [, , , requestId] = adjustBalance.mock.calls[0];
    expect(requestId).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    resolve({ data: {} });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Ajuste aplicado.'));
    expect(adjustBalance).toHaveBeenCalledTimes(1);
  });

  it('treats «already applied» (same request id) as done, not as an error', async () => {
    const user = userEvent.setup();
    adjustBalance.mockRejectedValueOnce({ isAxiosError: true, response: { status: 409, data: { detail: 'Este ajuste ya se aplicó.', code: 'already_applied' } } });
    renderPage();
    await screen.findByRole('heading', { name: 'Luis López' });
    await user.click(screen.getByRole('button', { name: /Ajustar saldo/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Monto/i), { target: { value: '15' } });
    fireEvent.change(within(dialog).getByLabelText(/^Motivo$/i), { target: { value: 'Abono' } });
    await user.click(within(dialog).getByRole('button', { name: /Abonar \$15/i }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('El ajuste ya estaba aplicado.'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
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
    expect(within(consumo).getByText('Compras desde el 3 sep 2024')).toBeInTheDocument();
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
