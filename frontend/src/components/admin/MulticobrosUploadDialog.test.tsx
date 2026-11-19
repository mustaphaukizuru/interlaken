import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';

vi.mock('@/services/api', () => ({
  api: { post: vi.fn() },
  paymentsApi: { verifyBanorte: vi.fn(), reconcileBanorte: vi.fn() },
}));

vi.mock('@/services/multicobrosUpload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/multicobrosUpload')>();
  return { ...actual, multicobrosUploadApi: { upload: vi.fn() } };
});

vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), loading: vi.fn(() => 'id') });
  return { default: t };
});

import MulticobrosUploadDialog from './MulticobrosUploadDialog';
import { multicobrosUploadApi, type McOutcome, type McReport, type McRow } from '@/services/multicobrosUpload';
import { paymentsApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';

const upload = vi.mocked(multicobrosUploadApi.upload);
const ok = (data: unknown) => ({ data }) as never;

// Invented data only.
function row(outcome: McOutcome, over: Partial<McRow> = {}): McRow {
  return {
    line: 2, control_number: 'IK41TST000001', pago_id: 41, student_name: 'Luis Pérez', student_code: '09938',
    amount: '200.00', date: '2026-11-18', time: '09:15', outcome, message: 'Aprobada en MultiCobros.',
    card_last4: '9876', tipo: 'Venta', resultado: 'A', apply_state: '', prefill: null, reconcile: null, ...over,
  };
}

const COUNTS = Object.fromEntries(
  ['verificar', 'ya_verificada', 'diferencia', 'por_conciliar', 'no_aprobada_en_multicobros', 'devolucion',
    'rechazada', 'sin_pago', 'simulacion', 'no_aparece'].map((k) => [k, 0]),
) as Record<McOutcome, number>;

const preview: McReport = {
  dry_run: true, total_rows: 4, date_from: '2026-11-18', date_to: '2026-11-18',
  counts: { ...COUNTS, verificar: 2, diferencia: 1, por_conciliar: 1, no_aparece: 1 },
  rows: [
    row('verificar'),
    row('verificar', { line: 3, control_number: 'IK42TST000002', pago_id: 42, student_name: 'Ana Ruiz', amount: '120.00' }),
    row('diferencia', {
      line: 4, control_number: 'IK43TST000003', pago_id: 43, student_name: 'Eva Soto', amount: '250.00',
      message: 'El monto no coincide: MultiCobros $200.00, plataforma $250.00. No lo cargue en el POS y avise a dirección.',
    }),
    row('por_conciliar', {
      line: 5, control_number: 'IK44TST000004', pago_id: 44, student_name: 'Iván Mora', amount: '180.00',
      message: 'MultiCobros la muestra aprobada, pero aquí quedó sin acreditar (expiró).',
      prefill: { referencia: '700000000123', codigo_aut: '0A1B2C', amount: '180.00' },
      reconcile: {
        control_number: 'IK44TST000004', created_at: '2026-11-18T15:00:00Z', mode: 'PRD',
        review_reason: 'expiró sin respuesta de Banorte', failure_label: 'Expirado', last_error: '', amount: '180.00',
      },
    }),
    row('no_aparece', { line: null, control_number: 'IK45TST000005', pago_id: 45, student_name: 'Sara Gil', message: 'Banorte no muestra este cobro en el reporte: no lo cargue en el POS.' }),
  ],
};

const result: McReport = {
  ...preview, dry_run: false, verified: 2, applied: 1, waiting: 1,
  rows: preview.rows.map((r) => (r.outcome !== 'verificar' ? r : r.pago_id === 41
    ? { ...r, apply_state: 'applied', message: 'Verificada y aplicada (ya estaba en Loyverse, saldo $203.00).' }
    : { ...r, apply_state: 'waiting_pos', message: 'Verificada: se aplica sola cuando esté cargada en el POS de Loyverse.' })),
};

function xlsx(name = 'MovimientosPayworks_export_7.xlsx', size = 2048) {
  return new File([new Uint8Array(size)], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function axiosError(status: number, data: unknown) {
  return Object.assign(new Error('Request failed'), { isAxiosError: true, response: { status, data } });
}

async function chooseAndReview(u: ReturnType<typeof userEvent.setup>, file = xlsx()) {
  await u.upload(screen.getByLabelText(/Elegir el reporte de MultiCobros/), file);
  await u.click(screen.getByRole('button', { name: /Revisar reporte/ }));
  return file;
}

describe('MulticobrosUploadDialog («Subir reporte de MultiCobros»)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubViewport(1440);
  });

  it('shows where to export, the formats and the size, then previews without writing', async () => {
    upload.mockResolvedValueOnce(ok(preview));
    const u = userEvent.setup();
    renderWithProviders(<MulticobrosUploadDialog open onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Subir reporte de MultiCobros' });
    expect(within(dialog).getByText(/Analítica → Reportes → Transacciones Payworks 2 → Exportar/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Acepta .xlsx o .csv, hasta 2 MB/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Revisar reporte/ })).toBeDisabled();

    const file = await chooseAndReview(u);
    expect(upload).toHaveBeenCalledWith(file, { dryRun: true });
    expect(await screen.findByRole('heading', { name: 'Revise antes de verificar' })).toBeInTheDocument();
    expect(screen.getByText(/4 operaciones del 18 nov 2026/)).toBeInTheDocument();
    // The action cards first; a problem is said in words, not colour alone.
    const cards = within(screen.getByRole('group', { name: 'Filtrar por resultado' })).getAllByRole('button');
    expect(cards.map((c) => c.textContent)).toEqual([
      '2Se verificarán', '1Requieren conciliación', '1Diferencias', '1Banorte no muestra', '0Ya verificadas', '0Otros',
    ]);
    expect(screen.getByRole('alert')).toHaveTextContent('2 pagos no coinciden con MultiCobros.');
    expect(screen.getAllByText(/El monto no coincide: MultiCobros \$200.00, plataforma \$250.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Tarjeta ···· 9876/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Verificar 2 pagos/ })).toBeEnabled();
  });

  it('a stat card filters the table and says so (aria-pressed)', async () => {
    upload.mockResolvedValueOnce(ok(preview));
    const u = userEvent.setup();
    renderWithProviders(<MulticobrosUploadDialog open onClose={vi.fn()} />);
    await chooseAndReview(u);
    const card = await screen.findByRole('button', { name: /1\s*Diferencias/ });
    await u.click(card);
    expect(card).toHaveAttribute('aria-pressed', 'true');
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(2); // header + Eva
    expect(within(table).getByText('Eva Soto')).toBeInTheDocument();
    expect(screen.getByText('Mostrando 1 operación de 5.')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Ver todas' }));
    expect(card).toHaveAttribute('aria-pressed', 'false');
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(6);
  });

  it('«Verificar 2 pagos» re-sends the same file and shows verified, applied and waiting', async () => {
    upload.mockResolvedValueOnce(ok(preview)).mockResolvedValueOnce(ok(result));
    const onClose = vi.fn();
    const u = userEvent.setup();
    renderWithProviders(<MulticobrosUploadDialog open onClose={onClose} />);
    const file = await chooseAndReview(u);
    await u.click(await screen.findByRole('button', { name: /Verificar 2 pagos/ }));

    expect(upload).toHaveBeenLastCalledWith(file, { dryRun: false });
    expect(upload.mock.calls[1][0]).toBe(file);
    expect(await screen.findByRole('heading', { name: '2 pagos verificados en MultiCobros.' })).toBeInTheDocument();
    expect(screen.getByText(/1 ya estaba en Loyverse y se aplicó al saldo/)).toBeInTheDocument();
    expect(screen.getByText(/1 se aplica solo en cuanto los cargue en el POS/)).toBeInTheDocument();
    const cards = within(screen.getByRole('group', { name: 'Filtrar el resultado' })).getAllByRole('button');
    expect(cards.map((c) => c.textContent)).toEqual([
      '2Verificados', '1Aplicados al saldo (ya en Loyverse)', '1Esperan la carga en el POS', '3Requieren atención',
    ]);
    const step = screen.getByRole('list', { name: 'Pasos' });
    expect(within(step).getByText('Listo').closest('li')).toHaveAttribute('aria-current', 'step');

    await u.click(screen.getByRole('link', { name: 'Ir a «Por aplicar»' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('the commit cannot be sent twice and shows «Verificando…»', async () => {
    let finish: (v: unknown) => void = () => {};
    upload.mockResolvedValueOnce(ok(preview)).mockImplementationOnce(() => new Promise((r) => { finish = r; }) as never);
    const u = userEvent.setup();
    renderWithProviders(<MulticobrosUploadDialog open onClose={vi.fn()} />);
    await chooseAndReview(u);
    const button = await screen.findByRole('button', { name: /Verificar 2 pagos/ });
    await u.click(button);
    const busy = screen.getByRole('button', { name: /Verificando…/ });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(upload).toHaveBeenCalledTimes(2);
    finish(ok(result));
    expect(await screen.findByRole('heading', { name: /pagos verificados/ })).toBeInTheDocument();
  });

  it('Escape during the commit asks first', async () => {
    upload.mockResolvedValueOnce(ok(preview)).mockImplementationOnce(() => new Promise(() => {}) as never);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onClose = vi.fn();
    const u = userEvent.setup();
    renderWithProviders(<MulticobrosUploadDialog open onClose={onClose} />);
    await chooseAndReview(u);
    await u.click(await screen.findByRole('button', { name: /Verificar 2 pagos/ }));
    await u.keyboard('{Escape}');
    expect(confirm).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('«Atrás» returns to the file without losing it, and «Continuar» does not upload again', async () => {
    upload.mockResolvedValueOnce(ok(preview));
    const u = userEvent.setup();
    renderWithProviders(<MulticobrosUploadDialog open onClose={vi.fn()} />);
    await chooseAndReview(u);
    await u.click(await screen.findByRole('button', { name: /Atrás/ }));
    expect(screen.getByText('MovimientosPayworks_export_7.xlsx')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByRole('heading', { name: 'Revise antes de verificar' })).toBeInTheDocument();
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('nothing to verify: the button is disabled and says why', async () => {
    upload.mockResolvedValueOnce(ok({ ...preview, counts: { ...COUNTS, ya_verificada: 1 }, rows: [row('ya_verificada')] }));
    const u = userEvent.setup();
    renderWithProviders(<MulticobrosUploadDialog open onClose={vi.fn()} />);
    await chooseAndReview(u);
    const button = await screen.findByRole('button', { name: /Verificar 0 pagos/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/No hay pagos para verificar/);
  });

  it('«Conciliar» opens the reconcile dialog with the report values, and Escape closes only it', async () => {
    upload.mockResolvedValueOnce(ok(preview));
    vi.mocked(paymentsApi.reconcileBanorte).mockResolvedValue(ok({ detail: 'settled', payment: {} }));
    const u = userEvent.setup();
    renderWithProviders(<MulticobrosUploadDialog open onClose={vi.fn()} />);
    await chooseAndReview(u);
    await u.click(await screen.findByRole('button', { name: 'Conciliar con MultiCobros el pago de Iván Mora' }));
    const inner = await screen.findByRole('dialog', { name: 'Conciliar con MultiCobros' });
    expect(within(inner).getByLabelText('Referencia Payworks')).toHaveValue('700000000123');
    expect(within(inner).getByLabelText('Número de autorización')).toHaveValue('0A1B2C');
    expect(within(inner).getByLabelText('Monto en MultiCobros')).toHaveValue('180.00');

    await u.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Conciliar con MultiCobros' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Subir reporte de MultiCobros' })).toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: 'Conciliar con MultiCobros el pago de Iván Mora' }));
    await u.click(within(await screen.findByRole('dialog', { name: 'Conciliar con MultiCobros' })).getByRole('button', { name: 'Conciliar y acreditar' }));
    await waitFor(() => expect(paymentsApi.reconcileBanorte).toHaveBeenCalledWith(44, expect.objectContaining({
      outcome: 'approved', referencia: '700000000123', codigo_aut: '0A1B2C', amount: '180.00',
    })));
    expect(await screen.findAllByText('Conciliada')).not.toHaveLength(0);
  });

  it('a wrong file is refused before uploading, with what to do next', async () => {
    const u = userEvent.setup({ applyAccept: false });
    renderWithProviders(<MulticobrosUploadDialog open onClose={vi.fn()} />);
    await u.upload(screen.getByLabelText(/Elegir el reporte de MultiCobros/), xlsx('export.xls'));
    expect(screen.getByRole('alert')).toHaveTextContent('Formato no compatible (.xls)');
    expect(screen.getByRole('alert')).toHaveTextContent('Qué hacer: En MultiCobros exporte el reporte en .xlsx o .csv');
    expect(screen.getByRole('button', { name: /Revisar reporte/ })).toBeDisabled();

    await u.upload(screen.getByLabelText(/Elegir el reporte de MultiCobros/), xlsx('grande.xlsx', 3 * 1024 * 1024));
    expect(screen.getByRole('alert')).toHaveTextContent('El archivo es demasiado grande');
    expect(upload).not.toHaveBeenCalled();
  });

  it('the server refusing another afiliación says what to do', async () => {
    upload.mockRejectedValueOnce(axiosError(400, { detail: 'Este reporte es de otra afiliación.', code: 'other_merchant' }));
    const u = userEvent.setup();
    renderWithProviders(<MulticobrosUploadDialog open onClose={vi.fn()} />);
    await chooseAndReview(u);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Este reporte es de otra afiliación');
    expect(alert).toHaveTextContent('En MultiCobros elija la afiliación del colegio');
    expect(screen.getByRole('list', { name: 'Pasos' }).querySelector('[aria-current="step"]')).toHaveTextContent('Elegir archivo');
  });

  it('every step passes axe (serious and critical)', async () => {
    upload.mockResolvedValueOnce(ok(preview)).mockResolvedValueOnce(ok(result));
    const u = userEvent.setup();
    const { container } = renderWithProviders(<MulticobrosUploadDialog open onClose={vi.fn()} />);
    const gating = async () => (await axe(container)).violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
    expect(await gating()).toEqual([]);
    await chooseAndReview(u);
    await screen.findByRole('heading', { name: 'Revise antes de verificar' });
    expect(await gating()).toEqual([]);
    await u.click(screen.getByRole('button', { name: /Verificar 2 pagos/ }));
    await screen.findByRole('heading', { name: /pagos verificados/ });
    expect(await gating()).toEqual([]);
  });

  it('phones get one card per operation instead of the table', async () => {
    stubViewport(390);
    upload.mockResolvedValueOnce(ok(preview));
    const u = userEvent.setup();
    renderWithProviders(<MulticobrosUploadDialog open onClose={vi.fn()} />);
    await chooseAndReview(u);
    const cards = await screen.findByRole('list', { name: 'Operaciones del reporte' });
    expect(within(cards).getAllByRole('listitem')).toHaveLength(5);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    // The reason is on the card itself, with the badge's words.
    const eva = within(cards).getByText('Eva Soto').closest('li')!;
    expect(within(eva).getByText('Diferencia')).toBeInTheDocument();
    expect(within(eva).getByText(/El monto no coincide/)).toBeInTheDocument();
    expect(within(cards).getByRole('button', { name: 'Conciliar con MultiCobros el pago de Iván Mora' })).toBeInTheDocument();
  });
});
