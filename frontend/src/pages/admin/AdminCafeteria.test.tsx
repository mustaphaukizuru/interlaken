import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  cafeteriaApi: {
    syncAll: vi.fn(),
    syncBalance: vi.fn(),
    markTopUpPosLoaded: vi.fn(),
    markTopUpPosUnloaded: vi.fn(),
    reconcileFix: vi.fn(),
    refundTransaction: vi.fn(),
    getLoyverseCustomerReceipts: vi.fn(),
    bulkTopUp: vi.fn(),
  },
  paymentsApi: { verifyBanorte: vi.fn(), reconcileBanorte: vi.fn() },
  downloadBlob: vi.fn(),
}));

vi.mock('@/services/cafeteriaAdmin', () => ({
  cafeteriaAdminApi: {
    balances: vi.fn(),
    exportBalances: vi.fn(),
    bulkBalances: vi.fn(),
    transactions: vi.fn(),
    exportTransactions: vi.fn(),
    adjustments: vi.fn(),
    topups: vi.fn(),
    exportTopups: vi.fn(),
    bulkTopups: vi.fn(),
    lowBalance: vi.fn(),
    exportLowBalance: vi.fn(),
    customers: vi.fn(),
    exportCustomers: vi.fn(),
    reconcile: vi.fn(),
    exportReconcile: vi.fn(),
    bulkReconcile: vi.fn(),
  },
  adjustmentImportApi: vi.fn(),
}));

vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), loading: vi.fn(() => 'id') });
  return { default: t };
});

import toast from 'react-hot-toast';
import AdminCafeteria from './AdminCafeteria';
import { cafeteriaApi, paymentsApi } from '@/services/api';
import { adjustmentImportApi, cafeteriaAdminApi } from '@/services/cafeteriaAdmin';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';

const api = vi.mocked(cafeteriaAdminApi);
const markLoaded = vi.mocked(cafeteriaApi.markTopUpPosLoaded);
const markUnloaded = vi.mocked(cafeteriaApi.markTopUpPosUnloaded);
const toastSuccess = vi.mocked(toast.success);
const toastError = vi.mocked(toast.error);
const ok = (data: unknown) => ({ data }) as never;
const page = (results: unknown[]) => ok({ count: results.length, next: null, previous: null, results });

const loadRow = {
  id: 11, student_id: 3, student_name: 'Luis Pérez', student_code: 'L-003', amount: '200.00',
  method: 'online' as const, method_display: 'Pago en Línea', status: 'completed' as const, status_display: 'Completado',
  gateway: 'banorte', payment_status: 'success', gateway_tx_id: 'IK11ABCDEFGHIJ', payment_id: 91,
  banorte: {
    control_number: 'IK11ABCDEFGHIJ', referencia: '248233587990', codigo_aut: '214414', resultado: 'A' as const,
    mode: 'PRD', marca_tarjeta: 'VISA', verified_at: '2026-08-08T10:05:00Z', verified_by_name: 'Dirección',
    needs_verification: false,
  },
  created_at: '2026-08-08T10:00:00Z', processed_at: '2026-08-08T10:01:00Z',
  pos_loaded_at: null, pos_loaded_by_name: '', needs_pos_load: true,
  pos_unload_needed_at: null, pos_unloaded_at: null, pos_unloaded_by_name: '', needs_pos_unload: false,
};
const unloadRow = {
  ...loadRow, id: 22, student_name: 'Ana López', student_code: 'A-001', amount: '150.00', gateway_tx_id: 'IK22ABCDEFGHIJ',
  pos_loaded_at: '2026-08-08T11:00:00Z', needs_pos_load: false, pos_unload_needed_at: '2026-08-08T12:00:00Z', needs_pos_unload: true,
};
const officeRow = {
  ...loadRow, id: 33, student_name: 'Eva Ruiz', method: 'office' as const, method_display: 'Caja Escolar',
  status: 'pending' as const, status_display: 'Pendiente', gateway: '', needs_pos_load: false, amount: '100.00',
};

