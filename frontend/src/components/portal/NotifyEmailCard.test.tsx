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
    verifyNotifyEmail: vi.fn(),
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

  it('confirms the address once when arriving from the email link', async () => {
    api.verifyNotifyEmail.mockResolvedValue({ data: { email: 'mama@gmail.com', verified: true } } as never);
    renderWithProviders(<NotifyEmailCard />, { route: '/portal/perfil?tab=avisos&verificar_correo=tok123' });

    await waitFor(() => expect(api.verifyNotifyEmail).toHaveBeenCalledWith('tok123'));
    expect(await screen.findByText(/Confirmado: recibe los avisos/)).toBeInTheDocument();
    expect(api.verifyNotifyEmail).toHaveBeenCalledTimes(1);
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
