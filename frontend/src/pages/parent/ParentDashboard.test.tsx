import { type ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/services/api', () => ({
  portalApi: { getDashboard: vi.fn(), getNotifications: vi.fn(), markNotificationRead: vi.fn() },
  cafeteriaApi: { getSpendingTrend: vi.fn() },
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
import { HeaderChildSwitcher } from '@/components/portal/HeaderChildSwitcher';
import { cafeteriaApi, portalApi } from '@/services/api';
import { useAuthStore, type User } from '@/store/authStore';
import { useSelectedChildStore } from '@/store/selectedChildStore';

const getDashboard = vi.mocked(portalApi.getDashboard);
const getNotifications = vi.mocked(portalApi.getNotifications);
const getSpendingTrend = vi.mocked(cafeteriaApi.getSpendingTrend);

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

/** The page, optionally under the shell's header switcher (same QueryClient). */
function renderPage({ withHeader = false }: { withHeader?: boolean } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {withHeader && <header><HeaderChildSwitcher /></header>}
        <ParentDashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The selected child's wallet card. */
const hero = () => screen.getByTestId('wallet-hero');
/** The «Hoy» list. */
const hoy = () => within(screen.getByRole('list', { name: 'Pendientes de hoy' }));

/** Mock defaults every test starts from: no avisos, no spending. */
function apiDefaults() {
  getNotifications.mockResolvedValue({ data: [] } as never);
  getSpendingTrend.mockResolvedValue({ data: { days: 30, total: 0, average: 0, series: [] } } as never);
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
    apiDefaults();
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

  it('every top-up entry opens the wizard for its own child (?hijo=)', async () => {
    getDashboard.mockResolvedValue({ data: LINKED_DATA } as never);

    renderPage();

    // The selected child (Luis): the hero's quick amounts.
    expect(await within(await screen.findByTestId('wallet-hero')).findByRole('link', { name: 'Recargar $200 a Luis López' }))
      .toHaveAttribute('href', '/portal/cafeteria?recarga=200&hijo=11');
    // The other child: one «Recargar» on her row.
    const others = within(screen.getByRole('list', { name: 'Otros alumnos' }));
    expect(others.getByRole('link', { name: 'Recargar a Sofía López' }))
      .toHaveAttribute('href', '/portal/cafeteria?hijo=12');
    expect(others.getByText('$180.00')).toBeInTheDocument();
    // Luis's low balance: its own «Recargar» in «Hoy».
    expect(hoy().getByRole('link', { name: 'Recargar a Luis López' }))
      .toHaveAttribute('href', '/portal/cafeteria?hijo=11');
  });

  it('never adds siblings up: the hero is the selected child, and the header switcher re-scopes it', async () => {
    getDashboard.mockResolvedValue({ data: LINKED_DATA } as never);
    renderPage({ withHeader: true });

    // Luis (first) by default: his own balance, never 20 + 180.
    expect(await screen.findByText('Saldo de Luis')).toBeInTheDocument();
    expect(within(hero()).getByText('$20.00')).toBeInTheDocument();
    expect(screen.queryByText('$200.00')).toBeNull();
    expect(screen.queryByText(/Suma de/)).toBeNull();
    expect(within(hero()).getByRole('link', { name: 'Recargar $500 a Luis López' }))
      .toHaveAttribute('href', '/portal/cafeteria?recarga=500&hijo=11');
    expect(within(hero()).getByRole('link', { name: 'Elegir otro monto' }))
      .toHaveAttribute('href', '/portal/cafeteria?hijo=11');
    // The page itself has no picker any more: the header has the only one.
    expect(screen.queryByRole('group', { name: /Seleccionar alumno/i })).toBeNull();

    // Picking Sofía in the header moves the card, its top-ups and the charts to her alone.
    await userEvent.click(screen.getByRole('button', { name: /Alumno: Luis López/ }));
    const switcher = await screen.findByRole('group', { name: /Seleccionar alumno/i });
    await userEvent.click(within(switcher).getByRole('button', { name: /Sofía López/ }));
    expect(await screen.findByText('Saldo de Sofía')).toBeInTheDocument();
    expect(useSelectedChildStore.getState().childId).toBe(12);
    expect(within(hero()).getByText('$180.00')).toBeInTheDocument();
    expect(within(hero()).queryByText('$20.00')).toBeNull();
    expect(within(hero()).getByRole('link', { name: 'Recargar $500 a Sofía López' }))
      .toHaveAttribute('href', '/portal/cafeteria?recarga=500&hijo=12');
    // Luis is now one of «the other children», with his own balance.
    expect(within(screen.getByRole('list', { name: 'Otros alumnos' })).getByText('$20.00')).toBeInTheDocument();
    await waitFor(() => expect(trendProps[trendProps.length - 1]).toBe(12));
    expect(categoriesProps[categoriesProps.length - 1]).toBe(12);
    expect(trendProps).not.toContain('all');
    expect(screen.getByRole('button', { name: /Alumno: Sofía López/ })).toBeInTheDocument();
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

    expect(await screen.findByRole('link', { name: 'Elegir otro monto' })).toHaveAttribute(
      'href',
      '/portal/cafeteria',
    );
    expect(screen.getByRole('link', { name: 'Recargar $100 a Luis López' }))
      .toHaveAttribute('href', '/portal/cafeteria?recarga=100');
    expect(screen.getByRole('link', { name: /Mostrar credencial/ })).toHaveAttribute('href', '/portal/credencial');
    expect(screen.queryByText(/Cuenta sin alumno vinculado/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Saldo Cafetería/i)).toBeInTheDocument();
    expect(screen.getByText(/Luis López/i)).toBeInTheDocument();
  });

  it('renders the v2 hierarchy in mobile-first DOM order without tuition strings', async () => {
    getDashboard.mockResolvedValue({ data: LINKED_DATA } as never);

    renderPage();

    const saldo = await screen.findByText('Saldo de Luis');
    // «Hoy» names the child that is low (Luis), not the family.
    const alert = hoy().getByText('Saldo bajo de Luis');
    expect(screen.queryByText(/Saldo bajo de Sofía/)).toBeNull();
    const others = screen.getByRole('list', { name: 'Otros alumnos' });
    // (1) Hoy → (2) the selected child's wallet → (3) the other children.
    expectBefore(alert, saldo);
    expectBefore(saldo, others);
    // No duplicate quick-action cards (the tab bar has Cafetería and Credencial).
    expect(screen.queryByText('Credencial digital')).toBeNull();
    expect(screen.queryByText('Recargar cafetería')).toBeNull();

    // Bitácora 10 (14/10/2026): no comunicados and no payments on the family dashboard.
    expect(screen.queryByText('Avisos Escolares')).toBeNull();
    expect(screen.queryByText('Últimos Pagos')).toBeNull();

    // The tuition/colegiaturas UI must NOT resurface on the dashboard.
    expect(screen.queryByText(/colegiatura/i)).toBeNull();
  });

  it('quick top-up chips carry the preselected amount into the cafetería link', async () => {
    getDashboard.mockResolvedValue({ data: LINKED_DATA } as never);

    renderPage();
    await screen.findByText('Saldo de Luis');

    for (const amt of [100, 200, 500]) {
      expect(
        within(hero()).getByRole('link', { name: `Recargar $${amt} a Luis López` }),
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

  it('shows freshness without a boxed refresh button (the page refreshes itself)', async () => {
    getDashboard.mockResolvedValue({ data: LINKED_DATA } as never);

    renderPage();
    await screen.findByText('Saldo de Luis');
    expect(getDashboard).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Actualizado hace/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actualizar' })).toBeNull();
  });

  it('shows per-card skeletons mirroring the layout while loading', () => {
    getDashboard.mockReturnValue(new Promise(() => {}) as never);

    renderPage();

    const shell = screen.getByLabelText('Cargando panel');
    expect(shell).toHaveAttribute('aria-busy', 'true');
    // Hoy, wallet + figures, 2 section cards.
    expect(shell.querySelectorAll('.skeleton')).toHaveLength(5);
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
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: { ...SAMPLE_USER }, accessToken: 'test', isAuthenticated: true });
    useSelectedChildStore.setState({ childId: null });
    apiDefaults();
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

  it('two children: only the hero, row and «Hoy» line of the one with a paid top-up change', async () => {
    getDashboard.mockResolvedValue({ data: {
      ...LINKED_DATA,
      cafeteria_balances: [
        { ...LINKED_DATA.cafeteria_balances[0], low: false, pending_topups: '200.00', pending_topup_items: [item(7, '200.00')] },
        { ...LINKED_DATA.cafeteria_balances[1], pending_topups: '0.00', pending_topup_items: [] },
      ],
    } } as never);
    renderPage();
    expect(await within(await screen.findByTestId('wallet-hero')).findByText('Saldo en caja de Luis')).toBeInTheDocument();
    expect(within(hero()).getByText('$20.00')).toBeInTheDocument();
    expect(within(hero()).getByText('$220.00')).toBeInTheDocument();
    expect(within(hero()).getByText('Recarga de $200.00 pagada · disponible el lunes 7 de enero a las 7:30 a.m.')).toBeInTheDocument();
    const [sofia] = within(screen.getByRole('list', { name: 'Otros alumnos' })).getAllByRole('listitem');
    expect(within(sofia).getByText('$180.00')).toBeInTheDocument();
    expect(sofia.querySelector('.sr-only')).toBeNull();
    expect(within(sofia).queryByText(/pagada/)).toBeNull();
    // «Hoy» says it once, for Luis only, with where to follow it.
    expect(hoy().getByText('Recarga pagada de Luis')).toBeInTheDocument();
    expect(hoy().getByText('$200.00 · disponible el lunes 7 de enero a las 7:30 a.m.')).toBeInTheDocument();
    expect(hoy().queryByText(/de Sofía/)).toBeNull();
    expect(hoy().getByRole('link', { name: 'Ver movimientos de Luis López' })).toHaveAttribute('href', '/portal/cafeteria?hijo=11');
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

describe('ParentDashboard «Hoy» (Phase 6 pilot)', () => {
  const notif = (over: Record<string, unknown>) => ({
    id: 1, notif_type: 'info', title: 'Junta de padres', message: 'El viernes.', is_read: false,
    created_at: '2026-08-10T00:00:00Z', ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: { ...SAMPLE_USER }, accessToken: 'test', isAuthenticated: true });
    useSelectedChildStore.setState({ childId: null });
    apiDefaults();
  });

  it('nothing pending: one calm «Todo en orden» row', async () => {
    getDashboard.mockResolvedValue({ data: {
      ...LINKED_DATA,
      cafeteria_balances: LINKED_DATA.cafeteria_balances.map((b) => ({ ...b, low: false })),
      unread_notifications: 0,
    } } as never);
    renderPage();
    expect(await screen.findByText('Todo en orden')).toBeInTheDocument();
    expect(hoy().getAllByRole('listitem')).toHaveLength(1);
    expect(hoy().queryByRole('link')).toBeNull();
  });

  it('urgent avisos come before other unread ones, which fold into one row', async () => {
    getDashboard.mockResolvedValue({ data: { ...LINKED_DATA, cafeteria_balances: [] } } as never);
    getNotifications.mockResolvedValue({ data: [
      notif({ id: 1, title: 'Junta de padres' }),
      notif({ id: 2, title: 'Festival de invierno' }),
      notif({ id: 3, notif_type: 'warning', title: 'Suspensión de clases mañana' }),
      notif({ id: 4, title: 'Ya leído', is_read: true }),
    ] } as never);
    renderPage();
    const urgent = await screen.findByText('Suspensión de clases mañana');
    const rows = hoy().getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Suspensión de clases mañana')).toBe(urgent);
    expect(within(rows[0]).getByRole('link', { name: 'Leer el aviso: Suspensión de clases mañana' }))
      .toHaveAttribute('href', '/portal/notificaciones/3');
    expect(within(rows[1]).getByText('2 avisos sin leer')).toBeInTheDocument();
    expect(within(rows[1]).getByRole('link', { name: /Ver avisos/ })).toHaveAttribute('href', '/portal/notificaciones?sin_leer=1');
    expect(screen.queryByText('Ya leído')).toBeNull();
  });

  it('a single unread aviso gets its own row; opening it marks it read', async () => {
    getDashboard.mockResolvedValue({ data: { ...LINKED_DATA, cafeteria_balances: [] } } as never);
    vi.mocked(portalApi.markNotificationRead).mockResolvedValue({ data: {} } as never);
    getNotifications.mockResolvedValue({ data: [notif({ id: 9, title: 'Junta de padres' })] } as never);
    renderPage();
    const link = await screen.findByRole('link', { name: 'Leer el aviso: Junta de padres' });
    await userEvent.click(link);
    await waitFor(() => expect(portalApi.markNotificationRead).toHaveBeenCalledWith(9));
  });

  it('never more than four rows, low balances first, and no duplicate «saldo bajo» aviso', async () => {
    getDashboard.mockResolvedValue({ data: {
      ...LINKED_DATA,
      cafeteria_balances: LINKED_DATA.cafeteria_balances.map((b) => ({ ...b, low: true })),
    } } as never);
    getNotifications.mockResolvedValue({ data: [
      notif({ id: 1, notif_type: 'warning', title: 'Saldo bajo de Luis' }),
      notif({ id: 2, notif_type: 'warning', title: 'Suspensión de clases' }),
      notif({ id: 3, notif_type: 'warning', title: 'Simulacro' }),
      notif({ id: 4, notif_type: 'warning', title: 'Vacunación' }),
    ] } as never);
    renderPage();
    await screen.findByText('Suspensión de clases');
    const rows = hoy().getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByText('Saldo bajo de Luis')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Saldo bajo de Sofía')).toBeInTheDocument();
    expect(within(rows[1]).getByRole('link', { name: 'Recargar a Sofía López' })).toHaveAttribute('href', '/portal/cafeteria?hijo=12');
    // The «saldo bajo» alert is the row above, not a second one.
    expect(hoy().getAllByText(/Saldo bajo de Luis/)).toHaveLength(1);
  });

  it('shows the selected child’s figures from the spending query', async () => {
    getSpendingTrend.mockResolvedValue({ data: { days: 30, total: 450, average: 15, series: [] } } as never);
    getDashboard.mockResolvedValue({ data: LINKED_DATA } as never);
    renderPage();
    expect(await screen.findByText('$450.00')).toBeInTheDocument();
    expect(screen.getByText('Consumo en 30 días')).toBeInTheDocument();
    expect(screen.getByText('$15.00')).toBeInTheDocument();
    expect(getSpendingTrend).toHaveBeenCalledWith(30, 11);
  });
});