const user = (first: string, last: string) => ({
  id: 70, email: 'x@example.com', first_name: first, last_name: last, full_name: `${first} ${last}`, role: 'student' as const,
});
const balanceRow = (id: number, name: [string, string], balance: string) => ({
  id, balance, low_balance_threshold: '50.00', last_synced: '2026-09-20T10:00:00Z', is_low_balance: Number(balance) <= 50,
  student: { id: id + 100, student_id: `0${id}`, loyverse_code: `ci0${id}`, grade: '4° Primaria', group: 'A', status: 'active', user: user(...name) },
});

async function openTab(name: RegExp, route = '/admin/cafeteria') {
  const u = userEvent.setup();
  renderWithProviders(<AdminCafeteria />, { route });
  await u.click(await screen.findByRole('tab', { name }));
  return u;
}

beforeEach(() => {
  vi.clearAllMocks();
  stubViewport(1280);
  api.balances.mockResolvedValue(page([]));
  api.topups.mockImplementation(async (params) => {
    if (params?.needs_pos) return page([loadRow]);
    if (params?.needs_unload) return page([unloadRow]);
    return page([officeRow]);
  });
  markLoaded.mockResolvedValue(ok({ needs_pos_load: false }));
  markUnloaded.mockResolvedValue(ok({ needs_pos_unload: false }));
});

describe('AdminCafeteria Saldos (DataTable v2 + server filters)', () => {
  it('sends q, filters and ordering from the URL to the balances API', async () => {
    api.balances.mockResolvedValue(page([balanceRow(1, ['Ana', 'Alvarez'], '20.00')]));
    renderWithProviders(<AdminCafeteria />, { route: '/admin/cafeteria?q=ci09932&saldo=bajo&vinculo=sin&grado=4%C2%B0%20Primaria&orden=-balance' });
    expect(await screen.findByText('Ana Alvarez')).toBeInTheDocument();
    expect(api.balances).toHaveBeenCalledWith(expect.objectContaining({
      q: 'ci09932', low_balance: 'true', unlinked: 'true', grade: '4° Primaria', ordering: '-balance', page: 1,
    }));
    expect(screen.getByRole('columnheader', { name: /Saldo/ })).toHaveAttribute('aria-sort', 'descending');
  });

  it('"Toda la escuela" exports every wallet without the current filters', async () => {
    api.exportBalances.mockResolvedValue(ok(new Blob(['x'])));
    const u = userEvent.setup();
    renderWithProviders(<AdminCafeteria />, { route: '/admin/cafeteria?q=ana' });
    await u.click(await screen.findByRole('button', { name: /Toda la escuela/ }));
    await u.click(await screen.findByRole('menuitem', { name: /Excel/ }));
    await waitFor(() => expect(api.exportBalances).toHaveBeenCalledWith({ fmt: 'xlsx' }));
  });

  it('bulk "Cambiar umbral" asks the value, dry-runs with it, then commits (keyboard only)', async () => {
    api.balances.mockResolvedValue(page([balanceRow(1, ['Ana', 'Alvarez'], '20.00'), balanceRow(2, ['Beto', 'Rivera'], '90.00')]));
    api.bulkBalances.mockImplementation(async (body) =>
      ok({ action: body.action, requested: 1, ok: 1, failed: [], skipped: [], dry_run: !!body.dry_run }));
    const u = userEvent.setup();
    renderWithProviders(<AdminCafeteria />, { route: '/admin/cafeteria' });
    const box = await screen.findByRole('checkbox', { name: 'Seleccionar Ana Alvarez' });
    box.focus();
    await u.keyboard(' ');
    expect(box).toBeChecked();
    const bar = screen.getByRole('region', { name: 'Acciones en lote' });
    within(bar).getByRole('button', { name: 'Cambiar umbral' }).focus();
    await u.keyboard('{Enter}');
    const input = await screen.findByLabelText(/Nuevo umbral/);
    fireEvent.change(input, { target: { value: '80' } });
    await u.click(screen.getByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(api.bulkBalances).toHaveBeenCalledWith(expect.objectContaining({
      action: 'set_threshold', ids: [1], dry_run: true, payload: expect.objectContaining({ threshold: '80' }),
    })));
    const confirm = await screen.findByRole('button', { name: /Cambiar umbral \(1\)/ });
    await waitFor(() => expect(confirm).toHaveFocus());
    await u.keyboard('{Enter}');
    await waitFor(() => expect(api.bulkBalances).toHaveBeenLastCalledWith(expect.objectContaining({ dry_run: false, ids: [1] })));
  });

  it('ajuste masivo posts the notify/mirror flags the person chose', async () => {
    const upload = vi.fn().mockResolvedValue(ok({ dry_run: true, total_rows: 1, counts: { crear: 1, actualizar: 0, omitir: 0, error: 0 }, rows: [
      { line: 2, key: '09932', action: 'crear', errors: [], warnings: [], data: { alumno: 'Ana Alvarez', monto: '50.00', saldo_actual: '10.00', saldo_resultante: '60.00' } },
    ] }));
    vi.mocked(adjustmentImportApi).mockImplementation(() => ({ template: vi.fn(), upload }));
    const u = userEvent.setup();
    renderWithProviders(<AdminCafeteria />, { route: '/admin/cafeteria' });
    await u.click(await screen.findByRole('button', { name: /Ajuste masivo/ }));
    await u.click(screen.getByLabelText('Notificar a las familias'));
    expect(adjustmentImportApi).toHaveBeenLastCalledWith({ notify: false, mirror: true });
    const file = new File(['matricula,monto,motivo\n09932,50,Beca\n'], 'ajustes.csv', { type: 'text/csv' });
    const dialog = screen.getByRole('dialog');
    await u.upload(dialog.querySelector('input[type="file"]') as HTMLInputElement, file);
    expect(await within(dialog).findByText('$60.00')).toBeInTheDocument(); // resulting balance column
    expect(upload).toHaveBeenCalledWith(file, { dryRun: true });
  });
});

