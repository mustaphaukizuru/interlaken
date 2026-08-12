import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  bookingsApi: {
    getAdminBookings: vi.fn(),
    getAdminSlots: vi.fn(),
    generateSlots: vi.fn(),
    bookingAction: vi.fn(),
    updateSlot: vi.fn(),
    deleteSlot: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

import toast from 'react-hot-toast';
import AdminBookings from './AdminBookings';
import { bookingsApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const getAdminBookings = vi.mocked(bookingsApi.getAdminBookings);
const getAdminSlots = vi.mocked(bookingsApi.getAdminSlots);
const generateSlots = vi.mocked(bookingsApi.generateSlots);
const toastSuccess = vi.mocked(toast.success);

describe('AdminBookings visit-type filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAdminSlots.mockResolvedValue({ data: { results: [], count: 0 } } as never);
    getAdminBookings.mockResolvedValue({ data: { results: [], count: 0 } } as never);
    generateSlots.mockResolvedValue({
      data: { created: 2, skipped: 0, detail: '2 horarios generados (0 ya existían).' },
    } as never);
  });

  it('defaults to individual visit type when loading reservas', async () => {
    renderWithProviders(<AdminBookings />, { route: '/admin/visitas' });

    await waitFor(() => {
      expect(getAdminBookings).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'individual', page: 1 }),
      );
    });
    expect(screen.getByLabelText('Filtrar por tipo de visita')).toHaveValue('individual');
  });

  it('requests open_class when the type filter changes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminBookings />, { route: '/admin/visitas' });

    await waitFor(() => expect(getAdminBookings).toHaveBeenCalled());
    await user.selectOptions(screen.getByLabelText('Filtrar por tipo de visita'), 'open_class');

    await waitFor(() => {
      expect(getAdminBookings).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'open_class', page: 1 }),
      );
    });
  });

  it('publishes Puertas Abiertas slots with open_class + title', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminBookings />, { route: '/admin/visitas' });
    await waitFor(() => expect(getAdminSlots).toHaveBeenCalled());

    await user.selectOptions(
      screen.getByLabelText('Tipo de visita a publicar'),
      'open_class',
    );
    expect(screen.getByLabelText(/Nombre del evento/i)).toHaveValue('Puertas Abiertas');

    fireEvent.change(screen.getByLabelText(/^Desde$/i), {
      target: { value: '2026-09-01' },
    });
    fireEvent.change(screen.getByLabelText(/^Hasta$/i), {
      target: { value: '2026-09-01' },
    });

    await user.click(screen.getByRole('button', { name: /Publicar eventos/i }));

    await waitFor(() => {
      expect(generateSlots).toHaveBeenCalledWith(
        expect.objectContaining({
          visit_type: 'open_class',
          title: 'Puertas Abiertas',
          capacity: 30,
          interval_minutes: 120,
          start_date: '2026-09-01',
          end_date: '2026-09-01',
        }),
      );
    });
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('filters published slots by open_class', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminBookings />, { route: '/admin/visitas' });
    await waitFor(() => expect(getAdminSlots).toHaveBeenCalled());

    await user.selectOptions(screen.getByLabelText('Filtrar horarios por tipo'), 'open_class');

    await waitFor(() => {
      expect(getAdminSlots).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'open_class', page: 1 }),
      );
    });
  });
});
