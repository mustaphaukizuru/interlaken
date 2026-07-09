import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AnalyticsPayload } from '@/types/analytics';

vi.mock('@/services/api', () => ({
  portalApi: { getStaffAnalytics: vi.fn() },
}));

import StaffDashboard from './StaffDashboard';
import { portalApi } from '@/services/api';

const mockedAnalytics = vi.mocked(portalApi.getStaffAnalytics);

function emptyPayload(): AnalyticsPayload {
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(2026, 5, 9 + i);
    return d.toISOString().slice(0, 10);
  });
  return {
    admissions: {
      pre_funnel: { pending: 0, contacted: 0, enrolled: 0, rejected: 0 },
      reg_funnel: {},
      referrals: [],
      series: days.map((date) => ({ date, count: 0 })),
    },
    payments: {
      this_month: { total: 0, count: 0 },
      last_month: { total: 0, count: 0 },
      overdue: { count: 0, amount: 0 },
      series: days.map((date) => ({ date, total: 0 })),
    },
    cafeteria: { series: days.map((date) => ({ date, topups: 0, purchases: 0 })) },
    documents: { in_review: 0 },
    circulars: { active: 0, read_rate: null },
    arco: { open: 0, overdue: 0 },
    range_days: 30,
    generated_at: '2026-07-08T00:00:00Z',
  };
}

function renderDashboard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/staff']}>
        <StaffDashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('StaffDashboard states (IK-ADMIN item 8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows per-card skeletons while loading (no global spinner)', () => {
    mockedAnalytics.mockReturnValueOnce(new Promise(() => {}) as never);
    const { container } = renderDashboard();
    // 4 KPI skeletons + 3 chart skeletons, each its own shimmer card.
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThanOrEqual(7);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows an error state with a working retry', async () => {
    mockedAnalytics
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ data: emptyPayload() } as never);

    renderDashboard();
    expect(await screen.findByText('No se pudo cargar la analítica')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));
    await waitFor(() =>
      expect(screen.queryByText('No se pudo cargar la analítica')).toBeNull());
    expect(mockedAnalytics).toHaveBeenCalledTimes(2);
  });

  it('renders empty-safe content with zero data (KPIs + empty-state guidance)', async () => {
    mockedAnalytics.mockResolvedValueOnce({ data: emptyPayload() } as never);

    renderDashboard();
    // First find waits out the lazy recharts chunk transform in jsdom.
    expect(await screen.findByText('Cobrado este mes', {}, { timeout: 8000 }))
      .toBeInTheDocument();
    expect(screen.getByText('Pre-registros pendientes')).toBeInTheDocument();
    expect(screen.getByText('Documentos por revisar')).toBeInTheDocument();
    expect(screen.getByText('Solicitudes ARCO abiertas')).toBeInTheDocument();
    // Charts fall back to guidance, not blank space.
    expect(await screen.findByText('Sin pre-registros', {}, { timeout: 8000 }))
      .toBeInTheDocument();
    expect(screen.getByText('Sin fuentes registradas')).toBeInTheDocument();
    expect(screen.getByText('Sin transacciones')).toBeInTheDocument();
  });
});