describe('AdminCafeteria Depósitos bulk apply', () => {
  it('shows the MXN total of the dry run before any money moves', async () => {
    api.bulkTopups.mockResolvedValue(ok({ action: 'apply', requested: 1, ok: 1, failed: [], skipped: [], dry_run: true, total: '100.00' }));
    const u = await openTab(/Depósitos/);
    await u.click(await screen.findByRole('button', { name: 'Aplicar depósito de Eva Ruiz' }));
    expect(await screen.findByText(/Total a acreditar/)).toHaveTextContent('$100.00');
    expect(api.bulkTopups).toHaveBeenCalledWith(expect.objectContaining({ action: 'apply', ids: [33], dry_run: true }));
  });
});

describe('AdminCafeteria Depósitos: Banorte operations', () => {
  const expiredRow = {
    ...loadRow, id: 44, student_name: 'Mía Soto', status: 'failed' as const, status_display: 'Fallido',
    payment_status: 'failed', needs_pos_load: false, processed_at: null, gateway_tx_id: '',
    banorte: {
      ...loadRow.banorte, control_number: 'IK44XYZ', referencia: '', codigo_aut: '', resultado: '' as const,
      verified_at: null, verified_by_name: '', needs_verification: false, failure_reason: 'expired' as const,
      failure_label: 'Expirado', review_reason: 'expiró sin respuesta de Banorte', can_reconcile: true,
      last_error: '', codigo_payw: '', texto: '', created_at: '2026-08-08T10:00:00Z',
    },
    payment_id: 94,
  };

  it('labels the failure cause, filters the review queue and reconciles from MultiCobros', async () => {
    api.topups.mockResolvedValue(page([expiredRow]));
    vi.mocked(paymentsApi.reconcileBanorte).mockResolvedValue(ok({ detail: 'settled', payment: {} }));
    const u = await openTab(/Depósitos/, '/admin/cafeteria?revisar=multicobros');
    expect(await screen.findByText('Expirado')).toBeInTheDocument();
    expect(screen.getByText('Por revisar en MultiCobros', { selector: 'span' })).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /Conciliar con MultiCobros el pago de Mía Soto/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('PAGO94')).toBeInTheDocument();
    await u.type(within(dialog).getByLabelText('Referencia Payworks'), '248233587990');
    await u.type(within(dialog).getByLabelText('Número de autorización'), '214414');
    await u.type(within(dialog).getByLabelText('Monto en MultiCobros'), '200.00');
    await u.click(within(dialog).getByRole('button', { name: 'Conciliar y acreditar' }));
    await waitFor(() => expect(paymentsApi.reconcileBanorte).toHaveBeenCalledWith(94, {
      outcome: 'approved', referencia: '248233587990', codigo_aut: '214414', amount: '200.00', note: '',
    }));
  });

  it('closes an operation that is not in MultiCobros with a note', async () => {
    api.topups.mockResolvedValue(page([expiredRow]));
    vi.mocked(paymentsApi.reconcileBanorte).mockResolvedValue(ok({ detail: 'closed', payment: {} }));
    const u = await openTab(/Depósitos/);
    await u.click(await screen.findByRole('button', { name: /Conciliar con MultiCobros el pago de Mía Soto/ }));
    const dialog = await screen.findByRole('dialog');
    await u.click(within(dialog).getByRole('radio', { name: /No aparece/ }));
    const submit = within(dialog).getByRole('button', { name: 'Marcar como no encontrada' });
    expect(submit).toBeDisabled();
    await u.type(within(dialog).getByLabelText('Nota'), 'Sin registro el 08/08');
    await u.click(submit);
    await waitFor(() => expect(paymentsApi.reconcileBanorte).toHaveBeenCalledWith(94, { outcome: 'not_found', note: 'Sin registro el 08/08' }));
  });

  it('marks simulated approvals as not to be loaded and labels the gateway', async () => {
    api.topups.mockResolvedValue(page([{
      ...loadRow, needs_pos_load: false, banorte: { ...loadRow.banorte, mode: 'AUT', simulation: true },
    }]));
    await openTab(/Depósitos/);
    expect(await screen.findByText('Simulación (no cargar)')).toBeInTheDocument();
    expect(screen.getByText('Banorte')).toBeInTheDocument();
    expect(screen.queryByText('banorte')).not.toBeInTheDocument();
  });
});

