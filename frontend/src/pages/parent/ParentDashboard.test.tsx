import { type ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/services/api', () => ({
  portalApi: { getDashboard: vi.fn() },
}));

vi.mock('@/components/portal/PushOptIn', () => ({
  PushOptIn: () => null,
}));

vi.mock('@/components/portal/InstallHint', () => ({
  InstallHint: () => null,
}));

vi.mock('@/components/ui/Reveal', () => ({
  Reveal: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// The lazy chart chunks pull recharts + cafeteriaApi (not mocked here) — stub
// them so long-running tests don't mount the real cards after the lazy import
// resolves.
// The stubs record which child each card was given (siblings never mixed).
const trendProps = vi.hoisted(() => [] as unknown[]);
const categoriesProps = vi.hoisted(() => [] as unknown[]);
vi.mock('@/components/portal/CafeteriaTrendCard', () => ({
  default: (p: { student?: unknown }) => { trendProps.push(p.student); return null; },
}));
vi.mock('@/components/portal/CafeteriaCategoriesCard', () => ({
  default: (p: { student?: unknown }) => { categoriesProps.push(p.student); return null; },
}));

import ParentDashboard, { greetingForHour } from './ParentDashboard';
import { portalApi } from '@/services/api';
import { useAuthStore, type User } from '@/store/authStore';
import { useSelectedChildStore } from '@/store/selectedChildStore';

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

// Two-child family with cafetería activity, one low balance, one unread aviso.
const LINKED_DATA = {
  children_count: 2,
  children: [
    { id: 11, name: 'Luis López', grade: '3°', group: 'A', student_id: 'A-11' },
    { id: 12, name: 'Sofía López', grade: '1°', group: 'B', student_id: 'A-12' },
  ],
  cafeteria_balances: [
    { student: 11, student_name: 'Luis López', balance: '20.00', low: true, last_synced: '2026-08-01T00:00:00Z' },
    { student: 12, student_name: 'Sofía López', balance: '180.00', low: false, last_synced: '2026-08-01T00:00:00Z' },
  ],
  recent_payments: [
    { id: 1, type: 'cafeteria', amount: '200.00', status: 'success', date: '2026-08-01T00:00:00Z' },
  ],
  needs_family_link: false,
  announcements: [
    { id: 5, title: 'Junta de padres', body: 'Este viernes en el auditorio.', created_at: '2026-08-10T00:00:00Z' },
  ],
  unread_notifications: 3,
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

/** Assert `a` comes before `b` in DOM order (mobile reading order). */
function expectBefore(a: Node, b: Node) {
  expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

describe('ParentDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: { ...SAMPLE_USER },
      accessToken: 'test',
      isAuthenticated: true,
    });
    useSelectedChildStore.setState({ childId: null });
    trendProps.length = 0;
    categoriesProps.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
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
    expect(screen.queryByRole('link', { name: /Recargar cafetería/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it('a staff member’s own login: no «Agregar otro hijo», the puesto instead of «Alumnos»', async () => {
    getDashboard.mockResolvedValue({
      data: {
        ...LINKED_DATA,
        children_count: 1,
        children: [{ id: 21, name: 'Rosa Lince', grade: '', group: '', student_id: 'rlince', tipo: 'personal', puesto_label: 'Docente' }],
        cafeteria_balances: [{ student: 21, student_name: 'Rosa Lince', balance: '50.00', low: false, last_synced: '2026-11-18T00:00:00Z' }],
      },
    } as never);
    renderPage();
    expect(await screen.findByText('Personal del colegio')).toBeInTheDocument();
    expect(screen.getByText('Docente')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Agregar otro hijo/ })).toBeNull();
  });

  it('per-child quick top-ups open the wizard for that child (?hijo=)', async () => {
    getDashboard.mockResolvedValue({
      data: {
        ...LINKED_DATA,
        cafeteria_balances: [
          { student: 11, student_name: 'Luis López', balance: '20.00', low: true, last_synced: '2026-08-01T00:00:00Z' },
          { student: 12, student_name: 'Sofía López', balance: '180.00', low: false, last_synced: '2026-08-01T00:00:00Z' },
        ],
      },
    } as never);

    renderPage();

    const tiles = within(await screen.findByRole('list', { name: 'Saldo por alumno' }));
    expect(tiles.getByRole('link', { name: 'Recargar $100 a Sofía López' }))
      .toHaveAttribute('href', '/portal/cafeteria?recarga=100&hijo=12');
    expect(tiles.getByRole('link', { name: 'Recargar $200 a Luis López' }))
      .toHaveAttribute('href', '/portal/cafeteria?recarga=200&hijo=11');
  });

  it('never adds siblings up: the big card is the selected child, and switching changes it', async () => {
    getDashboard.mockResolvedValue({ data: LINKED_DATA } as never);
    renderPage();

    // Luis (first) by default: his own balance, never 20 + 180.
    const hero = () => screen.getByText(/^Saldo de /).closest('.card') as HTMLElement;
    expect(await screen.findByText('Saldo de Luis')).toBeInTheDocument();
    expect(within(hero()).getByText('$20.00')).toBeInTheDocument();
    expect(screen.queryByText('$200.00')).toBeNull();
    expect(screen.queryByText(/Suma de/)).toBeNull();
    expect(within(hero()).getByRole('link', { name: 'Recargar $500 a Luis López' }))
      .toHaveAttribute('href', '/portal/cafeteria?recarga=500&hijo=11');
    expect(within(hero()).getByRole('link', { name: /Otro monto/ }))
      .toHaveAttribute('href', '/portal/cafeteria?hijo=11');

    // Picking Sofía moves the card, its top-ups and the charts to her alone.
    const switcher = screen.getByRole('group', { name: /Seleccionar alumno/i });
    await userEvent.click(within(switcher).getByRole('button', { name: /Sofía López/ }));
    expect(await screen.findByText('Saldo de Sofía')).toBeInTheDocument();
    expect(within(hero()).getByText('$180.00')).toBeInTheDocument();
    expect(within(hero()).getByRole('link', { name: 'Recargar $500 a Sofía López' }))
      .toHaveAttribute('href', '/portal/cafeteria?recarga=500&hijo=12');
    await waitFor(() => expect(trendProps[trendProps.length - 1]).toBe(12));
    expect(categoriesProps[categoriesProps.length - 1]).toBe(12);
    expect(trendProps).not.toContain('all');
  });

  it('a child without an active wallet gets its own note, not a sibling\'s balance', async () => {
    useSelectedChildStore.setState({ childId: 12 });
    getDashboard.mockResolvedValue({
      data: { ...LINKED_DATA, cafeteria_balances: [LINKED_DATA.cafeteria_balances[0]] },
    } as never);
    renderPage();
    expect(await screen.findByText('Sofía López no tiene monedero activo')).toBeInTheDocument();
    expect(screen.queryByText(/^Saldo de /)).toBeNull();
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
        needs_family_link: false,
        announcements: [],
        unread_notifications: 0,
      },
    } as never);

    renderPage();

    expect(await screen.findByRole('link', { name: /Recargar cafetería/i })).toHaveAttribute(
      'href',
      '/portal/cafeteria',
    );
    expect(screen.queryByText(/Cuenta sin alumno vinculado/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Saldo Cafetería/i)).toBeInTheDocument();
    expect(screen.getByText(/Luis López/i)).toBeInTheDocument();
  });

  it('renders the v2 hierarchy in mobile-first DOM order without tuition strings', async () => {
    getDashboard.mockResolvedValue({ data: LINKED_DATA } as never);

    renderPage();

    const saldo = await screen.findByText('Saldo de Luis');
    // The alert names the child that is low (Luis), not the family.
    const alert = screen.getByText('Saldo bajo de Luis López.');
    expect(screen.queryByText(/Saldo bajo de Sofía/)).toBeNull();
    const switcher = screen.getByRole('group', { name: /Seleccionar alumno/i });
    // (1) alert → (2) switcher → (3) saldo + top-up.
    expectBefore(alert, switcher);
    expectBefore(switcher, saldo);

    // Bitácora 10 (14/10/2026): no comunicados and no payments on the family dashboard.
    expect(screen.queryByText('Avisos Escolares')).toBeNull();
    expect(screen.queryByText('Últimos Pagos')).toBeNull();

    // The tuition/colegiaturas UI must NOT resurface on the dashboard.
    expect(screen.queryByText(/colegiatura/i)).toBeNull();
  });

  it('quick top-up chips carry the preselected amount into the cafetería link', async () => {
    getDashboard.mockResolvedValue({ data: LINKED_DATA } as never);

    renderPage();
    const hero = (await screen.findByText('Saldo de Luis')).closest('.card') as HTMLElement;

    for (const amt of [100, 200, 500]) {
      expect(
        within(hero).getByRole('link', { name: `Recargar $${amt} a Luis López` }),
      ).toHaveAttribute('href', `/portal/cafeteria?recarga=${amt}&hijo=11`);
    }
  });

  it('greets by time of day in es-MX and shows the date', async () => {
    getDashboard.mockResolvedValue({ data: LINKED_DATA } as never);
    vi.useFakeTimers({ toFake: ['Date'] });

    vi.setSystemTime(new Date(2026, 7, 14, 8, 0, 0));
    let view = renderPage();
    expect(screen.getByRole('heading', { name: /Buenos días, Ana/ })).toBeInTheDocument();
    expect(screen.getByText(/14 de agosto de 2026/)).toBeInTheDocument();
    view.unmount();

    vi.setSystemTime(new Date(2026, 7, 14, 15, 0, 0));
    view = renderPage();
    expect(screen.getByRole('heading', { name: /Buenas tardes, Ana/ })).toBeInTheDocument();
    view.unmount();

    vi.setSystemTime(new Date(2026, 7, 14, 21, 0, 0));
    renderPage();
    expect(screen.getByRole('heading', { name: /Buenas noches, Ana/ })).toBeInTheDocument();
  });

  it('greetingForHour covers the es-MX day-part boundaries', () => {
    expect(greetingForHour(4)).toBe('Buenas noches');
    expect(greetingForHour(5)).toBe('Buenos días');
    expect(greetingForHour(11)).toBe('Buenos días');
    expect(greetingForHour(12)).toBe('Buenas tardes');
    expect(greetingForHour(19)).toBe('Buenas tardes');
    expect(greetingForHour(20)).toBe('Buenas noches');
  });

  it('refresh button invalidates the dashboard query and shows freshness', async () => {
    getDashboard.mockResolvedValue({ data: LINKED_DATA } as never);

    renderPage();
    await screen.findByText('Saldo de Luis');
    expect(getDashboard).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Actualizado hace/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }));

    await waitFor(() => expect(getDashboard).toHaveBeenCalledTimes(2));
  });

  it('shows per-card skeletons mirroring the layout while loading', () => {
    getDashboard.mockReturnValue(new Promise(() => {}) as never);

    renderPage();

    const shell = screen.getByLabelText('Cargando panel');
    expect(shell).toHaveAttribute('aria-busy', 'true');
    // Hero + stat, 2 quick actions, 2 section cards.
    expect(shell.querySelectorAll('.skeleton')).toHaveLength(6);
  });

  it('explains the cafetería wallet for linked families without activity', async () => {
    getDashboard.mockResolvedValue({
      data: {
        ...LINKED_DATA,
        cafeteria_balances: [],
        recent_payments: [],
        unread_notifications: 0,
      },
    } as never);

    renderPage();

    expect(await screen.findByText('Monedero de cafetería')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ir a Cafetería/i })).toHaveAttribute(
      'href',
      '/portal/cafeteria',
    );
    // No chips, no low-balance alert for a no-activity family — and the
    // needs_family_link empty state stays reserved for unlinked accounts.
    expect(screen.queryByRole('link', { name: /Recargar \$100/ })).toBeNull();
    expect(screen.queryByText(/Saldo bajo en cafetería/i)).toBeNull();
    expect(screen.queryByText(/Cuenta sin alumno vinculado/i)).toBeNull();
  });
});

