import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  cafeteriaApi: {
    getAllBalances: vi.fn(),
    getTopUpLog: vi.fn(),
    markTopUpPosLoaded: vi.fn(),
    markTopUpPosUnloaded: vi.fn(),
    syncAll: vi.fn(),
    syncBalance: vi.fn(),
    reconcile: vi.fn(),
    getLowBalance: vi.fn(),
    getLoyverseCustomers: vi.fn(),
    getLoyverseCustomerReceipts: vi.fn(),
    exportSchool: vi.fn(),
  },
  downloadBlob: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

import toast from 'react-hot-toast';
import AdminCafeteria from './AdminCafeteria';
import { cafeteriaApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const getAllBalances = vi.mocked(cafeteriaApi.getAllBalances);
const getTopUpLog = vi.mocked(cafeteriaApi.getTopUpLog);
const markLoaded = vi.mocked(cafeteriaApi.markTopUpPosLoaded);
const markUnloaded = vi.mocked(cafeteriaApi.markTopUpPosUnloaded);
const toastSuccess = vi.mocked(toast.success);
const toastError = vi.mocked(toast.error);

const loadRow = {
  id: 11,
  student_id: 3,
  student_name: 'Luis Pérez',
  student_code: 'L-003',
  amount: '200.00',
  method: 'online' as const,
  method_display: 'Pago en Línea',
  status: 'completed' as const,
  status_display: 'Completado',
  gateway: 'global_payments',
  payment_status: 'success',
  gateway_tx_id: 'gp-11',
  created_at: '2026-08-08T10:00:00Z',
  processed_at: '2026-08-08T10:01:00Z',
  pos_loaded_at: null,
  pos_loaded_by_name: '',
  needs_pos_load: true,
  pos_unload_needed_at: null,
  pos_unloaded_at: null,
  pos_unloaded_by_name: '',
  needs_pos_unload: false,
};

const unloadRow = {
  ...loadRow,
  id: 22,
  student_name: 'Ana López',
  student_code: 'A-001',
  amount: '150.00',
  gateway_tx_id: 'gp-22',
  pos_loaded_at: '2026-08-08T11:00:00Z',
  needs_pos_load: false,
  pos_unload_needed_at: '2026-08-08T12:00:00Z',
  needs_pos_unload: true,
};

async function openPosTab(user: ReturnType<typeof userEvent.setup>) {
  renderWithProviders(<AdminCafeteria />, { route: '/admin/cafeteria' });
  // The strip is a real tablist now (role=tab, aria-selected).
  await user.click(await screen.findByRole('tab', { name: /POS Loyverse/i }));
}

describe('AdminCafeteria POS Loyverse queues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAllBalances.mockResolvedValue({ data: { results: [], count: 0 } } as never);
    getTopUpLog.mockImplementation(async (params) => {
      if (params?.needs_pos) {
        return { data: { results: [loadRow], count: 1 } } as never;
      }
      if (params?.needs_unload) {
        return { data: { results: [unloadRow], count: 1 } } as never;
      }
      return { data: { results: [], count: 0 } } as never;
    });
    markLoaded.mockResolvedValue({ data: { needs_pos_load: false } } as never);
    markUnloaded.mockResolvedValue({ data: { needs_pos_unload: false } } as never);
  });

  it('lists load and unload queues on the POS tab', async () => {
    const user = userEvent.setup();
    await openPosTab(user);

    expect(await screen.findByText('Cargar en POS')).toBeInTheDocument();
    expect(screen.getByText('Quitar del POS')).toBeInTheDocument();
    expect(await screen.findByText('Luis Pérez')).toBeInTheDocument();
    expect(await screen.findByText('Ana López')).toBeInTheDocument();

    await waitFor(() => {
      expect(getTopUpLog).toHaveBeenCalledWith(expect.objectContaining({ needs_pos: 1 }));
      expect(getTopUpLog).toHaveBeenCalledWith(expect.objectContaining({ needs_unload: 1 }));
    });
  });

  it('marks a top-up as loaded in Loyverse', async () => {
    const user = userEvent.setup();
    await openPosTab(user);

    const loadBtn = await screen.findByRole('button', { name: /Cargado en Loyverse/i });
    await user.click(loadBtn);

    await waitFor(() => expect(markLoaded).toHaveBeenCalledWith(11));
    expect(toastSuccess).toHaveBeenCalledWith('Marcado como cargado en Loyverse POS.');
  });

  it('marks a refunded top-up as unloaded from Loyverse', async () => {
    const user = userEvent.setup();
    await openPosTab(user);

    const unloadBtn = await screen.findByRole('button', { name: /Quitado de Loyverse/i });
    await user.click(unloadBtn);

    await waitFor(() => expect(markUnloaded).toHaveBeenCalledWith(22));
    expect(toastSuccess).toHaveBeenCalledWith('Marcado como quitado del POS de Loyverse.');
  });

  it('shows empty states when both queues are clear', async () => {
    getTopUpLog.mockResolvedValue({ data: { results: [], count: 0 } } as never);
    const user = userEvent.setup();
    await openPosTab(user);

    expect(await screen.findByText('Sin pendientes de carga en POS')).toBeInTheDocument();
    expect(screen.getByText('Sin pendientes de quitar del POS')).toBeInTheDocument();
  });

  it('toasts an error when mark-loaded fails', async () => {
    markLoaded.mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    await openPosTab(user);

    await user.click(await screen.findByRole('button', { name: /Cargado en Loyverse/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('No se pudo marcar la recarga.'));
  });

  it('recovers from a load-queue error via retry', async () => {
    getTopUpLog.mockImplementation(async (params) => {
      if (params?.needs_pos) {
        throw new Error('network');
      }
      return { data: { results: [], count: 0 } } as never;
    });
    const user = userEvent.setup();
    await openPosTab(user);

    expect(await screen.findByText('No se pudo cargar la información')).toBeInTheDocument();

    getTopUpLog.mockImplementation(async (params) => {
      if (params?.needs_pos) {
        return { data: { results: [loadRow], count: 1 } } as never;
      }
      return { data: { results: [], count: 0 } } as never;
    });

    const retry = screen.getAllByRole('button', { name: /reintentar/i })[0];
    await user.click(retry);

    expect(await screen.findByText('Luis Pérez')).toBeInTheDocument();
    expect(within(screen.getByText('Luis Pérez').closest('tr')!).getByText(/\$200\.00/)).toBeInTheDocument();
  });
});