describe('AdminCafeteria Movimientos', () => {
  it('lists every student ledger and keeps refunds single-row with DEVOLVER', async () => {
    api.transactions.mockResolvedValue(page([{
      id: 55, student_id: 7, student_name: 'Luis López', student_code: '07', loyverse_code: 'ci07', type_display: 'Compra',
      transaction_type: 'purchase', amount: '25.00', description: 'Jugo', items: [], balance_after: '95.00',
      date: '2026-08-02T15:00:00Z', loyverse_receipt_id: 'r-1',
    }]));
    vi.mocked(cafeteriaApi.refundTransaction).mockResolvedValue(ok({}));
    const u = await openTab(/Movimientos/);
    expect(await screen.findByText('Jugo')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /Devolver movimiento 55/ }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /Procesar devolución/ });
    expect(confirm).toBeDisabled();
    await u.type(within(dialog).getByPlaceholderText('DEVOLVER'), 'DEVOLVER');
    await u.click(confirm);
    await waitFor(() => expect(cafeteriaApi.refundTransaction).toHaveBeenCalledWith(55, '', false));
  });

  it('a card top-up refund requires confirming the MultiCobros refund first', async () => {
    api.transactions.mockResolvedValue(page([{
      id: 56, student_id: 7, student_name: 'Luis López', student_code: '07', loyverse_code: 'ci07', type_display: 'Recarga',
      transaction_type: 'topup', amount: '200.00', description: 'Recarga cafetería', items: [], balance_after: '200.00',
      date: '2026-08-02T15:00:00Z', loyverse_receipt_id: 'topup-payment-91',
    }]));
    vi.mocked(cafeteriaApi.refundTransaction).mockResolvedValue(ok({}));
    const u = await openTab(/Movimientos/);
    await u.click(await screen.findByRole('button', { name: /Devolver movimiento 56/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/la devolución del cargo a la tarjeta se hace en/)).toBeInTheDocument();
    await u.type(within(dialog).getByPlaceholderText('DEVOLVER'), 'DEVOLVER');
    const confirm = within(dialog).getByRole('button', { name: /Procesar devolución/ });
    expect(confirm).toBeDisabled();
    await u.click(within(dialog).getByRole('checkbox', { name: /Ya hice la devolución del cargo en MultiCobros/ }));
    await u.click(confirm);
    await waitFor(() => expect(cafeteriaApi.refundTransaction).toHaveBeenCalledWith(56, '', true));
  });
});

