import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// Mock the API module so no real HTTP happens and we can drive both paths.
vi.mock('@/services/api', () => ({
  api: { post: vi.fn() },
  authApi: { me: vi.fn(), googleLogin: vi.fn() },
  bootstrapSession: vi.fn(),
}));

// Silence toast side-effects.
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

import LoginPage from './LoginPage';
import { api, authApi, bootstrapSession } from '@/services/api';
import { useAuthStore } from '@/store/authStore';

const mockedPost = vi.mocked(api.post);
const mockedMe = vi.mocked(authApi.me);
const mockedBootstrap = vi.mocked(bootstrapSession);

function renderLogin(entry = '/login') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LoginPage />
    </MemoryRouter>,
  );
}

async function fillAndSubmit() {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText('correo@interlaken.edu.mx'), 'parent@test.mx');
  await user.type(screen.getByPlaceholderText('••••••••'), 's3cret');
  await user.click(screen.getByRole('button', { name: /ingresar/i }));
}

describe('LoginPage email/password submit', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({
      user: null,
      accessToken: null,
      isAuthenticated: false,
    });
    vi.clearAllMocks();
  });

  it('logs in on valid credentials and stores the session in memory', async () => {
    // The server returns only an access token; the refresh token is an httpOnly cookie.
    mockedPost.mockResolvedValueOnce({ data: { access: 'acc' } } as never);
    mockedMe.mockResolvedValueOnce({
      data: { id: 1, email: 'parent@test.mx', role: 'parent', full_name: 'P P' },
    } as never);

    renderLogin();
    await fillAndSubmit();

    await waitFor(() => expect(mockedMe).toHaveBeenCalled());
    expect(mockedPost).toHaveBeenCalledWith('/accounts/token/', {
      email: 'parent@test.mx',
      password: 's3cret',
    });
    // Access token is in memory (store), never localStorage.
    expect(useAuthStore.getState().accessToken).toBe('acc');
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('shows an error message on invalid credentials', async () => {
    mockedPost.mockRejectedValueOnce(new Error('401'));

    renderLogin();
    await fillAndSubmit();

    expect(await screen.findByText(/credenciales incorrectas/i)).toBeInTheDocument();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('links to the forgot-password / first-access page', () => {
    renderLogin();
    expect(screen.getByRole('link', { name: /activar \/ restablecer/i })).toHaveAttribute(
      'href',
      '/olvide-contrasena',
    );
  });
});

describe('LoginPage Google OAuth return (?login=ok)', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({
      user: null,
      accessToken: null,
      isAuthenticated: false,
    });
    vi.clearAllMocks();
  });

  it('shows a bootstrapping status and disables the form while the session settles', async () => {
    let resolveBootstrap: (v: boolean) => void = () => {};
    mockedBootstrap.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        resolveBootstrap = resolve;
      }),
    );
    mockedMe.mockResolvedValueOnce({
      data: { id: 2, email: 'parent@gmail.com', role: 'parent', full_name: 'G P' },
    } as never);

    renderLogin('/login?login=ok');

    expect(await screen.findByRole('status')).toHaveTextContent(/completando acceso con google/i);
    expect(screen.getByRole('button', { name: /continuar con google/i })).toBeDisabled();
    expect(screen.getByPlaceholderText('correo@interlaken.edu.mx')).toBeDisabled();
    expect(screen.getByRole('button', { name: /completando/i })).toBeDisabled();

    resolveBootstrap(true);
    await waitFor(() => expect(mockedMe).toHaveBeenCalled());
  });
});
