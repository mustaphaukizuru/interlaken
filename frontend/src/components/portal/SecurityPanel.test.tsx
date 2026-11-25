import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  authApi: {
    sessions: vi.fn(), closeOtherSessions: vi.fn(), totpSetup: vi.fn(), totpEnable: vi.fn(), totpDisable: vi.fn(),
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import toast from 'react-hot-toast';
import { authApi } from '@/services/api';
import { useAuthStore, type User } from '@/store/authStore';
import { renderWithProviders } from '@/test/renderWithProviders';
import { SecurityPanel } from './SecurityPanel';

const boss: User = { id: 1, email: 'direccion@x.mx', first_name: 'D', last_name: 'X', full_name: 'D X', role: 'admin', avatar: '', whatsapp: '' };
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const sessions = (totp: boolean) => ({ data: { active_sessions: 1, totp_enabled: totp, history: [
  { at: '2026-11-24T10:00:00Z', method: 'password', success: false, reason: 'reused_totp', ip: null, device: 'Chrome' },
] } });
const wrongCode = (detail: string) => ({ isAxiosError: true, response: { status: 400, data: { detail, code: 'bad_totp' } } });

describe('SecurityPanel → Segundo factor (TOTP)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: boss, accessToken: 't', isAuthenticated: true });
    vi.mocked(authApi.sessions).mockResolvedValue(sessions(false) as never);
  });

  it('setup shows a QR and the key, a wrong code says why, the right one turns it on', async () => {
    vi.mocked(authApi.totpSetup).mockResolvedValue({ data: { secret: SECRET, otpauth_url: `otpauth://totp/Interlaken:direccion%40x.mx?secret=${SECRET}&issuer=Interlaken` } } as never);
    vi.mocked(authApi.totpEnable)
      .mockRejectedValueOnce(wrongCode('Código incorrecto. Revise la hora del teléfono.'))
      .mockResolvedValueOnce({ data: { totp_enabled: true } } as never);
    renderWithProviders(<SecurityPanel />);

    await userEvent.click(await screen.findByRole('button', { name: 'Activar segundo factor' }));
    // The console is used on a computer: the phone scans a QR (it only had the key before).
    expect(await screen.findByTitle('Código QR para su app de autenticación')).toBeInTheDocument();
    expect(screen.getByText(SECRET)).toBeInTheDocument();

    const field = screen.getByLabelText('Código');
    await userEvent.type(field, '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Activar' }));
    // The server's sentence, not the generic fallback.
    expect(await screen.findByRole('alert')).toHaveTextContent('Código incorrecto. Revise la hora del teléfono.');

    await userEvent.clear(field);
    expect(screen.queryByRole('alert')).toBeNull(); // typing again clears it
    await userEvent.type(field, '123456');
    vi.mocked(authApi.sessions).mockResolvedValue(sessions(true) as never);
    await userEvent.click(screen.getByRole('button', { name: 'Activar' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Segundo factor activado.'));
    expect(await screen.findByText('Activo')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('disabling with a wrong code shows the reason and keeps it on', async () => {
    vi.mocked(authApi.sessions).mockResolvedValue(sessions(true) as never);
    vi.mocked(authApi.totpDisable).mockRejectedValue(wrongCode('Código incorrecto.'));
    renderWithProviders(<SecurityPanel />);
    await userEvent.type(await screen.findByLabelText('Código actual para desactivar'), '999999');
    await userEvent.click(screen.getByRole('button', { name: /Desactivar/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Código incorrecto.');
    expect(screen.getByText('Activo')).toBeInTheDocument();
  });

  it('names a reused code in the sign-in history', async () => {
    renderWithProviders(<SecurityPanel />);
    expect(await screen.findByText('Fallido: código ya usado')).toBeInTheDocument();
  });

  it('families see no second factor', async () => {
    useAuthStore.setState({ user: { ...boss, role: 'parent' } });
    renderWithProviders(<SecurityPanel />);
    await screen.findByText(/dispositivo con sesión abierta/);
    expect(screen.queryByText('Segundo factor (app de autenticación)')).toBeNull();
  });
});
