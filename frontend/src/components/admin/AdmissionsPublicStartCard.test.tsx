import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { AdmissionsPublicStartCard } from './AdmissionsPublicStartCard';

vi.mock('@/services/api', () => ({ contentApi: { adminUpdateSettings: vi.fn() } }));
import { contentApi } from '@/services/api';

beforeEach(() => {
  vi.mocked(contentApi.adminUpdateSettings).mockReset();
  vi.mocked(contentApi.adminUpdateSettings).mockResolvedValue({ data: {} } as never);
});

describe('Ajustes → «Permitir iniciar la ficha sin enlace»', () => {
  it('explains that the ficha is private and recommends keeping it off', () => {
    renderWithProviders(<AdmissionsPublicStartCard value={false} loaded />);
    expect(screen.getByText(/La ficha de inscripción es personal: el colegio la envía desde el Expediente/)).toBeInTheDocument();
    expect(screen.getByText(/cualquier persona podría iniciar una ficha desde el sitio sin visita ni examen\. No se recomienda\./)).toBeInTheDocument();
  });

  it('shows the current state and turns the public start off on its own', async () => {
    renderWithProviders(<AdmissionsPublicStartCard value={true} loaded />);
    const sw = screen.getByRole('switch', { name: 'Permitir iniciar la ficha sin enlace' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Ahora: abierta a cualquier persona (no recomendado)')).toBeInTheDocument();
    await userEvent.click(sw);
    await waitFor(() => expect(contentApi.adminUpdateSettings).toHaveBeenCalledWith({ admissions_public_start: false }));
  });

  it('reads «solo con el enlace» when it is off and is disabled until the settings load', () => {
    renderWithProviders(<AdmissionsPublicStartCard value={false} loaded={false} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByText('Ahora: solo con el enlace personal del colegio')).toBeInTheDocument();
  });

  it('is off when the setting has no value yet (the server default is off)', () => {
    renderWithProviders(<AdmissionsPublicStartCard value={undefined} loaded={false} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });
});
