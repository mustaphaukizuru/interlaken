import { type ReactElement, type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'vitest-axe';

// One shared api mock serves every page in this file. Query methods resolve
// minimal deterministic data so each page renders its real layout (not just
// skeletons); handler-only methods are plain spies.
vi.mock('@/services/api', () => {
  const ok = (data: unknown) => vi.fn().mockResolvedValue({ data });
  const emptyPage = { results: [], count: 0 };
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
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
    authApi: { me: vi.fn(), googleLogin: vi.fn() },
    bootstrapSession: vi.fn(),
    downloadBlob: vi.fn(),
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
    paymentsApi: { getMyPayments: ok(emptyPage) },
    cafeteriaApi: {
      getMyBalance: ok([cafeteriaAccount]),
      getTransactions: ok(emptyPage),
      getSpendingCategories: ok({ days: 30, total: 0, categories: [] }),
      getSpendingTrend: ok({ days: 30, total: 0, average: 0, series: [] }),
      getAllBalances: ok({ results: [cafeteriaAccount], count: 1 }),
      getTopUpLog: ok(emptyPage),
      getLowBalance: ok(emptyPage),
      requestTopUp: vi.fn(),
      updateLowBalanceThreshold: vi.fn(),
      updateSpendLimits: vi.fn(),
      reconcile: vi.fn(),
      syncAll: vi.fn(),
      syncBalance: vi.fn(),
      markTopUpPosLoaded: vi.fn(),
      markTopUpPosUnloaded: vi.fn(),
      exportSchool: vi.fn(),
      exportMovements: vi.fn(),
    },
    financeApi: {
      getDashboard: ok({
        period: '2026-08',
        billed: '1000.00',
        collected: '800.00',
        outstanding: '200.00',
        collection_rate: 80,
        invoices: 1,
        paid: 1,
        overdue: 0,
        pending: 0,
        overpaid: 0,
        overpaid_credit: '0.00',
      }),
      getAdminInvoices: ok(emptyPage),
      generate: vi.fn(),
      markPaid: vi.fn(),
      cancelInvoice: vi.fn(),
      refundOverpayment: vi.fn(),
      adjustInvoice: vi.fn(),
      getAdminInvoice: vi.fn(),
      bulkAction: vi.fn(),
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
import AdminFinance from '@/pages/admin/AdminFinance';
import AdminCafeteria from '@/pages/admin/AdminCafeteria';
import { renderWithProviders } from '@/test/renderWithProviders';

/**
 * Runtime a11y smoke test (axe-core). Catches ARIA misuse, unlabeled controls
 * and role errors on critical surfaces — complements the static
 * eslint-plugin-jsx-a11y pass. (Colour contrast isn't computable under jsdom, so
 * axe reports it as "incomplete", not a violation.)
 */
describe('accessibility smoke (axe)', () => {
  it('LoginPage has no detectable a11y violations', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>,
    );
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
  { name: 'AdminFinance', ui: () => <AdminFinance />, route: '/admin/finanzas' },
  { name: 'AdminCafeteria', ui: () => <AdminCafeteria />, route: '/admin/cafeteria' },
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
