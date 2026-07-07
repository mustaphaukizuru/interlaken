import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// Mock the API module so no real HTTP happens and we can drive both paths.
vi.mock('@/services/api', () => ({
  api: { post: vi.fn() },
  authApi: { me: vi.fn(), googleLogin: vi.fn() },
}));

// Silence toast side-effects.
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

import LoginPage from './LoginPage';
import { api, authApi } from '@/services/api';
import { useAuthStore } from '@/store/authStore';

const mockedPost = vi.mocked(api.post);
const mockedMe = vi.mocked(authApi.me);

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
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
      refreshToken: null,
      isAuthenticated: false,
    });
    vi.clearAllMocks();
  });

  it('logs in on valid credentials and stores the session', async () => {
    mockedPost.mockResolvedValueOnce({ data: { access: 'acc', refresh: 'ref' } } as never);
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
    expect(localStorage.getItem('access_token')).toBe('acc');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('shows an error message on invalid credentials', async () => {
    mockedPost.mockRejectedValueOnce(new Error('401'));

    renderLogin();
    await fillAndSubmit();

    expect(await screen.findByText(/credenciales incorrectas/i)).toBeInTheDocument();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});
