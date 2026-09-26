import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/services/api', () => ({
  paymentsApi: { getMyPayments: vi.fn(), getSummary: vi.fn(async () => ({ data: null })), exportMyPayments: vi.fn() },
  downloadBlob: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { loading: vi.fn(() => 't'), success: vi.fn(), error: vi.fn() }),
}));

import toast from 'react-hot-toast';
import PaymentsPage from './PaymentsPage';
import { downloadBlob, paymentsApi } from '@/services/api';

const mockedPayments = vi.mocked(paymentsApi.getMyPayments);
const mockedExport = vi.mocked(paymentsApi.exportMyPayments);

function LocationProbe() {
  const { search } = useLocation();
  return <output data-testid="location">{search}</output>;
}
const urlParams = () => new URLSearchParams(screen.getByTestId('location').textContent ?? '');

function renderPage(route = '/portal/pagos') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <PaymentsPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const paid = {
  id: 1, status: 'success', payment_type: 'cafeteria',
  amount: '150.00', currency: 'MXN', created_at: '2026-09-10T12:00:00Z',
};

describe('PaymentsPage URL params, sort, date range and export (Data Ops Phase 9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPayments.mockResolvedValue({ data: { count: 1, results: [paid] } } as never);
  });

  it('sends estado/alumno/desde/hasta/orden/page from the URL to the API', async () => {
    renderPage('/portal/pagos?estado=success&alumno=7&desde=2026-09-01&hasta=2026-09-15&orden=amount&page=2');
    await waitFor(() => expect(mockedPayments).toHaveBeenCalledWith({
      page: 2, status: 'success', student: '7', from: '2026-09-01', to: '2026-09-15', ordering: 'amount',
    }));
    expect(screen.getByRole('button', { name: 'Ordenar por Monto, ascendente' })).toHaveAttribute('aria-pressed', 'true');
    // Chips read DD/MM/YYYY, not ISO.
    expect(screen.getByRole('button', { name: 'Quitar filtro: Fechas: 01/09/2026 a 15/09/2026' })).toBeInTheDocument();
  });

  it('sorts by estado through ?orden= and resets the page', async () => {
    renderPage('/portal/pagos?page=4');
    await screen.findByText('Completado', { selector: 'span' });
    await userEvent.click(screen.getByRole('button', { name: 'Ordenar por Estado' }));
    await waitFor(() => expect(urlParams().get('orden')).toBe('-status'));
    expect(urlParams().get('page')).toBeNull();
    await waitFor(() => expect(mockedPayments).toHaveBeenLastCalledWith(expect.objectContaining({ ordering: '-status', page: 1 })));
  });

  it('uses the DateRangeFilter presets instead of raw inputs', async () => {
    renderPage();
    await screen.findByText('Completado', { selector: 'span' });
    await userEvent.click(screen.getByRole('button', { name: 'Ciclo escolar' }));
    await waitFor(() => expect(urlParams().get('desde')).toMatch(/^\d{4}-08-01$/));
    expect(screen.getByLabelText('Desde')).toHaveValue(urlParams().get('desde'));
    await waitFor(() => expect(mockedPayments).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: urlParams().get('desde') }),
    ));
  });

  it('exports the filtered, sorted view without the page', async () => {
    const blob = new Blob(['x']);
    mockedExport.mockResolvedValue({ data: blob } as never);
    renderPage('/portal/pagos?estado=pending&orden=-date&page=3');
    await screen.findByRole('button', { name: 'Descargar pagos en CSV' });

    await userEvent.click(screen.getByRole('button', { name: 'Descargar pagos en CSV' }));
    await waitFor(() => expect(mockedExport).toHaveBeenCalledWith({
      fmt: 'csv', status: 'pending', student: undefined, from: undefined, to: undefined, ordering: '-date',
    }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(blob, expect.stringMatching(/^pagos_\d{4}-\d{2}-\d{2}\.csv$/)));
  });

  it("shows the server's 413 message when the export is over the cap", async () => {
    const body = new Blob([JSON.stringify({ detail: 'Acote los filtros: el límite es 10000 filas.' })], { type: 'application/json' });
    mockedExport.mockRejectedValue({ response: { status: 413, data: body } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Descargar pagos en Excel' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Acote los filtros: el límite es 10000 filas.', expect.objectContaining({ duration: 8000 }),
    ));
    expect(downloadBlob).not.toHaveBeenCalled();
  });
});

describe('PaymentsPage states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows an error state (not a misleading empty list) and recovers on retry', async () => {
    // A failed fetch must not read as "Sin pagos" — that would tell a parent
    // they have no payments when the request actually errored.
    mockedPayments
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ data: { results: [] } } as never);

    renderPage();

    expect(await screen.findByText('No se pudo cargar la información')).toBeInTheDocument();
    expect(screen.queryByText('Sin pagos')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    // After the retry resolves empty, the genuine empty state shows.
    expect(await screen.findByText('Sin pagos')).toBeInTheDocument();
    expect(screen.queryByText('No se pudo cargar la información')).toBeNull();
    expect(mockedPayments).toHaveBeenCalledTimes(2);
  });

  it('labels a SUCCESS payment "Completado", not "Pendiente"', async () => {
    // Regression: statusMeta was keyed 'completed' while the backend sends
    // 'success', so paid rows fell through to the 'pending' default.
    mockedPayments.mockResolvedValue({
      data: { results: [{
        id: 1, status: 'success', payment_type: 'cafeteria',
        amount: '1500.00', currency: 'MXN', created_at: '2026-07-10T12:00:00Z',
      }] },
    } as never);

    renderPage();

    // The status filter <select> also lists every label; assert on the badge only.
    expect(await screen.findByText('Completado', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByText('Pendiente', { selector: 'span' })).toBeNull();
  });
});
