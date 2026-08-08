import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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

import AdminBookings from './AdminBookings';
import { bookingsApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const getAdminBookings = vi.mocked(bookingsApi.getAdminBookings);
const getAdminSlots = vi.mocked(bookingsApi.getAdminSlots);

describe('AdminBookings visit-type filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAdminSlots.mockResolvedValue({ data: { results: [], count: 0 } } as never);
    getAdminBookings.mockResolvedValue({ data: { results: [], count: 0 } } as never);
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
});