describe('AdminCafeteria Clientes Loyverse tab (every card, not only pupils)', () => {
  const getCustomers = vi.mocked(cafeteriaApi.getLoyverseCustomers);
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
    getAllBalances.mockResolvedValue({ data: { results: [], count: 0 } } as never);
    getCustomers.mockResolvedValue({ data: {
      count: 2, summary: { student: 1, staff: 1, test: 0, other: 0, missing: 0 }, results: [pupil, staff],
    } } as never);
    getReceipts.mockResolvedValue({ data: { customer: staff, results: [
      { receipt_number: 'r-9', receipt_date: '2026-09-22T17:00:00Z', points: '45.00',
        items: 'Comida corrida, 2× Agua', receipt_type: 'SALE', resolved: false },
    ] } } as never);
  });

  it('lists staff cards next to pupils with kind, balance and a receipts button', async () => {
    renderWithProviders(<AdminCafeteria />, { route: '/admin/cafeteria?tab=customers' });
    expect(await screen.findByText('ZP-Rivero Montes de Oca Nadia')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Personal')).toBeInTheDocument();
    expect(within(table).getByText('Alumno')).toBeInTheDocument();
    expect(within(table).getAllByText('$178.00')).toHaveLength(2);
    expect(screen.getByText(/2 tarjeta\(s\) en Loyverse/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver alumno' })).toHaveAttribute('href', '/admin/cafeteria/7');
  });

  it('opens the receipts of a staff card', async () => {
    renderWithProviders(<AdminCafeteria />, { route: '/admin/cafeteria?tab=customers' });
    await userEvent.click(await screen.findByRole('button', { name: /Ver compras de ZP-Rivero/ }));
    expect(await screen.findByText('Comida corrida, 2× Agua')).toBeInTheDocument();
    expect(getReceipts).toHaveBeenCalledWith('s1');
  });
});
