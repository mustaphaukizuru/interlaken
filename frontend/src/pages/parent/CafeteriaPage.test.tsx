import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';

vi.mock('@/services/api', () => ({
  downloadBlob: vi.fn(),
  cafeteriaApi: {
    getMyBalance: vi.fn(),
    getTransactions: vi.fn(),
    exportMyTransactions: vi.fn(),
    requestTopUp: vi.fn(),
    // Rendered by the embedded category-breakdown card; resolve empty so it
    // doesn't error the query in these state tests.
    getSpendingCategories: vi.fn().mockResolvedValue({
      data: { days: 30, total: 0, categories: [] },
    }),
    updateLowBalanceThreshold: vi.fn(),
    updateSpendLimits: vi.fn(),
  },
  paymentsApi: {
    reportBanorteResult: vi.fn(),
    getAvailability: vi.fn().mockResolvedValue({ data: { online: true, test_mode: false } }),
  },
}));

vi.mock('@/lib/banorteCheckout', () => ({
  openBanorteLightbox: vi.fn(),
  closeBanorteLightbox: vi.fn(),
}));

import CafeteriaPage from './CafeteriaPage';
import { cafeteriaApi, downloadBlob, paymentsApi } from '@/services/api';
import { closeBanorteLightbox, openBanorteLightbox, type BanorteEvent } from '@/lib/banorteCheckout';
import { renderWithProviders } from '@/test/renderWithProviders';
import { useSelectedChildStore } from '@/store/selectedChildStore';

const mockedBalance = vi.mocked(cafeteriaApi.getMyBalance);
const mockedTx = vi.mocked(cafeteriaApi.getTransactions);
const mockedExport = vi.mocked(cafeteriaApi.exportMyTransactions);

function LocationProbe() {
  const { search } = useLocation();
  return <output data-testid="location">{search}</output>;
}
const urlParams = () => new URLSearchParams(screen.getByTestId('location').textContent ?? '');

function PathProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="path">{pathname + search}</output>;
}

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

  it('prefills and opens the top-up modal from a ?recarga deep link', async () => {
    // Dashboard quick chips navigate to /portal/cafeteria?recarga=<monto>; the
    // page must honor the prefill: modal open, amount already set.
    mockedBalance.mockResolvedValue({ data: [account] } as never);
    mockedTx.mockResolvedValue({ data: { results: [], count: 0 } } as never);

    renderWithProviders(<CafeteriaPage />, { route: '/portal/cafeteria?recarga=200' });

    expect(await screen.findByRole('dialog', { name: 'Recargar cafetería' })).toBeInTheDocument();
    expect(screen.getByLabelText('Monto (MXN)')).toHaveValue(200);
  });

  it('ignores an out-of-range ?recarga deep link', async () => {
    mockedBalance.mockResolvedValue({ data: [account] } as never);
    mockedTx.mockResolvedValue({ data: { results: [], count: 0 } } as never);

    renderWithProviders(<CafeteriaPage />, { route: '/portal/cafeteria?recarga=99999' });

    expect(await screen.findByText('Historial de movimientos')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows Recargar for a linked cafeteria account', async () => {
    mockedBalance.mockResolvedValue({ data: [account] } as never);
    mockedTx.mockResolvedValue({ data: { results: [], count: 0 } } as never);

    renderWithProviders(<CafeteriaPage />, { route: '/portal/cafeteria' });

    // Two Recargar affordances for a linked account: the top-up CTA and the
    // empty-movements action that scrolls to it.
    expect((await screen.findAllByRole('button', { name: /Recargar/i })).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/aún no está vinculado a cafetería\/Loyverse/i)).toBeNull();
  });
});

