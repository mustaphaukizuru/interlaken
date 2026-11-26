import { type ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  portalApi: {
    getDashboard: vi.fn(),
    getStaffAnalytics: vi.fn(),
  },
  coreApi: {
    getBadges: vi.fn(),
  },
}));

vi.mock('@/components/ui/Reveal', () => ({
  Reveal: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/staff/ChartsSection', () => ({
  default: () => <div data-testid="charts-section" />,
}));

import AdminDashboard from './AdminDashboard';
import { coreApi, portalApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { useAuthStore } from '@/store/authStore';
import type { User } from '@/types';

const getDashboard = vi.mocked(portalApi.getDashboard);
const getStaffAnalytics = vi.mocked(portalApi.getStaffAnalytics);
const getBadges = vi.mocked(coreApi.getBadges);

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

const pendientes = () => screen.findByRole('region', { name: 'Pendientes' });

describe('AdminDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: null });
    getStaffAnalytics.mockResolvedValue({ data: null } as never);
    getBadges.mockResolvedValue({ data: {} } as never);
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

  it('KPI tiles are real links to the list behind the figure', async () => {
    getDashboard.mockResolvedValue({ data: DASHBOARD } as never);
    renderWithProviders(<AdminDashboard />, { route: '/admin' });
    expect(await screen.findByRole('link', { name: /Alumnos activos/ })).toHaveAttribute('href', '/admin/alumnos');
    expect(screen.getByRole('link', { name: /Saldo alumnos/ })).toHaveAttribute('href', '/admin/cafeteria');
    expect(screen.getByRole('link', { name: /Cobrado este mes/ }).getAttribute('href')).toMatch(/^\/admin\/pagos\?estado=success&desde=\d{4}-\d{2}-01$/);
    // Queues are no longer tiles: they live in «Pendientes».
    expect(screen.queryByText('Admisiones en cola')).toBeNull();
    expect(screen.queryByText('Por atender')).toBeNull();
    await waitFor(() => expect(screen.getByText('120')).toBeInTheDocument(), { timeout: 2000 });
  });

  it('«Pendientes» lists only the non-zero queues, most urgent first, each a link to its list', async () => {
    getDashboard.mockResolvedValue({ data: { ...DASHBOARD, topups_to_verify_total: '444.00' } } as never);
    getBadges.mockResolvedValue({ data: {
      cafeteria_verificar: 2, cafeteria_verificar_edad: 26 * 60, preregistros: 4, documentos: 0,
      pagos_fallidos: 1, mensajes: 1, mensajes_edad: 30, arco: 2, arco_vencidas: 1,
    } } as never);
    renderWithProviders(<AdminDashboard />, { route: '/admin' });
    const list = await pendientes();
    const links = await within(list).findAllByRole('link');
    expect(links.map((l) => l.textContent?.replace(/\s+/g, ' ').trim().split(' · ')[0])).toEqual([
      expect.stringMatching(/^2 recargas por verificar/),
      expect.stringMatching(/^1 pago con tarjeta fallido/),
      expect.stringMatching(/^2 solicitudes ARCO abiertas/),
      expect.stringMatching(/^4 pre-registros nuevos/),
      expect.stringMatching(/^1 mensaje sin atender/),
    ]);
    // Exactly those top-ups in Depósitos, like the sidebar's «Por verificar» (2026-11-25).
    expect(links[0]).toHaveAttribute('href', '/admin/cafeteria?tab=deposits&revisar=verificar');
    expect(links[0]).toHaveTextContent('$444.00');
    expect(links[0]).toHaveTextContent('Desde hace 1 día');
    expect(links[1].getAttribute('href')).toMatch(/^\/admin\/pagos\?estado=failed&desde=/);
    // ARCO past its legal deadline opens the overdue filter.
    expect(links[2]).toHaveAttribute('href', '/admin/arco?vencidas=1');
    expect(links[2]).toHaveTextContent('1 fuera de plazo legal');
    expect(links[3]).toHaveAttribute('href', '/admin/admisiones?etapa=informes');
    expect(links[4]).toHaveTextContent('Desde hace 30 minutos');
    expect(within(list).queryByText(/documento/)).toBeNull();
  });

  it('«Recargas por verificar» says the auto-loaded ones are already in the balance', async () => {
    getDashboard.mockResolvedValue({ data: { ...DASHBOARD, topups_to_verify_total: '70.00', topups_to_verify_loaded: 2 } } as never);
    getBadges.mockResolvedValue({ data: { cafeteria_verificar: 2, preregistros: 0 } } as never);
    renderWithProviders(<AdminDashboard />, { route: '/admin' });
    const list = await pendientes();
    const link = await within(list).findByRole('link', { name: /2 recargas por verificar/ });
    await waitFor(() => expect(link).toHaveTextContent('Ya están en el saldo y en Loyverse: solo falta confirmarlas en MultiCobros'));
    expect(link).toHaveTextContent('$70.00');
  });

  it('says «Todo al día» when nothing waits', async () => {
    getDashboard.mockResolvedValue({ data: DASHBOARD } as never);
    getBadges.mockResolvedValue({ data: { notificaciones: 3, cafeteria: 0, preregistros: 0 } } as never);
    renderWithProviders(<AdminDashboard />, { route: '/admin' });
    expect(await within(await pendientes()).findByText('Todo al día')).toBeInTheDocument();
  });

  it('a staff account sees only the pending items of its areas, with no admin figures', async () => {
    useAuthStore.setState({ user: { id: 7, email: 'caja@demo.test', role: 'staff', staff_areas: ['cafeteria'] } as unknown as User });
    getBadges.mockResolvedValue({ data: { cafeteria_aplicar: 3, saldo_bajo: 5 } } as never);
    renderWithProviders(<AdminDashboard />, { route: '/admin' });
    const list = await pendientes();
    expect(await within(list).findByText(/recargas con tarjeta por aplicar/)).toBeInTheDocument();
    expect(screen.getByText(/De sus áreas: Cafetería y pagos/)).toBeInTheDocument();
    expect(getDashboard).not.toHaveBeenCalled();
    expect(getStaffAnalytics).not.toHaveBeenCalled();
    expect(screen.queryByText('Alumnos activos')).toBeNull();
    // Shortcuts only to sections the account may open.
    const nav = screen.getByRole('navigation', { name: 'Accesos rápidos' });
    expect(within(nav).getByRole('link', { name: 'Cafetería' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Alumnos' })).toBeNull();
  });

  it('activity and audiences read in Spanish, never as raw codes', async () => {
    getDashboard.mockResolvedValue({ data: {
      ...DASHBOARD,
      recent_activity: [
        { id: 1, when: '2026-11-20T10:00:00Z', actor: 'Ana López', action: 'update', object_type: 'accounts.studentprofile', object_id: '12', context: '' },
        { id: 2, when: '2026-11-20T09:00:00Z', actor: '', action: 'create', object_type: 'cafeteria.topuprequest', object_id: '3', context: '' },
      ],
      announcements: [{ id: 9, title: 'Junta de padres', audience: 'parents', created_at: '2026-11-19T12:00:00Z' }],
    } } as never);
    renderWithProviders(<AdminDashboard />, { route: '/admin' });
    expect(await screen.findByText(/modificó un alumno/)).toBeInTheDocument();
    expect(screen.getByText(/creó una recarga/)).toBeInTheDocument();
    expect(screen.getByText('Sistema')).toBeInTheDocument();
    expect(screen.queryByText(/studentprofile/)).toBeNull();
    expect(screen.getAllByText('Padres').length).toBeGreaterThan(0);
    expect(screen.queryByText('parents')).toBeNull();
  });

  it('shows announcements empty state when there are none', async () => {
    getDashboard.mockResolvedValue({ data: DASHBOARD } as never);
    renderWithProviders(<AdminDashboard />, { route: '/admin' });
    expect(await screen.findByText('Sin avisos recientes')).toBeInTheDocument();
    expect(screen.getByText('Avisos recientes')).toBeInTheDocument();
  });

  it('shows ErrorState with retry when the dashboard fails to load', async () => {
    getDashboard.mockRejectedValue(new Error('network'));
    renderWithProviders(<AdminDashboard />, { route: '/admin' });
    expect(await screen.findByText(/No se pudo cargar la información/i)).toBeInTheDocument();
    expect(screen.queryByText('Avisos recientes')).not.toBeInTheDocument();

    getDashboard.mockResolvedValue({ data: DASHBOARD } as never);
    await userEvent.click(screen.getByRole('button', { name: /Reintentar/i }));
    expect(await screen.findByText('Alumnos activos')).toBeInTheDocument();
  });

  it('shortcuts are quiet links, and a failed analytics load shows an error with retry', async () => {
    getDashboard.mockResolvedValue({ data: DASHBOARD } as never);
    getStaffAnalytics.mockRejectedValue(new Error('500'));
    renderWithProviders(<AdminDashboard />, { route: '/admin' });
    expect(await screen.findByText('No se pudieron cargar los indicadores')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Accesos rápidos' });
    expect(within(nav).getByRole('link', { name: 'Cafetería' })).toHaveAttribute('href', '/admin/cafeteria');
    expect(within(nav).getByRole('link', { name: 'Admisiones' })).toHaveAttribute('href', '/admin/admisiones');
    expect(nav.querySelector('.btn-green, .btn-pink, .btn-outline')).toBeNull();
  });
});
