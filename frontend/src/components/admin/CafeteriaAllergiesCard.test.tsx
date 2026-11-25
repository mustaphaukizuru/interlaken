import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { CafeteriaAllergiesCard } from './CafeteriaAllergiesCard';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/api', () => ({ contentApi: { adminUpdateSettings: vi.fn() } }));
import { contentApi } from '@/services/api';

beforeEach(() => {
  vi.mocked(contentApi.adminUpdateSettings).mockReset();
  vi.mocked(contentApi.adminUpdateSettings).mockResolvedValue({ data: {} } as never);
});

describe('Ajustes → «Alergias en la cafetería»', () => {
  it('explains what turns on and warns about the aviso de privacidad', () => {
    renderWithProviders(<CafeteriaAllergiesCard value={false} loaded />);
    expect(screen.getByText(/solo las alergias, nunca el tipo de sangre, las notas médicas, la CURP ni la fecha de nacimiento/)).toBeInTheDocument();
    expect(screen.getByText('Encenderlo puede requerir una actualización del aviso de privacidad: revíselo antes de encenderlo.')).toBeInTheDocument();
    expect(screen.getByText('Ahora: la cafetería no ve las alergias')).toBeInTheDocument();
  });

  it('turns it on, on its own', async () => {
    renderWithProviders(<CafeteriaAllergiesCard value={false} loaded />);
    const sw = screen.getByRole('switch', { name: 'La cafetería ve las alergias' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(sw);
    await waitFor(() => expect(contentApi.adminUpdateSettings).toHaveBeenCalledWith({ cafeteria_shows_allergies: true }));
  });

  it('shows the current state and turns it off', async () => {
    renderWithProviders(<CafeteriaAllergiesCard value loaded />);
    expect(screen.getByText('Ahora: la cafetería ve las alergias autorizadas')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(contentApi.adminUpdateSettings).toHaveBeenCalledWith({ cafeteria_shows_allergies: false }));
  });

  it('is off and disabled until the settings load', () => {
    renderWithProviders(<CafeteriaAllergiesCard value={undefined} loaded={false} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch')).toBeDisabled();
  });
});
