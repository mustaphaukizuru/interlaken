import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  financeApi: {
    adminListFees: vi.fn(),
    adminCreateFee: vi.fn(),
    adminUpdateFee: vi.fn(),
    adminDeleteFee: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import toast from 'react-hot-toast';
import AdminFees from './AdminFees';
import { financeApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const listFees = vi.mocked(financeApi.adminListFees);
const createFee = vi.mocked(financeApi.adminCreateFee);
const updateFee = vi.mocked(financeApi.adminUpdateFee);
const deleteFee = vi.mocked(financeApi.adminDeleteFee);
const toastSuccess = vi.mocked(toast.success);

const sample = {
  id: 3,
  name: 'Primaria 2026',
  level: 'primaria',
  grade: '',
  monthly_amount: '3500.5',
  currency: 'MXN',
  due_day: 10,
  late_fee_type: 'fixed',
  late_fee_amount: '150.00',
  late_fee_grace_days: 0,
  active: true,
};

describe('AdminFees money UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listFees.mockResolvedValue({ data: { results: [sample] } } as never);
    createFee.mockResolvedValue({ data: sample } as never);
    updateFee.mockResolvedValue({ data: sample } as never);
    deleteFee.mockResolvedValue({ data: {} } as never);
  });

  it('renders formatted mensualidad and late-fee summary', async () => {
    renderWithProviders(<AdminFees />, { route: '/admin/planes' });
    expect(await screen.findByText('Primaria 2026')).toBeInTheDocument();
    expect(screen.getByText('$3500.50 MXN')).toBeInTheDocument();
    expect(screen.getByText('Día 10')).toBeInTheDocument();
    expect(screen.getByText('Monto fijo (150.00)')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
  });

  it('shows empty and recovers from error via retry', async () => {
    listFees
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ data: { results: [] } } as never);
    const user = userEvent.setup();
    renderWithProviders(<AdminFees />, { route: '/admin/planes' });

    expect(await screen.findByText('No se pudo cargar la información')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(await screen.findByText('Sin planes')).toBeInTheDocument();
  });

  it('creates a plan from the modal', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminFees />, { route: '/admin/planes' });
    await screen.findByText('Primaria 2026');

    await user.click(screen.getByRole('button', { name: /Nuevo plan/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Nombre del plan'), {
      target: { value: 'Secundaria 2026' },
    });
    fireEvent.change(within(dialog).getByLabelText('Mensualidad (MXN)'), {
      target: { value: '4200' },
    });
    await user.click(within(dialog).getByRole('button', { name: 'Crear' }));

    await waitFor(() => {
      expect(createFee).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Secundaria 2026', monthly_amount: '4200' }),
      );
    });
    expect(toastSuccess).toHaveBeenCalledWith('Plan creado.');
  });

  it('toggles active and deletes with confirm', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminFees />, { route: '/admin/planes' });
    await screen.findByText('Primaria 2026');

    await user.click(screen.getByRole('button', { name: 'Desactivar' }));
    await waitFor(() => {
      expect(updateFee).toHaveBeenCalledWith(3, { active: false });
    });

    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    const confirm = await screen.findByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(deleteFee).toHaveBeenCalledWith(3));
    expect(toastSuccess).toHaveBeenCalledWith('Plan eliminado.');
  });
});
