import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/hooks/useSiteSettings', () => ({
  useSiteSettings: () => ({ whatsapp_number: '5215553791188', contact_email: 'info@interlaken.com.mx' }),
}));

vi.mock('@/services/api', () => ({
  authApi: {
    updateMe: vi.fn(),
    updateNotifPrefs: vi.fn(),
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
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
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

  // Staff and admins still edit their own profile; families cannot (bitácora 10).
  it('PATCHes name and WhatsApp when the form is dirty and saved (staff)', async () => {
    useAuthStore.setState({ user: { ...SAMPLE_USER, role: 'staff' } });
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

  it('keeps Guardar disabled when the form is unchanged (staff)', () => {
    useAuthStore.setState({ user: { ...SAMPLE_USER, role: 'staff' } });
    renderPage();
    expect(screen.getByRole('button', { name: /guardar cambios/i })).toBeDisabled();
    expect(updateMe).not.toHaveBeenCalled();
  });

  it('shows a read-only profile to families: no save, no photo upload, a correction link', () => {
    renderPage(); // SAMPLE_USER is a parent
    expect(screen.getByLabelText('Nombre')).toBeDisabled();
    expect(screen.getByLabelText('Apellidos')).toBeDisabled();
    expect(screen.getByLabelText('WhatsApp')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /guardar cambios/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Sus datos los actualiza el colegio/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Solicite la corrección/ })).toHaveAttribute('href', expect.stringContaining('mailto:info@interlaken.com.mx'));
    expect(updateMe).not.toHaveBeenCalled();
  });
});
