import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelmetProvider } from 'react-helmet-async';

vi.mock('@/services/api', () => ({
  bookingsApi: {
    getAvailability: vi.fn(),
    createBooking: vi.fn(),
  },
  contentApi: {
    getSettings: vi.fn(),
  },
}));

vi.mock('@/services/analytics', () => ({
  trackEvent: vi.fn(),
  FunnelEvent: { BookingConversion: 'booking_conversion' },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

import BookVisitPage from './BookVisitPage';
import { bookingsApi, contentApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const mockedAvail = vi.mocked(bookingsApi.getAvailability);
const mockedCreate = vi.mocked(bookingsApi.createBooking);
const mockedSettings = vi.mocked(contentApi.getSettings);

const SLOT = {
  id: 42,
  date: '2099-06-15',
  start_time: '09:00:00',
  end_time: '09:30:00',
  capacity: 1,
  booked_count: 0,
  spots_remaining: 1,
  location: 'Campus Interlaken',
  visit_type: 'individual',
  title: '',
  is_active: true,
};

function renderPage() {
  return renderWithProviders(
    <HelmetProvider>
      <BookVisitPage />
    </HelmetProvider>,
    { route: '/agendar-visita' },
  );
}

describe('BookVisitPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSettings.mockResolvedValue({ data: {} } as never);
  });

  it('shows the Agendar Visita hero and Visita funnel step', async () => {
    mockedAvail.mockResolvedValue({ data: { results: [] } } as never);
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Agendar Visita' })).toBeInTheDocument();
    expect(screen.getByText('Visita')).toBeInTheDocument();
    expect(await screen.findByText('Sin horarios disponibles')).toBeInTheDocument();
  });

  it('shows error state and recovers on retry', async () => {
    mockedAvail
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ data: { results: [] } } as never);

    renderPage();
    expect(await screen.findByText('No fue posible cargar los horarios')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(await screen.findByText('Sin horarios disponibles')).toBeInTheDocument();
    expect(mockedAvail).toHaveBeenCalledTimes(2);
  });

  it('books an individual slot after picking date and time', async () => {
    const user = userEvent.setup();
    mockedAvail.mockResolvedValue({ data: { results: [SLOT] } } as never);
    mockedCreate.mockResolvedValue({ data: { id: 1 } } as never);

    renderPage();
    expect(await screen.findByText('Elija una fecha y horario')).toBeInTheDocument();

    const dayBtn = await screen.findByRole('button', { name: /15 de junio/i });
    await user.click(dayBtn);
    await user.click(await screen.findByRole('button', { name: /09:00/i }));

    await user.type(await screen.findByLabelText(/Nombre completo/i), 'Roberto Pérez');
    await user.type(screen.getByLabelText(/Correo electrónico/i), 'roberto@test.mx');
    await user.type(screen.getByLabelText(/Teléfono/i), '5551234567');
    await user.click(screen.getByRole('button', { name: /Confirmar visita/i }));

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          slot: 42,
          parent_name: 'Roberto Pérez',
          parent_email: 'roberto@test.mx',
          parent_phone: '5551234567',
          num_attendees: 1,
        }),
      );
    });
    expect(await screen.findByText('¡Visita confirmada!')).toBeInTheDocument();
  });
});
