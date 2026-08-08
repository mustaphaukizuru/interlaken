import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  financeApi: {
    adminListDiscounts: vi.fn(),
    adminCreateDiscount: vi.fn(),
    adminUpdateDiscount: vi.fn(),
    adminDeleteDiscount: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

import toast from 'react-hot-toast';
import { StudentDiscounts } from './StudentDiscounts';
import { financeApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const listDiscounts = vi.mocked(financeApi.adminListDiscounts);
const createDiscount = vi.mocked(financeApi.adminCreateDiscount);
const updateDiscount = vi.mocked(financeApi.adminUpdateDiscount);
const deleteDiscount = vi.mocked(financeApi.adminDeleteDiscount);
const toastSuccess = vi.mocked(toast.success);

const SAMPLE = {
  id: 9,
  student: 7,
  name: 'Beca excelencia',
  kind: 'scholarship',
  method: 'percent',
  value: '15.00',
  active: true,
  start_period: '2026-08',
  end_period: '2027-06',
  note: 'Aprobada',
};

describe('StudentDiscounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDiscounts.mockResolvedValue({ data: { results: [SAMPLE] } } as never);
    createDiscount.mockResolvedValue({ data: SAMPLE } as never);
    updateDiscount.mockResolvedValue({ data: SAMPLE } as never);
    deleteDiscount.mockResolvedValue({ data: {} } as never);
  });

  it('shows ErrorState with retry instead of the empty list on load failure', async () => {
    const user = userEvent.setup();
    listDiscounts
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ data: { results: [] } } as never);

    renderWithProviders(<StudentDiscounts studentId={7} />);

    expect(await screen.findByText(/No se pudieron cargar las becas/i)).toBeInTheDocument();
    expect(screen.queryByText(/Sin becas ni descuentos/i)).toBeNull();

    await user.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(await screen.findByText(/Sin becas ni descuentos/i)).toBeInTheDocument();
  });

  it('renders an existing discount and creates a new one for the student', async () => {
    const user = userEvent.setup();
    renderWithProviders(<StudentDiscounts studentId={7} />);

    expect(await screen.findByText('Beca excelencia')).toBeInTheDocument();
    expect(screen.getByText('Beca')).toBeInTheDocument();
    expect(screen.getByText(/15%/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Agregar/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Nombre$/i), {
      target: { value: 'Descuento hermanos' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^Valor$/i), {
      target: { value: '10' },
    });
    await user.click(within(dialog).getByRole('button', { name: /^Agregar$/i }));

    await waitFor(() => {
      expect(createDiscount).toHaveBeenCalledWith(
        expect.objectContaining({
          student: 7,
          name: 'Descuento hermanos',
          value: '10',
        }),
      );
    });
    expect(toastSuccess).toHaveBeenCalledWith('Beca agregada.');
  });

  it('edits and deletes a discount', async () => {
    const user = userEvent.setup();
    renderWithProviders(<StudentDiscounts studentId={7} />);
    await screen.findByText('Beca excelencia');

    await user.click(screen.getByRole('button', { name: /Editar/i }));
    const editDialog = await screen.findByRole('dialog');
    fireEvent.change(within(editDialog).getByLabelText(/^Nombre$/i), {
      target: { value: 'Beca actualizada' },
    });
    await user.click(within(editDialog).getByRole('button', { name: /^Guardar$/i }));

    await waitFor(() => {
      expect(updateDiscount).toHaveBeenCalledWith(
        9,
        expect.objectContaining({ name: 'Beca actualizada', student: 7 }),
      );
    });

    await user.click(screen.getByRole('button', { name: /Eliminar/i }));
    const confirm = await screen.findByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: /^Eliminar$/i }));

    await waitFor(() => {
      expect(deleteDiscount).toHaveBeenCalledWith(9);
    });
    expect(toastSuccess).toHaveBeenCalledWith('Beca eliminada.');
  });
});
