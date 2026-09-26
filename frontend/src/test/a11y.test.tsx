import { type ReactElement, type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';

// One shared api mock serves every page in this file. Query methods resolve
// minimal deterministic data so each page renders its real layout (not just
// skeletons); handler-only methods are plain spies.
vi.mock('@/services/api', async () => {
  const ok = (data: unknown) => vi.fn().mockResolvedValue({ data });
  const emptyPage = { results: [], count: 0 };
  const payment = {
    id: 11, payment_type: 'cafeteria', amount: '150.00', currency: 'MXN', description: 'Ana Tutor', status: 'success',
    gateway: 'banorte', gateway_label: 'Banorte', gateway_tx_id: 'TX-1', student_id: 10, student_name: 'Emma Quintana',
    created_at: '2026-09-20T10:00:00Z', updated_at: '2026-09-20T10:00:00Z',
  };
  const auditEntry = {
    id: 1, actor: 1, actor_label: 'ana@x.mx', action: 'update', action_display: 'Modificación', object_type: 'StudentProfile',
    object_id: '9', changes: { grade: ['1°', '2°'] }, context: 'import:students', created_at: '2026-09-20T10:00:00Z',
  };
  const cafeteriaAccount = {
    id: 1,
    student: {
      id: 10,
      user: { full_name: 'Emma Quintana' },
      student_id: '09824',
      grade: '4°',
      group: 'A',
      loyverse_id: 'loy-emma',
    },
    balance: '150.00',
    low_balance_threshold: '50',
    last_synced: '2026-08-01T12:00:00Z',
  };
  return {
    // Data Ops contracts (types + pure helpers) are re-exported from api.ts.
    ...(await vi.importActual<typeof import('@/services/dataOps')>('@/services/dataOps')),
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
    authApi: { me: vi.fn(), googleLogin: vi.fn() },
    bootstrapSession: vi.fn(),
    downloadBlob: vi.fn(),
    coreApi: { getAuditLog: ok({ results: [auditEntry], count: 1 }), exportAuditLog: vi.fn() },
    portalApi: {
      getDashboard: ok({
        children_count: 1,
        children: [{ id: 10, name: 'Emma Quintana' }],
        cafeteria_balances: [],
        recent_payments: [],
        needs_family_link: false,
        announcements: [],
        unread_notifications: 0,
      }),
      markAnnouncementsRead: ok({}),
    },
    paymentsApi: {
      getMyPayments: ok(emptyPage),
      adminList: ok({ results: [payment], count: 1 }),
      adminSummary: ok({ days: 30, since: '2026-08-22', by_status: { success: { count: 1, total: '150.00' } }, stuck_pending: 0, series: [{ date: '2026-09-20', total: '150.00', count: 1 }] }),
      adminExport: vi.fn(),
    },
    cafeteriaApi: {
      getMyBalance: ok([cafeteriaAccount]),
      getTransactions: ok(emptyPage),
      getSpendingCategories: ok({ days: 30, total: 0, categories: [] }),
      getSpendingTrend: ok({ days: 30, total: 0, average: 0, series: [] }),
      requestTopUp: vi.fn(),
      updateLowBalanceThreshold: vi.fn(),
      updateSpendLimits: vi.fn(),
      syncAll: vi.fn(),
      syncBalance: vi.fn(),
      markTopUpPosLoaded: vi.fn(),
      markTopUpPosUnloaded: vi.fn(),
      exportMovements: vi.fn(),
    },
    contentApi: {
      getPricing: ok({
        enrollment_fees: [
          { section: 'Primaria', modality: 'nuevo_ingreso', gastos_administrativos: '2500.00', cuota: '6800.00', order: 1 },
        ],
        tuition: [{ section: 'Primaria', inscripcion: '8800.00', colegiatura: '6450.00', order: 1 }],
        fixed_concepts: [{ name: 'Seguro accidentes', cost: '500.00', mandatory: true, order: 1 }],
        extracurriculars: [{ name: 'Karate', levels: 'Primaria', annual_cost: '4200.00', order: 1 }],
        daycare: [
          { schedule: 'Hasta 15:50', service: 'Comida y estancia', daily_cost: '150.00', monthly_cost: '2670.00', monthly_note: '', order: 1 },
        ],
        policies: [{ text: 'Los costos pueden actualizarse cada ciclo escolar.', order: 1 }],
      }),
    },
  };
});
// Admin Cafetería lists (Data Ops Phase 6): a populated Saldos table.
vi.mock('@/services/cafeteriaAdmin', () => {
  const balance = {
    id: 1, balance: '150.00', low_balance_threshold: '50', last_synced: '2026-08-01T12:00:00Z',
    student: { id: 10, user: { full_name: 'Emma Quintana' }, student_id: '09824', loyverse_code: 'ci09824', grade: '4°', group: 'A', loyverse_id: 'loy-emma' },
  };
  return {
    cafeteriaAdminApi: { balances: vi.fn().mockResolvedValue({ data: { count: 1, next: null, previous: null, results: [balance] } }) },
    adjustmentImportApi: vi.fn(),
  };
});
// No real HTTP / toasts while rendering.
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
// jsdom has no IntersectionObserver — render Reveal content directly.
vi.mock('@/components/ui/Reveal', () => ({
  Reveal: ({ children }: { children: ReactNode }) => <>{children}</>,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
// Web-push opt-in depends on browser APIs jsdom lacks; it renders nothing there.
vi.mock('@/components/portal/PushOptIn', () => ({ PushOptIn: () => null }));

import LoginPage from '@/pages/auth/LoginPage';
import ParentDashboard from '@/pages/parent/ParentDashboard';
import CafeteriaPage from '@/pages/parent/CafeteriaPage';
import PaymentsPage from '@/pages/parent/PaymentsPage';
import CostosPage from '@/pages/public/CostosPage';
import AdminCafeteria from '@/pages/admin/AdminCafeteria';
import AdminPayments from '@/pages/admin/AdminPayments';
import AdminAudit from '@/pages/admin/AdminAudit';
import { renderWithProviders } from '@/test/renderWithProviders';

/**
 * Runtime a11y smoke test (axe-core). Catches ARIA misuse, unlabeled controls
 * and role errors on critical surfaces — complements the static
 * eslint-plugin-jsx-a11y pass. (Colour contrast isn't computable under jsdom, so
 * axe reports it as "incomplete", not a violation.)
 */
describe('accessibility smoke (axe)', () => {
  it('LoginPage has no detectable a11y violations', async () => {
    // LoginPage now reads site settings (WhatsApp/email for password help), so
    // it needs the QueryClient the shared helper provides.
    const { container } = renderWithProviders(<LoginPage />, { route: '/login' });
    const results = await axe(container);
    // Assert on `violations` directly so no custom-matcher type augmentation is
    // needed; a failure prints the offending nodes.
    expect(results.violations).toEqual([]);
  });
});

const PAGES: { name: string; ui: () => ReactElement; route: string }[] = [
  { name: 'ParentDashboard', ui: () => <ParentDashboard />, route: '/portal' },
  { name: 'CafeteriaPage', ui: () => <CafeteriaPage />, route: '/portal/cafeteria' },
  { name: 'PaymentsPage', ui: () => <PaymentsPage />, route: '/portal/pagos' },
  { name: 'CostosPage', ui: () => <CostosPage />, route: '/admisiones/costos' },
  { name: 'AdminCafeteria', ui: () => <AdminCafeteria />, route: '/admin/cafeteria' },
  // Data Ops reference pages: FilterBar + DataTable v2 (selection, column controls) + ExportMenu v2.
  { name: 'AdminPayments', ui: () => <AdminPayments />, route: '/admin/pagos' },
  { name: 'AdminAudit', ui: () => <AdminAudit />, route: '/admin/auditoria' },
];

/**
 * Broader sweep: each page renders with its initial queries resolved, then axe
 * runs filtered to serious + critical impact (minor/moderate findings — e.g.
 * landmark/heading-order advisories — are tracked separately, not gated here).
 */
describe('page sweep — no serious/critical axe violations', () => {
  it.each(PAGES)('$name', async ({ ui, route }) => {
    const { container } = renderWithProviders(ui(), { route });
    // Wait for the initial queries to settle so axe scans the real layout,
    // not the loading skeletons.
    await waitFor(() => {
      expect(container.querySelector('.skeleton')).toBeNull();
    });
    const results = await axe(container);
    const gating = results.violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact ?? ''),
    );
    expect(gating).toEqual([]);
  });
});
