import { type ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  portalApi: {
    getDashboard: vi.fn(),
    getStaffAnalytics: vi.fn(),
  },
}));

vi.mock('@/components/ui/Reveal', () => ({
  Reveal: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/staff/ChartsSection', () => ({
  default: () => <div data-testid="charts-section" />,
}));

import AdminDashboard from './AdminDashboard';
import { portalApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const getDashboard = vi.mocked(portalApi.getDashboard);
const getStaffAnalytics = vi.mocked(portalApi.getStaffAnalytics);

const DASHBOARD = {
  total_students: 120,
  pending_preregistrations: 4,
  pending_registrations: 2,
  pending_payments: 7,
  total_revenue: '15000.00',
  announcements: [] as Array<{
    id: number;
    title: string;
    audience: string;
    created_at: string;
  }>,
};

describe('AdminDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStaffAnalytics.mockResolvedValue({ data: null } as never);
  });

  it('shows KPI counts including pending registrations', async () => {
    getDashboard.mockResolvedValue({ data: DASHBOARD } as never);

    renderWithProviders(<AdminDashboard />, { route: '/admin' });

    expect(await screen.findByText('Total Alumnos')).toBeInTheDocument();
    expect(screen.getByText('Pre-registros Pendientes')).toBeInTheDocument();
    expect(screen.getByText('Inscripciones Pendientes')).toBeInTheDocument();
    expect(screen.getByText('Ingresos del Mes')).toBeInTheDocument();
    expect(screen.getByText('Pagos Pendientes')).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByText('120')).toBeInTheDocument();
        expect(screen.getByText('4')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
        expect(screen.getByText('7')).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it('shows announcements empty state when there are none', async () => {
    getDashboard.mockResolvedValue({ data: DASHBOARD } as never);

    renderWithProviders(<AdminDashboard />, { route: '/admin' });

    expect(await screen.findByText('Sin actividad reciente')).toBeInTheDocument();
    expect(screen.getByText('Avisos Recientes')).toBeInTheDocument();
  });

  it('shows ErrorState with retry when the dashboard fails to load', async () => {
    getDashboard.mockRejectedValue(new Error('network'));

    renderWithProviders(<AdminDashboard />, { route: '/admin' });

    expect(await screen.findByText(/No se pudo cargar la información/i)).toBeInTheDocument();
    expect(screen.queryByText('Avisos Recientes')).not.toBeInTheDocument();

    getDashboard.mockResolvedValue({ data: DASHBOARD } as never);
    await userEvent.click(screen.getByRole('button', { name: /Reintentar/i }));

    expect(await screen.findByText('Total Alumnos')).toBeInTheDocument();
  });
});