describe('CafeteriaPage history: URL filters, sort and export (Data Ops Phase 9)', () => {
  const sibling = { ...account, id: 3, student: { ...account.student, id: 12, user: { full_name: 'Leo Quintana' } } };
  const oneRow = {
    data: { count: 1, results: [{
      id: 1, transaction_type: 'purchase', amount: '25.00',
      date: '2026-09-10T12:00:00Z', balance_after: '125.00', items: [],
    }] },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useSelectedChildStore.setState({ childId: null });
  });

  it('reads tipo/desde/hasta/orden/page from the URL into the API call', async () => {
    mockedBalance.mockResolvedValue({ data: [account] } as never);
    mockedTx.mockResolvedValue(oneRow as never);

    renderWithProviders(<CafeteriaPage />, {
      route: '/portal/cafeteria?tipo=topup&desde=2026-09-01&hasta=2026-09-30&orden=-amount&page=2',
    });

    await waitFor(() => expect(mockedTx).toHaveBeenCalledWith({
      student: undefined, type: 'topup', from: '2026-09-01', to: '2026-09-30', ordering: '-amount', page: 2,
    }));
    expect(screen.getByRole('button', { name: 'Ordenar por Monto, descendente' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('ignores a sort key the API does not whitelist', async () => {
    mockedBalance.mockResolvedValue({ data: [account] } as never);
    mockedTx.mockResolvedValue(oneRow as never);

    renderWithProviders(<CafeteriaPage />, { route: '/portal/cafeteria?orden=-student__user__password' });

    await waitFor(() => expect(mockedTx).toHaveBeenCalled());
    expect(mockedTx).toHaveBeenLastCalledWith(expect.objectContaining({ ordering: undefined }));
  });

  it('cycles the sort desc → asc → default, writing ?orden= and resetting the page', async () => {
    mockedBalance.mockResolvedValue({ data: [account] } as never);
    mockedTx.mockResolvedValue(oneRow as never);

    renderWithProviders(<><CafeteriaPage /><LocationProbe /></>, { route: '/portal/cafeteria?page=3' });
    await screen.findByText('1 movimiento');

    await userEvent.click(screen.getByRole('button', { name: 'Ordenar por Saldo' }));
    await waitFor(() => expect(urlParams().get('orden')).toBe('-balance'));
    expect(urlParams().get('page')).toBeNull();
    await waitFor(() => expect(mockedTx).toHaveBeenLastCalledWith(expect.objectContaining({ ordering: '-balance', page: 1 })));

    await userEvent.click(screen.getByRole('button', { name: /Ordenar por Saldo, descendente/ }));
    await waitFor(() => expect(urlParams().get('orden')).toBe('balance'));

    await userEvent.click(screen.getByRole('button', { name: /Ordenar por Saldo, ascendente/ }));
    await waitFor(() => expect(urlParams().get('orden')).toBeNull());
    await waitFor(() => expect(mockedTx).toHaveBeenLastCalledWith(expect.objectContaining({ ordering: undefined })));
  });

  it('writes the type filter and the date preset to the URL', async () => {
    mockedBalance.mockResolvedValue({ data: [account] } as never);
    mockedTx.mockResolvedValue(oneRow as never);

    renderWithProviders(<><CafeteriaPage /><LocationProbe /></>, { route: '/portal/cafeteria' });
    await screen.findByText('1 movimiento');

    await userEvent.selectOptions(screen.getByLabelText('Filtrar por tipo'), 'refund');
    await waitFor(() => expect(urlParams().get('tipo')).toBe('refund'));
    await userEvent.click(screen.getByRole('button', { name: 'Este mes' }));
    await waitFor(() => expect(urlParams().get('desde')).toMatch(/^\d{4}-\d{2}-01$/));
    expect(urlParams().get('hasta')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await waitFor(() => expect(mockedTx).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'refund' })));
  });

  it('selects the child named by ?alumno= and mirrors the child filter back into the URL', async () => {
    mockedBalance.mockResolvedValue({ data: [account, sibling] } as never);
    mockedTx.mockResolvedValue(oneRow as never);

    renderWithProviders(<><CafeteriaPage /><LocationProbe /></>, { route: '/portal/cafeteria?alumno=12' });

    await waitFor(() => expect(mockedTx).toHaveBeenLastCalledWith(expect.objectContaining({ student: 12 })));
    expect(useSelectedChildStore.getState().childId).toBe(12);

    await userEvent.selectOptions(screen.getByLabelText('Filtrar por alumno'), 'all');
    await waitFor(() => expect(urlParams().get('alumno')).toBeNull());
    await waitFor(() => expect(mockedTx).toHaveBeenLastCalledWith(expect.objectContaining({ student: undefined })));
  });

  it('exports exactly the filtered, sorted view in the chosen format', async () => {
    mockedBalance.mockResolvedValue({ data: [account] } as never);
    mockedTx.mockResolvedValue(oneRow as never);
    const blob = new Blob(['x']);
    mockedExport.mockResolvedValue({ data: blob } as never);

    renderWithProviders(<CafeteriaPage />, { route: '/portal/cafeteria?tipo=purchase&orden=amount&page=2' });
    await screen.findByText(/1 movimiento/);

    await userEvent.click(screen.getByRole('button', { name: 'Descargar movimientos en Excel' }));

    await waitFor(() => expect(mockedExport).toHaveBeenCalledWith({
      fmt: 'xlsx', student: undefined, type: 'purchase', from: undefined, to: undefined, ordering: 'amount',
    }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(
      blob, expect.stringMatching(/^movimientos_cafeteria_\d{4}-\d{2}-\d{2}\.xlsx$/),
    ));
  });
});

describe('CafeteriaPage online top-up through the Banorte lightbox', () => {
  const lightbox = {
    kind: 'lightbox' as const, params: 'RSA:::AES', env: 'pro', control_number: 'IK55ABCDEFGHIJ',
    script_url: 'https://multicobros.banorte.com/orquestador/lightbox/checkoutV2.js',
    jquery_url: 'https://multicobros.banorte.com/orquestador/resources/js/jquery-3.3.1.js',
  };
  let emit: (event: BanorteEvent, response: unknown) => void = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
    useSelectedChildStore.setState({ childId: null });
    mockedBalance.mockResolvedValue({ data: [account] } as never);
    mockedTx.mockResolvedValue({ data: { results: [], count: 0 } } as never);
    vi.mocked(cafeteriaApi.requestTopUp).mockResolvedValue(
      { data: { id: 1, payment_id: 55, checkout: lightbox } } as never);
    vi.mocked(openBanorteLightbox).mockImplementation(async (_start, onEvent) => { emit = onEvent; });
  });

  async function payOnline() {
    const u = userEvent.setup();
    renderWithProviders(<><CafeteriaPage /><PathProbe /></>, { route: '/portal/cafeteria?recarga=200' });
    await screen.findByRole('dialog', { name: 'Recargar cafetería' });
    await u.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByText(/Pago seguro con Banorte/)).toBeInTheDocument();
    expect(screen.queryByText(/Global Payments/)).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Continuar' }));
    await u.click(screen.getByRole('button', { name: 'Ir a pagar' }));
    await waitFor(() => expect(openBanorteLightbox).toHaveBeenCalledWith(lightbox, expect.any(Function)));
    expect(cafeteriaApi.requestTopUp).toHaveBeenCalledWith(10, 200, 'online');
  }

  it('forwards an approval to the backend, then shows the return page', async () => {
    vi.mocked(paymentsApi.reportBanorteResult).mockResolvedValue({ data: { status: 'success' } } as never);
    await payOnline();
    emit('success', { data: 'cipher', status3D: '200' });
    await waitFor(() => expect(paymentsApi.reportBanorteResult)
      .toHaveBeenCalledWith(55, 'success', { data: 'cipher', status3D: '200' }));
    await waitFor(() => expect(screen.getByTestId('path'))
      .toHaveTextContent('/portal/cafeteria/recarga/retorno?payment_id=55'));
    expect(closeBanorteLightbox).toHaveBeenCalled();
  });

  it('stays on the page when the window is closed without a result', async () => {
    vi.mocked(paymentsApi.reportBanorteResult).mockResolvedValue({ data: { status: 'pending' } } as never);
    await payOnline();
    emit('closed', { id: 0, message: 'frameClosedbyUser' });
    await waitFor(() => expect(paymentsApi.reportBanorteResult).toHaveBeenCalledWith(55, 'closed', expect.anything()));
    expect(screen.getByTestId('path').textContent).toBe('/portal/cafeteria');
    expect(closeBanorteLightbox).not.toHaveBeenCalled();
  });
});

