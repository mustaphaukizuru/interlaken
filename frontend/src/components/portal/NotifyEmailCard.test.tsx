import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/api', () => ({
  authApi: {
    getNotifyEmail: vi.fn(),
    setNotifyEmail: vi.fn(),
    deleteNotifyEmail: vi.fn(),
  },
}));

import { authApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { NotifyEmailCard } from './NotifyEmailCard';

const api = vi.mocked(authApi);

describe('NotifyEmailCard («Correo para avisos», owner 2026-10-20)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getNotifyEmail.mockResolvedValue({ data: { email: '', verified: false } } as never);
  });

  it('sends the confirmation link and shows the address as pending', async () => {
    api.setNotifyEmail.mockResolvedValue({ data: { email: 'mama@gmail.com', verified: false, sent: true } } as never);
    const u = userEvent.setup();
    renderWithProviders(<NotifyEmailCard accountEmail="ci1@interlaken.com.mx" />);
    expect(await screen.findByText('ci1@interlaken.com.mx')).toBeInTheDocument();

    await u.type(screen.getByLabelText('Correo personal'), 'mama@gmail.com');
    await u.click(screen.getByRole('button', { name: 'Enviar enlace' }));

    expect(api.setNotifyEmail).toHaveBeenCalledWith('mama@gmail.com');
    expect(await screen.findByText(/Pendiente: abra el enlace/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reenviar enlace' })).toBeInTheDocument();
  });

  it('says the copy creates no account, and turns «Confirmado» by itself while pending', async () => {
    api.getNotifyEmail
      .mockResolvedValueOnce({ data: { email: 'mama@gmail.com', verified: false } } as never)
      .mockResolvedValue({ data: { email: 'mama@gmail.com', verified: true } } as never);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderWithProviders(<NotifyEmailCard />);
      expect(await screen.findByText(/no necesita iniciar sesión/)).toBeInTheDocument();
      expect(screen.getByText(/no crea otra cuenta ni da acceso al portal/)).toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(8500);
      expect(await screen.findByText(/Confirmado: recibe los avisos/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes a confirmed address', async () => {
    api.getNotifyEmail.mockResolvedValue({ data: { email: 'mama@gmail.com', verified: true } } as never);
    api.deleteNotifyEmail.mockResolvedValue({ data: { email: '', verified: false } } as never);
    const u = userEvent.setup();
    renderWithProviders(<NotifyEmailCard />);

    await u.click(await screen.findByRole('button', { name: 'Quitar' }));
    await waitFor(() => expect(screen.queryByText('mama@gmail.com')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Correo personal')).toBeInTheDocument();
  });
});
