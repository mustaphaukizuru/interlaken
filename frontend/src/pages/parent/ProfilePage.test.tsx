import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/api', () => ({
  authApi: {
    updateMe: vi.fn(),
    updateNotifPrefs: vi.fn(),
    setPassword: vi.fn(),
    me: vi.fn(),
  },
}));

import toast from 'react-hot-toast';
import ProfilePage from './ProfilePage';
import { authApi } from '@/services/api';
import { useAuthStore, type User } from '@/store/authStore';

const updateMe = vi.mocked(authApi.updateMe);
const toastSuccess = vi.mocked(toast.success);

const SAMPLE_USER: User = {
  id: 7,
  email: 'padre@example.com',
  first_name: 'Ana',
  last_name: 'López',
  full_name: 'Ana López',
  role: 'parent',
  avatar: '',
  whatsapp: '5512345678',
  has_usable_password: true,
  notif_prefs: {
    email_enabled: true,
    in_app_enabled: true,
    push_enabled: false,
  },
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProfilePage />
    </QueryClientProvider>,
  );
}

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: { ...SAMPLE_USER },
      accessToken: 'test',
      isAuthenticated: true,
    });
  });

  it('PATCHes name and WhatsApp when the form is dirty and saved', async () => {
    const user = userEvent.setup();
    updateMe.mockResolvedValue({
      data: {
        ...SAMPLE_USER,
        first_name: 'Ana María',
        last_name: 'García',
        whatsapp: '5599999999',
        full_name: 'Ana María García',
      },
    } as never);

    renderPage();

    await user.clear(screen.getByLabelText('Nombre'));
    await user.type(screen.getByLabelText('Nombre'), 'Ana María');
    await user.clear(screen.getByLabelText('Apellidos'));
    await user.type(screen.getByLabelText('Apellidos'), 'García');
    await user.clear(screen.getByLabelText('WhatsApp'));
    await user.type(screen.getByLabelText('WhatsApp'), '5599999999');

    const save = screen.getByRole('button', { name: /guardar cambios/i });
    expect(save).not.toBeDisabled();
    await user.click(save);

    await waitFor(() => expect(updateMe).toHaveBeenCalledTimes(1));
    expect(updateMe).toHaveBeenCalledWith({
      first_name: 'Ana María',
      last_name: 'García',
      whatsapp: '5599999999',
    });
    expect(toastSuccess).toHaveBeenCalledWith('Información actualizada correctamente.');
    expect(useAuthStore.getState().user?.first_name).toBe('Ana María');
  });

  it('keeps Guardar disabled when the form is unchanged', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /guardar cambios/i })).toBeDisabled();
    expect(updateMe).not.toHaveBeenCalled();
  });
});
