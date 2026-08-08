import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/services/api', () => ({
  authApi: { requestPasswordReset: vi.fn() },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

import toast from 'react-hot-toast';
import ForgotPasswordPage from './ForgotPasswordPage';
import { authApi } from '@/services/api';

const requestReset = vi.mocked(authApi.requestPasswordReset);
const toastSuccess = vi.mocked(toast.success);
const toastError = vi.mocked(toast.error);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/olvide-contrasena']}>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('submits email and shows the sent confirmation', async () => {
    requestReset.mockResolvedValueOnce({ data: { detail: 'ok' } } as never);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/correo/i), 'padre@test.mx');
    await user.click(screen.getByRole('button', { name: /enviar enlace/i }));

    await waitFor(() => expect(requestReset).toHaveBeenCalledWith('padre@test.mx'));
    expect(toastSuccess).toHaveBeenCalled();
    expect(screen.getByText(/revise su bandeja/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /volver a iniciar sesión/i })).toHaveAttribute(
      'href',
      '/login',
    );
  });

  it('toasts an error when the request fails', async () => {
    requestReset.mockRejectedValueOnce(new Error('network'));
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/correo/i), 'padre@test.mx');
    await user.click(screen.getByRole('button', { name: /enviar enlace/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /enviar enlace/i })).toBeInTheDocument();
  });
});