describe('CafeteriaPage when card payment is not open yet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSelectedChildStore.setState({ childId: null });
    mockedBalance.mockResolvedValue({ data: [account] } as never);
    mockedTx.mockResolvedValue({ data: { results: [], count: 0 } } as never);
    vi.mocked(paymentsApi.getAvailability).mockResolvedValueOnce(
      { data: { online: false, test_mode: true } } as never);
  });

  it('offers only the school cashier and requests an office top-up', async () => {
    vi.mocked(cafeteriaApi.requestTopUp).mockResolvedValue({ data: { id: 2 } } as never);
    const u = userEvent.setup();
    renderWithProviders(<CafeteriaPage />, { route: '/portal/cafeteria?recarga=200' });
    await screen.findByRole('dialog', { name: 'Recargar cafetería' });
    await u.click(screen.getByRole('button', { name: 'Continuar' }));
    // Banorte stays visible but disabled until it opens to this family.
    expect(await screen.findByLabelText('Pago en línea con tarjeta (Banorte)')).toBeDisabled();
    expect(screen.getByText('Próximamente')).toBeInTheDocument();
    expect(screen.getByLabelText('Pago en caja escolar')).toBeChecked();
    await u.click(screen.getByRole('button', { name: 'Continuar' }));
    await u.click(screen.getByRole('button', { name: 'Solicitar recarga' }));
    await waitFor(() => expect(cafeteriaApi.requestTopUp).toHaveBeenCalledWith(10, 200, 'office'));
    expect(openBanorteLightbox).not.toHaveBeenCalled();
  });
});

describe('CafeteriaPage during Banorte certification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSelectedChildStore.setState({ childId: null });
    mockedBalance.mockResolvedValue({ data: [account] } as never);
    mockedTx.mockResolvedValue({ data: { results: [], count: 0 } } as never);
    vi.mocked(paymentsApi.getAvailability).mockResolvedValueOnce(
      { data: { online: true, test_mode: false, certification: true } } as never);
  });

  it('warns the tester that the charge is real', async () => {
    const u = userEvent.setup();
    renderWithProviders(<CafeteriaPage />, { route: '/portal/cafeteria?recarga=200' });
    await screen.findByRole('dialog', { name: 'Recargar cafetería' });
    await u.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByText(/Certificación Banorte: cargo real a la tarjeta/)).toBeInTheDocument();
    expect(screen.queryByText(/Modo de prueba Banorte/)).toBeNull();
  });
});