describe('ParentDashboard: paid top-ups on their way (owner, 2026-11-19)', () => {
  const MONDAY = '2030-01-07T13:30:00Z';
  const TUESDAY = '2030-01-08T13:30:00Z';
  const item = (id: number, amount: string, apply_due_at: string | null = MONDAY) =>
    ({ id, amount, paid_at: '2030-01-04T22:00:00Z', apply_due_at, folio: id });
  const one = (balance: Record<string, unknown>) => ({
    ...LINKED_DATA,
    children_count: 1,
    children: [LINKED_DATA.children[0]],
    cafeteria_balances: [{ ...LINKED_DATA.cafeteria_balances[0], low: false, ...balance }],
  });
  const hero = () => screen.getByText('Recarga rápida').closest('.card') as HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: { ...SAMPLE_USER }, accessToken: 'test', isAuthenticated: true });
    useSelectedChildStore.setState({ childId: null });
  });

  it('the hero keeps the real balance and shows where it is heading', async () => {
    getDashboard.mockResolvedValue({ data: one({ balance: '150.00', pending_topups: '200.00', pending_topup_items: [item(7, '200.00')] }) } as never);
    renderPage();
    expect(await screen.findByText('Saldo en caja')).toBeInTheDocument();
    expect(within(hero()).getByText('$150.00')).toBeInTheDocument();
    expect(within(hero()).getByText('$350.00')).toBeInTheDocument();
    expect(within(hero()).getByText('Recarga de $200.00 pagada · disponible el lunes 7 de enero a las 7:30 a.m.')).toBeInTheDocument();
    expect(hero().querySelector('.sr-only')).toHaveTextContent(
      'Saldo actual $150.00. Con la recarga pagada de $200.00 será $350.00 a partir del lunes 7 de enero a las 7:30 a.m.');
    // The old amber «pagado, por aplicar» link is replaced by the line.
    expect(screen.queryByText(/pagado, por aplicar/)).toBeNull();
  });

  it('several load days: one summary and «Ver detalle» on the hero', async () => {
    getDashboard.mockResolvedValue({ data: one({
      balance: '150.00', pending_topups: '300.00', pending_topup_items: [item(7, '100.00'), item(8, '200.00', TUESDAY)],
    }) } as never);
    renderPage();
    expect(await screen.findByText(/2 recargas pagadas por \$300\.00 · todo disponible el martes 8 de enero/)).toBeInTheDocument();
    const toggle = within(hero()).getByRole('button', { name: 'Ver detalle de las recargas pagadas' });
    await userEvent.click(toggle);
    expect(within(hero()).getByText('El lunes 7 de enero a las 7:30 a.m.: $250.00 · recarga de $100.00 pagada')).toBeVisible();
  });

  it('two children: only the tile and hero of the one with a paid top-up change', async () => {
    getDashboard.mockResolvedValue({ data: {
      ...LINKED_DATA,
      cafeteria_balances: [
        { ...LINKED_DATA.cafeteria_balances[0], low: false, pending_topups: '200.00', pending_topup_items: [item(7, '200.00')] },
        { ...LINKED_DATA.cafeteria_balances[1], pending_topups: '0.00', pending_topup_items: [] },
      ],
    } } as never);
    renderPage();
    const tiles = within(await screen.findByRole('list', { name: 'Saldo por alumno' }));
    const [luis, sofia] = tiles.getAllByRole('listitem');
    expect(within(luis).getByText('$20.00')).toBeInTheDocument();
    expect(within(luis).getByText('$220.00')).toBeInTheDocument();
    expect(within(luis).getByText('Recarga de $200.00 pagada · disponible el lunes 7 de enero a las 7:30 a.m.')).toBeInTheDocument();
    expect(within(sofia).getByText('$180.00')).toBeInTheDocument();
    expect(sofia.querySelector('.sr-only')).toBeNull();
    expect(within(sofia).queryByText(/pagada/)).toBeNull();
    // Tiles keep the quick top-ups at the bottom, aligned across the row.
    expect(luis.className).toMatch(/flex-col/);
    expect(within(hero()).getByText('Saldo en caja de Luis')).toBeInTheDocument();
  });

  it('an older API with only the total still shows the projection, without a date', async () => {
    getDashboard.mockResolvedValue({ data: one({ balance: '150.00', pending_topups: '200.00' }) } as never);
    renderPage();
    expect(await screen.findByText('Recarga de $200.00 pagada · disponible el siguiente día hábil a las 7:30 a.m.')).toBeInTheDocument();
    expect(within(hero()).getByText('$350.00')).toBeInTheDocument();
  });

  it('nothing pending: the hero reads as before', async () => {
    getDashboard.mockResolvedValue({ data: one({ balance: '150.00', pending_topups: '0.00', pending_topup_items: [] }) } as never);
    renderPage();
    expect(await screen.findByText('Saldo Cafetería')).toBeInTheDocument();
    expect(within(hero()).getByText('$150.00')).toBeInTheDocument();
    expect(screen.queryByText('Saldo en caja')).toBeNull();
    expect(hero().querySelector('.sr-only')).toBeNull();
  });
});
