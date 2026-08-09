import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelmetProvider } from 'react-helmet-async';

vi.mock('@/services/api', () => ({
  admissionsApi: {
    getOpenSchoolEvents: vi.fn(),
    signUpOpenSchool: vi.fn(),
  },
  contentApi: {
    getSettings: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

import OpenSchoolPage from './OpenSchoolPage';
import { admissionsApi, contentApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const mockedEvents = vi.mocked(admissionsApi.getOpenSchoolEvents);
const mockedSignup = vi.mocked(admissionsApi.signUpOpenSchool);
const mockedSettings = vi.mocked(contentApi.getSettings);

const EVENT = {
  id: 9,
  date: '2099-06-15T10:00:00',
  title: 'Puertas Abiertas Interlaken',
  description: '',
  location: 'Campus Interlaken',
  max_capacity: 30,
  spots_remaining: 12,
  is_active: true,
};

function renderPage() {
  return renderWithProviders(
    <HelmetProvider>
      <OpenSchoolPage />
    </HelmetProvider>,
    { route: '/puertas-abiertas' },
  );
}

describe('OpenSchoolPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSettings.mockResolvedValue({ data: {} } as never);
  });

  it('shows Puertas Abiertas hero and empty state when no events', async () => {
    mockedEvents.mockResolvedValue({ data: [] } as never);
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Puertas Abiertas' })).toBeInTheDocument();
    expect(await screen.findByText('Sin eventos programados')).toBeInTheDocument();
  });

  it('shows error state and recovers on retry', async () => {
    mockedEvents
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ data: [] } as never);

    renderPage();
    expect(await screen.findByText('No fue posible cargar las fechas')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(await screen.findByText('Sin eventos programados')).toBeInTheDocument();
    expect(mockedEvents).toHaveBeenCalledTimes(2);
  });

  it('signs up for an open-class event with the legacy event payload', async () => {
    const user = userEvent.setup();
    mockedEvents.mockResolvedValue({ data: [EVENT] } as never);
    mockedSignup.mockResolvedValue({ data: { id: 1 } } as never);

    renderPage();
    expect(await screen.findByText('Elija una fecha')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: /15 de junio/i }));
    await user.click(await screen.findByRole('button', { name: /Puertas Abiertas Interlaken/i }));

    await user.type(await screen.findByLabelText(/Nombre completo/i), 'María López');
    await user.type(screen.getByLabelText(/Correo electrónico/i), 'maria@test.mx');
    await user.type(screen.getByLabelText(/Teléfono/i), '5559876543');
    await user.click(screen.getByRole('button', { name: /Confirmar asistencia/i }));

    await waitFor(() => {
      expect(mockedSignup).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 9,
          name: 'María López',
          email: 'maria@test.mx',
          phone: '5559876543',
          children_count: 1,
        }),
      );
    });
    expect(await screen.findByText('¡Registro confirmado!')).toBeInTheDocument();
  });
});
