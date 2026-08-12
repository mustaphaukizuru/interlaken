import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/services/api', () => ({
  authApi: { confirmPasswordReset: vi.fn() },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

import toast from 'react-hot-toast';
import ResetPasswordPage from './ResetPasswordPage';
import { authApi } from '@/services/api';

const confirmReset = vi.mocked(authApi.confirmPasswordReset);
const toastSuccess = vi.mocked(toast.success);

function renderPage(search = '?uid=MQ&token=abc') {
  return render(
    <MemoryRouter initialEntries={[`/restablecer-contrasena${search}`]}>
      <Routes>
        <Route path="/restablecer-contrasena" element={<ResetPasswordPage />} />
        <Route path="/login" element={<div>Login listo</div>} />
        <Route path="/olvide-contrasena" element={<div>Olvidé</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows invalid-link state when uid/token are missing', () => {
    renderPage('');
    expect(screen.getByText(/este enlace no es válido/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /solicitar enlace/i })).toHaveAttribute(
      'href',
      '/olvide-contrasena',
    );
  });

  it('rejects short passwords without calling the API', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/^contraseña$/i), 'short');
    await user.type(screen.getByLabelText(/confirmar/i), 'short');
    await user.click(screen.getByRole('button', { name: /guardar contraseña/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/al menos 8 caracteres/i);
    expect(confirmReset).not.toHaveBeenCalled();
  });

  it('rejects mismatched passwords without calling the API', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/^contraseña$/i), 'password123');
    await user.type(screen.getByLabelText(/confirmar/i), 'password999');
    await user.click(screen.getByRole('button', { name: /guardar contraseña/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no coinciden/i);
    expect(confirmReset).not.toHaveBeenCalled();
  });

  it('confirms a valid reset and navigates to login', async () => {
    confirmReset.mockResolvedValueOnce({ data: { detail: 'ok' } } as never);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^contraseña$/i), 'password123');
    await user.type(screen.getByLabelText(/confirmar/i), 'password123');
    await user.click(screen.getByRole('button', { name: /guardar contraseña/i }));

    await waitFor(() =>
      expect(confirmReset).toHaveBeenCalledWith({
        uid: 'MQ',
        token: 'abc',
        password: 'password123',
      }),
    );
    expect(toastSuccess).toHaveBeenCalled();
    expect(await screen.findByText(/login listo/i)).toBeInTheDocument();
  });
});
