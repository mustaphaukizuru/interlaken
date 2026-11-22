import { type ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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
  cafeteria_total_balance: '3200.50',
  low_balance_count: 3,
  pending_topups: 1,
  visits_today: 5,
  unhandled_messages: 2,
  open_password_requests: 0,
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

  it('shows the pupils and the staff wallet totals apart', async () => {
    getDashboard.mockResolvedValue({ data: {
      ...DASHBOARD, cafeteria_total_balance: '23700.50', cafeteria_students_balance: '3200.50',
      cafeteria_staff_balance: '20500.00', total_staff_accounts: 3,
    } } as never);
    renderWithProviders(<AdminDashboard />, { route: '/admin' });
    expect(await screen.findByText('Saldo alumnos')).toBeInTheDocument();
    expect(screen.getByText(/Saldo personal: \$20,500\.00 \(3 cuentas\)/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('$3,200.50')).toBeInTheDocument());
  });

  it('shows KPI counts including pending registrations', async () => {
    getDashboard.mockResolvedValue({ data: DASHBOARD } as never);

    renderWithProviders(<AdminDashboard />, { route: '/admin' });

    // KPIs re-cut for the cafetería-only money path (BACKLOG P1-H5)
    expect(await screen.findByText('Alumnos activos')).toBeInTheDocument();
    // Pupils and staff wallets apart (2026-11-18).
    expect(screen.getByText('Saldo alumnos')).toBeInTheDocument();
    expect(screen.getByText('Admisiones en cola')).toBeInTheDocument();
    expect(screen.getByText('Cobrado este mes')).toBeInTheDocument();
    expect(screen.getByText('Visitas hoy')).toBeInTheDocument();
    expect(screen.getByText('4 pre-registros · 2 inscripciones')).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByText('120')).toBeInTheDocument();
        expect(screen.getByText('6')).toBeInTheDocument();
        expect(screen.getByText('5')).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it('links the paid card top-ups straight to the 07:30 list', async () => {
    getDashboard.mockResolvedValue({ data: { ...DASHBOARD, paid_topups_to_apply: 3, paid_topups_to_apply_total: '450.00' } } as never);
    renderWithProviders(<AdminDashboard />);
    const link = await screen.findByRole('link', { name: /3 recargas con tarjeta por aplicar/ });
    expect(link).toHaveAttribute('href', '/admin/cafeteria?tab=pos');
    expect(link).toHaveTextContent('$450.00');
  });

  it('«Recargas pendientes de verificar»: count, total, oldest wait and the way to the queue', async () => {
    const dayAgo = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
    getDashboard.mockResolvedValue({ data: {
      ...DASHBOARD, topups_to_verify: 2, topups_to_verify_total: '444.00', topups_to_verify_oldest: dayAgo,
    } } as never);
    renderWithProviders(<AdminDashboard />);
    const card = await screen.findByRole('region', { name: 'Recargas pendientes de verificar' });
    expect(card).toHaveTextContent('2 recargas');
    expect(card).toHaveTextContent('$444.00');
    expect(card).toHaveTextContent('La más antigua: hace 1 día');
    expect(within(card).getByRole('link', { name: /Verificar ahora/ })).toHaveAttribute('href', '/admin/cafeteria?tab=pos');
  });

  it.each([
    [0, /No llegan al saldo hasta verificarlas en MultiCobros/],
    [2, /Ya están en el saldo y en Loyverse: solo falta confirmarlas en MultiCobros/],
    [1, /1 ya está en el saldo y en Loyverse; 1 llega al saldo al verificarla en MultiCobros/],
  ])('says whether the money is already in the balance (%i of 2 auto-loaded)', async (loaded, text) => {
    getDashboard.mockResolvedValue({ data: {
      ...DASHBOARD, topups_to_verify: 2, topups_to_verify_total: '444.00', topups_to_verify_oldest: null,
      topups_to_verify_loaded: loaded,
    } } as never);
    renderWithProviders(<AdminDashboard />);
    const card = await screen.findByRole('region', { name: 'Recargas pendientes de verificar' });
    expect(card).toHaveTextContent(text);
  });

  it('hides the verification card when nothing waits', async () => {
    getDashboard.mockResolvedValue({ data: {
      ...DASHBOARD, topups_to_verify: 0, topups_to_verify_total: '0.00', topups_to_verify_oldest: null,
    } } as never);
    renderWithProviders(<AdminDashboard />);
    expect(await screen.findByText('Alumnos activos')).toBeInTheDocument();
    expect(screen.queryByText('Recargas pendientes de verificar')).toBeNull();
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

    expect(await screen.findByText('Alumnos activos')).toBeInTheDocument();
  });

  it('quick actions say what they do, and a failed analytics load shows an error with retry', async () => {
    getDashboard.mockResolvedValue({ data: DASHBOARD } as never);
    getStaffAnalytics.mockRejectedValue(new Error('500'));
    renderWithProviders(<AdminDashboard />, { route: '/admin' });
    expect(await screen.findByText('No se pudieron cargar los indicadores')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Cafetería y sincronización/ })).toHaveAttribute('href', '/admin/cafeteria');
    expect(screen.getByRole('link', { name: /Ver admisiones/ })).toHaveAttribute('href', '/admin/admisiones');
    expect(screen.queryByText('Sincronizar Loyverse')).not.toBeInTheDocument();
    expect(screen.queryByText('Nueva Admisión')).not.toBeInTheDocument();
  });
});
