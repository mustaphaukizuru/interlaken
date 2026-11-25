import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  authApi: { changePassword: vi.fn(), logout: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import toast from 'react-hot-toast';
import { authApi } from '@/services/api';
import { useAuthStore, type User } from '@/store/authStore';
import { renderWithProviders } from '@/test/renderWithProviders';
import { CreatePasswordScreen } from './CreatePasswordScreen';

const nora: User = {
  id: 7, email: 'nora@interlaken.edu.mx', first_name: 'Nora', last_name: 'Vega', full_name: 'Nora Vega',
  role: 'staff', avatar: '', whatsapp: '', password_change_required: true,
};
const change = vi.mocked(authApi.changePassword);

async function fill(current: string, next: string, confirm = next) {
  if (current) await userEvent.type(screen.getByLabelText('Contraseña temporal'), current);
  if (next) await userEvent.type(screen.getByLabelText('Contraseña nueva'), next);
  if (confirm) await userEvent.type(screen.getByLabelText('Confirme la contraseña nueva'), confirm);
}

describe('CreatePasswordScreen («Cree su contraseña»)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: nora, accessToken: 't', isAuthenticated: true });
  });

  it('explains the step, names the account and lists the rules', () => {
    renderWithProviders(<CreatePasswordScreen />);
    expect(screen.getByRole('heading', { level: 1, name: 'Cree su contraseña' })).toBeInTheDocument();
    expect(screen.getByText(/Entró con una contraseña temporal/)).toBeInTheDocument();
    expect(screen.getByText('nora@interlaken.edu.mx')).toBeInTheDocument();
    const rules = screen.getByRole('list', { name: 'Requisitos de la contraseña' });
    expect(within(rules).getByText(/Al menos 10 caracteres/)).toBeInTheDocument();
    expect(within(rules).getByText(/No solo números/)).toBeInTheDocument();
    expect(within(rules).getByText(/no sea una contraseña común/)).toBeInTheDocument();
    // The rules describe the new-password field for screen readers.
    expect(screen.getByLabelText('Contraseña nueva')).toHaveAttribute('aria-describedby', 'create-password-rules');
  });

  it('ticks the rules as the person types', async () => {
    renderWithProviders(<CreatePasswordScreen />);
    await userEvent.type(screen.getByLabelText('Contraseña nueva'), '12345');
    expect(screen.getByText(/Al menos 10 caracteres/)).toHaveTextContent('pendiente');
    expect(screen.getByText(/No solo números/)).toHaveTextContent('pendiente');
    await userEvent.type(screen.getByLabelText('Contraseña nueva'), 'abcdef');
    expect(screen.getByText(/Al menos 10 caracteres/)).toHaveTextContent('cumplido');
    expect(screen.getByText(/No solo números/)).toHaveTextContent('cumplido');
  });

  it('checks the confirmation and the rules before asking the server', async () => {
    renderWithProviders(<CreatePasswordScreen />);
    await fill('Tmp-ABCD-EFGH', 'Girasol-Azul-2026', 'Girasol-Azul-2025');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar y continuar' }));
    expect(await screen.findByText('Las dos contraseñas no coinciden.')).toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText('Contraseña nueva'));
    await userEvent.type(screen.getByLabelText('Contraseña nueva'), 'corta');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar y continuar' }));
    expect(await screen.findByText('Revise los requisitos de la lista.')).toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();
  });

  it('saves, clears the flag and says so', async () => {
    change.mockResolvedValue({ data: { detail: 'Contraseña guardada.', sessions_revoked: 0, user: { ...nora, password_change_required: false } } } as never);
    renderWithProviders(<CreatePasswordScreen />);
    await fill('Tmp-ABCD-EFGH', 'Girasol-Azul-2026');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar y continuar' }));
    await waitFor(() => expect(change).toHaveBeenCalledWith('Tmp-ABCD-EFGH', 'Girasol-Azul-2026'));
    await waitFor(() => expect(useAuthStore.getState().user?.password_change_required).toBe(false));
    expect(toast.success).toHaveBeenCalledWith('Su contraseña quedó guardada.');
  });

  it('shows the server reasons next to each field', async () => {
    change.mockRejectedValue({ isAxiosError: true, response: { status: 400, data: {
      current_password: ['La contraseña actual no es correcta.'],
      new_password: ['La contraseña tiene un parecido demasiado grande con correo electrónico.'],
    } } });
    renderWithProviders(<CreatePasswordScreen />);
    await fill('equivocada', 'noravega-interlaken');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar y continuar' }));
    expect(await screen.findByText('La contraseña actual no es correcta.')).toBeInTheDocument();
    expect(screen.getByText(/parecido demasiado grande/)).toBeInTheDocument();
    expect(screen.getByLabelText('Contraseña nueva')).toHaveAttribute(
      'aria-describedby', 'create-password-new-error create-password-rules');
    expect(useAuthStore.getState().user?.password_change_required).toBe(true);
  });

  it('a throttled or broken answer shows one message', async () => {
    change.mockRejectedValue({ isAxiosError: true, response: { status: 429, data: { detail: 'Demasiadas solicitudes. Intente de nuevo más tarde.' } } });
    renderWithProviders(<CreatePasswordScreen />);
    await fill('Tmp-ABCD-EFGH', 'Girasol-Azul-2026');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar y continuar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Demasiadas solicitudes');
  });

  it('«Mostrar las contraseñas» and «Salir»', async () => {
    renderWithProviders(<CreatePasswordScreen />);
    expect(screen.getByLabelText('Contraseña nueva')).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByLabelText('Mostrar las contraseñas'));
    expect(screen.getByLabelText('Contraseña nueva')).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: /Salir/ }));
    expect(authApi.logout).toHaveBeenCalled();
  });
});
