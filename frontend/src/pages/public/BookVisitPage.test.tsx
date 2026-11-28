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

function renderPage(route = '/agendar-visita') {
  return renderWithProviders(
    <HelmetProvider>
      <BookVisitPage />
    </HelmetProvider>,
    { route },
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

  it('dates read «Lunes 15 de junio» (first letter only), and the slot list refreshes after booking (QA 2026-11-24)', async () => {
    const user = userEvent.setup();
    mockedAvail.mockResolvedValue({ data: { results: [SLOT] } } as never);
    mockedCreate.mockResolvedValue({ data: { id: 1 } } as never);
    renderPage();

    await user.click(await screen.findByRole('button', { name: /15 de junio/i }));
    const day = await screen.findByText('Lunes 15 de junio');
    expect(day).not.toHaveClass('capitalize');
    await user.click(await screen.findByRole('button', { name: /09:00/i }));
    const summary = await screen.findByText('15 de junio, 2099');
    expect(summary).not.toHaveClass('capitalize');

    await user.type(await screen.findByLabelText(/Nombre completo/i), 'Roberto Pérez');
    await user.type(screen.getByLabelText(/Correo electrónico/i), 'roberto@test.mx');
    await user.type(screen.getByLabelText(/Teléfono/i), '5551234567');
    // The slot just taken is gone on the next read.
    mockedAvail.mockResolvedValue({ data: { results: [] } } as never);
    const before = mockedAvail.mock.calls.length;
    await user.click(screen.getByRole('button', { name: /Confirmar visita/i }));
    expect(await screen.findByText('¡Visita confirmada!')).toBeInTheDocument();
    expect(screen.getByText(/^Lunes 15 de junio, 2099/)).toBeInTheDocument();
    await waitFor(() => expect(mockedAvail.mock.calls.length).toBeGreaterThan(before));
    await user.click(screen.getByRole('button', { name: 'Agendar otra visita' }));
    expect(await screen.findByText('Sin horarios disponibles')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /15 de junio/i })).toBeNull();
  });

  it('sends the visit link of the Expediente (?lead=) with the booking and never shows it', async () => {
    const user = userEvent.setup();
    mockedAvail.mockResolvedValue({ data: { results: [SLOT] } } as never);
    mockedCreate.mockResolvedValue({ data: { id: 1 } } as never);
    const token = 'eyJsIjo3fQ:1tTEST:signature';

    const { container } = renderPage(`/agendar-visita?lead=${encodeURIComponent(token)}`);
    await user.click(await screen.findByRole('button', { name: /15 de junio/i }));
    await user.click(await screen.findByRole('button', { name: /09:00/i }));
    await user.type(await screen.findByLabelText(/Nombre completo/i), 'Marta Ejemplo');
    await user.type(screen.getByLabelText(/Correo electrónico/i), 'marta@ejemplo.test');
    await user.type(screen.getByLabelText(/Teléfono/i), '5512345678');
    expect(container.innerHTML).not.toContain('1tTEST');
    await user.click(screen.getByRole('button', { name: /Confirmar visita/i }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledWith(expect.objectContaining({ slot: 42, lead_token: token })));
    expect(await screen.findByText('¡Visita confirmada!')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('1tTEST');
  });

  it('asks for an empty e-mail and phone, and refuses letters in the phone (QA 2026-11-24)', async () => {
    const user = userEvent.setup();
    mockedAvail.mockResolvedValue({ data: { results: [SLOT] } } as never);
    renderPage();
    await user.click(await screen.findByRole('button', { name: /15 de junio/i }));
    await user.click(await screen.findByRole('button', { name: /09:00/i }));
    await user.type(await screen.findByLabelText(/Nombre completo/i), 'Marta Ejemplo');
    await user.click(screen.getByRole('button', { name: /Confirmar visita/i }));
    expect(await screen.findByText('Escriba su correo.')).toBeInTheDocument();
    expect(screen.getByText('Escriba su teléfono.')).toBeInTheDocument();
    expect(screen.queryByText(/inválido/)).toBeNull();

    await user.type(screen.getByLabelText(/Correo electrónico/i), 'marta@ejemplo.test');
    await user.type(screen.getByLabelText(/Teléfono/i), '55 1234 abcd');
    await user.click(screen.getByRole('button', { name: /Confirmar visita/i }));
    expect(await screen.findByText(/Revise el teléfono: solo números/)).toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();

    // Spaces, dashes, parentheses and + are fine.
    await user.clear(screen.getByLabelText(/Teléfono/i));
    await user.type(screen.getByLabelText(/Teléfono/i), '+52 (55) 1234-5678');
    mockedCreate.mockResolvedValue({ data: { id: 1 } } as never);
    await user.click(screen.getByRole('button', { name: /Confirmar visita/i }));
    await waitFor(() => expect(mockedCreate).toHaveBeenCalledWith(expect.objectContaining({ parent_phone: '+52 (55) 1234-5678' })));
  });

  it('shows the server reason for a refused phone instead of the generic message', async () => {
    const user = userEvent.setup();
    mockedAvail.mockResolvedValue({ data: { results: [SLOT] } } as never);
    mockedCreate.mockRejectedValue({ response: { status: 400, data: { parent_phone: ['El número debe tener de 10 a 15 dígitos.'] } } });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /15 de junio/i }));
    await user.click(await screen.findByRole('button', { name: /09:00/i }));
    await user.type(await screen.findByLabelText(/Nombre completo/i), 'Marta Ejemplo');
    await user.type(screen.getByLabelText(/Correo electrónico/i), 'marta@ejemplo.test');
    await user.type(screen.getByLabelText(/Teléfono/i), '5512345678');
    await user.click(screen.getByRole('button', { name: /Confirmar visita/i }));
    expect(await screen.findByText('El número debe tener de 10 a 15 dígitos.')).toBeInTheDocument();
  });

  it('a family that already has a visit sees it with the school WhatsApp and phone, not a red error (owner 2026-11-26)', async () => {
    const user = userEvent.setup();
    mockedSettings.mockResolvedValue({ data: { whatsapp_number: '5215553791188', phone_display: '(55) 5379-1188', phone_e164: '+525553791188' } } as never);
    mockedAvail.mockResolvedValue({ data: { results: [SLOT] } } as never);
    const detail = 'Ya tiene una visita agendada el jueves 3 de diciembre a las 11:45 (Visita Individual). '
      + 'Si desea cambiarla, escríbanos por WhatsApp o llame al colegio.';
    mockedCreate.mockRejectedValue({ response: { status: 409, data: { detail, code: 'already_booked', existing: { date: '2099-12-03', start_time: '11:45' } } } });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /15 de junio/i }));
    await user.click(await screen.findByRole('button', { name: /09:00/i }));
    await user.type(await screen.findByLabelText(/Nombre completo/i), 'Marta Ejemplo');
    await user.type(screen.getByLabelText(/Correo electrónico/i), 'marta@ejemplo.test');
    await user.type(screen.getByLabelText(/Teléfono/i), '5512345678');
    await user.click(screen.getByRole('button', { name: /Confirmar visita/i }));

    expect(await screen.findByText(detail)).toBeInTheDocument();
    const wa = screen.getByRole('link', { name: /Escribir por WhatsApp/ });
    expect(wa.getAttribute('href')).toContain('5215553791188');
    expect(screen.getByRole('link', { name: /Llamar \(55\) 5379-1188/ })).toHaveAttribute('href', 'tel:+525553791188');
    // Not the generic failure, and nothing confirmed.
    expect(screen.queryByText('No fue posible completar la reserva. Intente de nuevo.')).toBeNull();
    expect(screen.queryByText('¡Visita confirmada!')).toBeNull();
  });

  it('books without a token when the page has none', async () => {
    const user = userEvent.setup();
    mockedAvail.mockResolvedValue({ data: { results: [SLOT] } } as never);
    mockedCreate.mockResolvedValue({ data: { id: 1 } } as never);
    renderPage();
    await user.click(await screen.findByRole('button', { name: /15 de junio/i }));
    await user.click(await screen.findByRole('button', { name: /09:00/i }));
    await user.type(await screen.findByLabelText(/Nombre completo/i), 'Marta Ejemplo');
    await user.type(screen.getByLabelText(/Correo electrónico/i), 'marta@ejemplo.test');
    await user.type(screen.getByLabelText(/Teléfono/i), '5512345678');
    await user.click(screen.getByRole('button', { name: /Confirmar visita/i }));
    await waitFor(() => expect(mockedCreate).toHaveBeenCalled());
    expect(mockedCreate.mock.calls[0][0]).not.toHaveProperty('lead_token');
  });
});
