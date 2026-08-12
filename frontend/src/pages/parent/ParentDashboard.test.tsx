import { type ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/services/api', () => ({
  portalApi: { getDashboard: vi.fn() },
}));

vi.mock('@/components/portal/PushOptIn', () => ({
  PushOptIn: () => null,
}));

vi.mock('@/hooks/useAnnouncementsRead', () => ({
  useAnnouncementsRead: () => undefined,
}));

vi.mock('@/components/ui/Reveal', () => ({
  Reveal: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import ParentDashboard from './ParentDashboard';
import { portalApi } from '@/services/api';
import { useAuthStore, type User } from '@/store/authStore';

const getDashboard = vi.mocked(portalApi.getDashboard);

const SAMPLE_USER: User = {
  id: 3,
  email: 'padre@example.com',
  first_name: 'Ana',
  last_name: 'López',
  full_name: 'Ana López',
  role: 'parent',
  avatar: '',
  whatsapp: '',
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
        <ParentDashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ParentDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: { ...SAMPLE_USER },
      accessToken: 'test',
      isAuthenticated: true,
    });
  });

  it('shows an unlinked-family empty state without pay/top-up CTAs', async () => {
    getDashboard.mockResolvedValue({
      data: {
        children_count: 0,
        children: [],
        cafeteria_balances: [],
        recent_payments: [],
        needs_family_link: true,
        announcements: [],
        unread_notifications: 0,
      },
    } as never);

    renderPage();

    expect(await screen.findByText(/Cuenta sin alumno vinculado/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Contactar al colegio/i })).toHaveAttribute(
      'href',
      '/contacto',
    );
    expect(screen.queryByRole('link', { name: /Pagar colegiaturas/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Recargar cafetería/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it('keeps money CTAs for a linked family', async () => {
    getDashboard.mockResolvedValue({
      data: {
        children_count: 1,
        children: [
          { id: 11, name: 'Luis López', grade: '3°', group: 'A', student_id: 'A-11' },
        ],
        cafeteria_balances: [
          {
            student_name: 'Luis López',
            balance: '120.50',
            low: false,
            last_synced: '2026-08-01T00:00:00Z',
          },
        ],
        recent_payments: [],
        pending_invoices: 0,
        pending_balance: '0.00',
        needs_family_link: false,
        announcements: [],
        unread_notifications: 0,
      },
    } as never);

    renderPage();

    expect(await screen.findByRole('link', { name: /Pagar colegiaturas/i })).toHaveAttribute(
      'href',
      '/portal/colegiaturas',
    );
    expect(screen.getByRole('link', { name: /Recargar cafetería/i })).toHaveAttribute(
      'href',
      '/portal/cafeteria',
    );
    expect(screen.queryByText(/Cuenta sin alumno vinculado/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Saldo Cafetería/i)).toBeInTheDocument();
    expect(screen.getByText(/Luis López/i)).toBeInTheDocument();
  });

  it('shows unpaid colegiatura count even when recent_payments is empty', async () => {
    getDashboard.mockResolvedValue({
      data: {
        children_count: 1,
        children: [
          { id: 11, name: 'Luis López', grade: '3°', group: 'A', student_id: 'A-11' },
        ],
        cafeteria_balances: [],
        recent_payments: [],
        pending_invoices: 2,
        pending_balance: '5000.00',
        needs_family_link: false,
        announcements: [],
        unread_notifications: 0,
      },
    } as never);

    renderPage();

    expect(await screen.findByText(/Colegiaturas pendientes/i)).toBeInTheDocument();
    // Count-up may start at 0; assert the label + that we did not fall back to
    // inferring zero from empty recent_payments.
    expect(screen.queryByText(/Pagos Pendientes/i)).not.toBeInTheDocument();
  });
});