describe('AdminCafeteria POS Loyverse queues', () => {
  it('lists load and unload queues on the POS tab', async () => {
    await openTab(/POS Loyverse/);
    expect(await screen.findByRole('heading', { name: 'Cargar en POS' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Quitar del POS' })).toBeInTheDocument();
    expect(await screen.findByText('Luis Pérez')).toBeInTheDocument();
    expect(await screen.findByText('Ana López')).toBeInTheDocument();
    expect(api.topups).toHaveBeenCalledWith(expect.objectContaining({ needs_pos: 1 }));
    expect(api.topups).toHaveBeenCalledWith(expect.objectContaining({ needs_unload: 1 }));
  });

  it('marks a top-up as loaded in Loyverse', async () => {
    const u = await openTab(/POS Loyverse/);
    await u.click(await screen.findByRole('button', { name: /Cargado en Loyverse/i }));
    await waitFor(() => expect(markLoaded).toHaveBeenCalledWith(11));
    expect(toastSuccess).toHaveBeenCalledWith('Marcado como cargado en Loyverse POS.');
  });

  it('marks a refunded top-up as unloaded from Loyverse', async () => {
    const u = await openTab(/POS Loyverse/);
    await u.click(await screen.findByRole('button', { name: /Quitado de Loyverse/i }));
    await waitFor(() => expect(markUnloaded).toHaveBeenCalledWith(22));
    expect(toastSuccess).toHaveBeenCalledWith('Marcado como quitado del POS de Loyverse.');
  });

  it('shows empty states when both queues are clear', async () => {
    api.topups.mockResolvedValue(page([]));
    await openTab(/POS Loyverse/);
    expect(await screen.findByText('Sin pendientes de carga en POS')).toBeInTheDocument();
    expect(screen.getByText('Sin pendientes de quitar del POS')).toBeInTheDocument();
  });

  it('asks staff to verify an unverified Banorte approval in MultiCobros first', async () => {
    const unverified = {
      ...loadRow, banorte: { ...loadRow.banorte, verified_at: null, verified_by_name: '', needs_verification: true },
    };
    api.topups.mockImplementation(async (params) => page((params as { needs_pos?: number }).needs_pos ? [unverified] : []));
    vi.mocked(paymentsApi.verifyBanorte).mockResolvedValue(ok({}));
    const u = await openTab(/POS Loyverse/);
    expect(await screen.findByText('Sin verificar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cargado en Loyverse/i })).not.toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /Verificar en MultiCobros/i }));
    const dialog = await screen.findByRole('dialog');
    // What staff search in MultiCobros: control number, PAGO id and date.
    expect(within(dialog).getByText('IK11ABCDEFGHIJ')).toBeInTheDocument();
    expect(within(dialog).getByText('PAGO91')).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: 'Sí, aparece aprobada' });
    expect(confirm).toBeDisabled();
    await u.type(within(dialog).getByLabelText('Referencia en MultiCobros'), '248233587990');
    await u.type(within(dialog).getByLabelText('Monto en MultiCobros'), '200');
    await u.click(confirm);
    await waitFor(() => expect(paymentsApi.verifyBanorte).toHaveBeenCalledWith(91, { referencia: '248233587990', amount: '200' }));
    expect(toastSuccess).toHaveBeenCalledWith('Operación verificada en MultiCobros.');
  });

  it('toasts an error when mark-loaded fails', async () => {
    markLoaded.mockRejectedValueOnce(new Error('boom'));
    const u = await openTab(/POS Loyverse/);
    await u.click(await screen.findByRole('button', { name: /Cargado en Loyverse/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('No se pudo marcar la recarga.'));
  });

  it('bulk-marks the selected load queue rows', async () => {
    api.bulkTopups.mockImplementation(async (body) =>
      ok({ action: body.action, requested: 1, ok: 1, failed: [], skipped: [], dry_run: !!body.dry_run }));
    const u = await openTab(/POS Loyverse/);
    await u.click(await screen.findByRole('checkbox', { name: 'Seleccionar recarga de Luis Pérez' }));
    await u.click(within(screen.getByRole('region', { name: 'Acciones en lote' })).getByRole('button', { name: 'Cargadas en POS' }));
    await waitFor(() => expect(api.bulkTopups).toHaveBeenCalledWith(expect.objectContaining({ action: 'pos_loaded', ids: [11], dry_run: true })));
  });
});

describe('AdminCafeteria Clientes Loyverse tab (every card, not only pupils)', () => {
  const getReceipts = vi.mocked(cafeteriaApi.getLoyverseCustomerReceipts);
  const staff = {
    loyverse_id: 's1', kind: 'staff' as const, kind_display: 'Personal', customer_code: '170',
    name: 'ZP-Rivero Montes de Oca Nadia', email: 'nrivero@interlaken.com.mx', phone_number: '',
    address_code: '', note: '', first_visit: null, last_visit: '2026-09-17T16:00:00Z',
    total_visits: 177, total_spent: '9000.00', total_points: '178.00', loyverse_created_at: null,
    loyverse_updated_at: null, synced_at: '2026-09-23T14:00:00Z', missing_since: null,
    student: null, receipts: 2,
  };
  const pupil = { ...staff, loyverse_id: 'p1', kind: 'student' as const, kind_display: 'Alumno',
    customer_code: 'ci10999', name: 'Perez Lopez Ana-1PRI', receipts: 0,
    student: { id: 7, name: 'Ana Perez Lopez', grade: '1° Primaria', group: '', student_id: '10999' } };

  beforeEach(() => {
    api.customers.mockResolvedValue(ok({
      count: 2, summary: { student: 1, staff: 1, test: 0, other: 0, missing: 0 }, results: [pupil, staff],
    }));
    getReceipts.mockResolvedValue(ok({ customer: staff, results: [
      { receipt_number: 'r-9', receipt_date: '2026-09-22T17:00:00Z', points: '45.00',
        items: 'Comida corrida, 2× Agua', receipt_type: 'SALE', resolved: false },
    ] }));
  });

  it('lists staff cards next to pupils with kind, balance and a receipts button (page_size 50)', async () => {
    renderWithProviders(<AdminCafeteria />, { route: '/admin/cafeteria?tab=customers&tipo=nonstudent' });
    expect(await screen.findByText('ZP-Rivero Montes de Oca Nadia')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Personal')).toBeInTheDocument();
    expect(within(table).getAllByText('$178.00')).toHaveLength(2);
    expect(screen.getByText(/2 tarjeta\(s\) en Loyverse/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver alumno' })).toHaveAttribute('href', '/admin/cafeteria/7');
    expect(api.customers).toHaveBeenCalledWith(expect.objectContaining({ page_size: 50, kind: 'nonstudent' }));
  });

  it('opens the receipts of a staff card', async () => {
    renderWithProviders(<AdminCafeteria />, { route: '/admin/cafeteria?tab=customers' });
    await userEvent.click(await screen.findByRole('button', { name: /Ver compras de ZP-Rivero/ }));
    expect(await screen.findByText('Comida corrida, 2× Agua')).toBeInTheDocument();
    expect(getReceipts).toHaveBeenCalledWith('s1');
  });
});

describe('AdminCafeteria Reconciliación', () => {
  it('runs only on demand, then bulk-fixes the selected rows', async () => {
    api.reconcile.mockResolvedValue(ok({
      count: 1, total: 1, checked: 1, drift_count: 1, has_more: false, offset: 0, limit: 20,
      results: [{ student_id: 5, student_name: 'Iván Soto', student_code: '05', loyverse_id: 'l5', local_balance: '80.00', loyverse_balance: '65.00', drift: '15.00', in_sync: false, error: null }],
    }));
    api.bulkReconcile.mockImplementation(async (body) =>
      ok({ action: 'fix', requested: 1, ok: 1, failed: [], skipped: [], dry_run: !!body.dry_run }));
    const u = await openTab(/Reconciliación/);
    expect(api.reconcile).not.toHaveBeenCalled();
    await u.click(screen.getByRole('button', { name: /Reconciliar/ }));
    expect(await screen.findByText('Iván Soto')).toBeInTheDocument();
    expect(api.reconcile).toHaveBeenCalledWith(expect.objectContaining({ only: 'drift', page: 1 }));
    await u.click(screen.getByRole('checkbox', { name: 'Seleccionar Iván Soto' }));
    await u.click(within(screen.getByRole('region', { name: 'Acciones en lote' })).getByRole('button', { name: 'Corregir' }));
    await waitFor(() => expect(api.bulkReconcile).toHaveBeenCalledWith(expect.objectContaining({ action: 'fix', ids: [5], dry_run: true })));
  });
});
