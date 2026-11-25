import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the API module so no real HTTP happens and we can drive both paths.
vi.mock('@/hooks/useSiteSettings', () => ({
  useSiteSettings: () => ({ whatsapp_number: '5215553791188', contact_email: 'info@interlaken.com.mx' }),
}));

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
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { api, authApi, bootstrapSession } from '@/services/api';
import { useAuthStore } from '@/store/authStore';

const mockedPost = vi.mocked(api.post);
const mockedMe = vi.mocked(authApi.me);
const mockedBootstrap = vi.mocked(bootstrapSession);

// /login is a CMS page now (cms/sections/acceso): it reads its copy through
// react-query and sets its title with Helmet. No published copy here (the API
// mock has no contentApi), so the built-in texts render.
function providers(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <HelmetProvider><QueryClientProvider client={client}>{children}</QueryClientProvider></HelmetProvider>;
}

function renderLogin(entry = '/login') {
  return render(providers(
    <MemoryRouter initialEntries={[entry]}>
      <LoginPage />
    </MemoryRouter>,
  ));
}

async function fillAndSubmit() {
  const user = userEvent.setup();
  await user.type(await screen.findByPlaceholderText('correo@interlaken.com.mx'), 'parent@test.mx');
  await user.type(screen.getByPlaceholderText('••••••••'), 's3cret');
  await user.click(screen.getByRole('button', { name: /ingresar/i }));
}

describe('LoginPage and old «correo para avisos» links', () => {
  it('a signed-out visitor from an old link goes to the public confirmation, not the form', async () => {
    useAuthStore.setState({ user: null, accessToken: null, isAuthenticated: false });
    render(providers(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: { pathname: '/portal/perfil', search: '?tab=avisos&verificar_correo=old-tok' } } }]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/confirmar-correo" element={<div>confirmar</div>} />
        </Routes>
      </MemoryRouter>,
    ));
    expect(await screen.findByText('confirmar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ingresar/i })).toBeNull();
  });
});

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

  // 2026-11-24: an admin-invited account with a temporary password that also
  // turned on TOTP: the code first, then «Cree su contraseña» before the console.
  it('temporary password + TOTP: the code step, then «Cree su contraseña» instead of the console', async () => {
    mockedPost
      .mockRejectedValueOnce({ response: { status: 401, data: { totp_required: true, detail: 'Ingrese el código de su app de autenticación.' } } })
      .mockResolvedValueOnce({ data: { access: 'acc', password_change_required: true } } as never);
    mockedMe.mockResolvedValueOnce({ data: {
      id: 5, email: 'parent@test.mx', role: 'admin', full_name: 'Nueva Admin', first_name: 'Nueva', last_name: 'Admin',
      avatar: '', whatsapp: '', staff_areas: [], password_change_required: true,
    } } as never);
    render(providers(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/admin" element={<ProtectedRoute roles={['admin']}><div>ADMIN CONSOLE</div></ProtectedRoute>} />
        </Routes>
      </MemoryRouter>,
    ));
    await fillAndSubmit();
    const code = await screen.findByLabelText(/Código de verificación/);
    await userEvent.type(code, '123456');
    await userEvent.click(screen.getByRole('button', { name: /ingresar/i }));
    await waitFor(() => expect(mockedPost).toHaveBeenLastCalledWith('/accounts/token/', {
      email: 'parent@test.mx', password: 's3cret', totp: '123456',
    }));
    expect(await screen.findByRole('heading', { name: 'Cree su contraseña' })).toBeInTheDocument();
    expect(screen.queryByText('ADMIN CONSOLE')).toBeNull();
  });

  it('shows an error message on invalid credentials', async () => {
    mockedPost.mockRejectedValueOnce({ response: { status: 401, data: { detail: 'No active account' } } });

    renderLogin();
    await fillAndSubmit();

    expect(await screen.findByText(/credenciales incorrectas/i)).toBeInTheDocument();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it.each([
    ['no response (offline / DNS down)', new Error('Network Error'), /no hay conexión con el servidor/i],
    ['a server error', { response: { status: 502, data: {} } }, /el servicio no está disponible/i],
    ['a lockout', { response: { status: 429, data: {} } }, /demasiados intentos/i],
  ])('does not blame the password on %s', async (_label, error, message) => {
    mockedPost.mockRejectedValueOnce(error);

    renderLogin();
    await fillAndSubmit();

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText(/credenciales incorrectas/i)).not.toBeInTheDocument();
  });

  it('has no self-service reset; points families to WhatsApp or email', async () => {
    renderLogin();
    await screen.findByRole('button', { name: /ingresar/i });
    expect(screen.queryByRole('link', { name: /activar \/ restablecer/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /whatsapp/i })).toHaveAttribute('href', expect.stringMatching(/^https:\/\/wa\.me\//));
    expect(screen.getByRole('link', { name: /^correo$/i })).toHaveAttribute('href', expect.stringMatching(/^mailto:/));
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
    expect(screen.getByPlaceholderText('correo@interlaken.com.mx')).toBeDisabled();
    expect(screen.getByRole('button', { name: /completando/i })).toBeDisabled();

    resolveBootstrap(true);
    await waitFor(() => expect(mockedMe).toHaveBeenCalled());
  });
});
