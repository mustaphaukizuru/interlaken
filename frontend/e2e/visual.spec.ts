import { test, expect, type Page, type Locator } from '@playwright/test';
import { login, portalNav, DEV_PARENT } from './helpers';

/**
 * Visual regression — viewport screenshots of the highest-value pages at mobile
 * (390×844) and desktop (1280×800).
 *
 * CI-stability measures:
 *  - prefers-reduced-motion is emulated BEFORE navigation (Reveal/framer/recharts
 *    land in their final state instead of mid-animation);
 *  - the clock is fixed (greetings, "hace X min", month pickers, footer years);
 *  - all animations/transitions/carets are killed with an injected style tag;
 *  - fonts are awaited (document.fonts.ready);
 *  - portal/admin data is fully stubbed, so no live figure ever shifts;
 *  - the few remaining environment-sensitive regions (native month input) are
 *    masked.
 *
 * Baselines are platform-suffixed (…-win32.png / …-linux.png). See e2e/README.md
 * for the update procedure.
 */

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

// Monday 10:00 local — "Buenos días", stable relative dates.
const FIXED_NOW = new Date('2026-08-10T10:00:00');

/** Must run BEFORE any navigation so first paint already honors it. */
async function freezeEnvironment(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.setFixedTime(FIXED_NOW);
}

/** Kill animations + wait for fonts once the target route has rendered. */
async function settle(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
      html { scroll-behavior: auto !important; }
    `,
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
}

/** Screenshot the current page at both breakpoints. */
async function snapBothViewports(page: Page, slug: string, mask: Locator[] = []) {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await settle(page);
    await expect(page).toHaveScreenshot(`${slug}-${vp.name}.png`, { mask });
  }
}

test.describe('Visual baselines', () => {
  test.beforeEach(async ({ page }) => {
    await freezeEnvironment(page);
  });

  test('home', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('main')).toBeVisible();
    await snapBothViewports(page, 'home');
  });

  test('costos', async ({ page }) => {
    await page.goto('/admisiones/costos');
    await expect(page.getByRole('main')).toBeVisible();
    await snapBothViewports(page, 'costos');
  });

  test('admisiones', async ({ page }) => {
    await page.goto('/admisiones');
    await expect(page.getByRole('main')).toBeVisible();
    await snapBothViewports(page, 'admisiones');
  });

  test('login', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: /ingresar/i })).toBeVisible();
    await snapBothViewports(page, 'login');
  });

  test('portal dashboard (parent, stubbed data)', async ({ page }) => {
    await page.route('**/api/v1/portal/dashboard/', (route) =>
      route.fulfill({
        json: {
          children_count: 1,
          children: [{ id: 3, name: 'Test Alumno', grade: '3° Primaria', group: 'A', student_id: 'A-003' }],
          cafeteria_balances: [
            { student_name: 'Test Alumno', balance: '230.00', low: false, last_synced: '2026-08-09T12:00:00Z' },
          ],
          recent_payments: [
            { id: 9, type: 'cafeteria', amount: '200.00', status: 'success', date: '2026-08-05T10:00:00Z' },
          ],
          announcements: [{
            id: 101,
            title: 'Suspensión de clases',
            body: 'Mañana no habrá clases por mantenimiento del plantel.',
            created_at: '2026-08-08T12:00:00Z',
          }],
          unread_notifications: 0,
        },
      }));
    await page.route('**/api/v1/portal/announcements/mark-read/', (route) =>
      route.fulfill({ json: { updated: 0 } }));
    await page.route('**/api/v1/cafeteria/balance/', (route) =>
      route.fulfill({
        json: [{
          id: 7, balance: '230.00', low_balance_threshold: '50',
          last_synced: '2026-08-09T12:00:00Z',
          student: {
            id: 3, grade: '3° Primaria', group: 'A', student_id: 'A-003',
            loyverse_id: 'loy-test-alumno', user: { full_name: 'Test Alumno' },
          },
        }],
      }));
    await page.route('**/api/v1/cafeteria/spending-trend/**', (route) =>
      route.fulfill({
        json: {
          days: 30, total: 180, average: 6,
          series: [
            { date: '2026-08-03', amount: 20 },
            { date: '2026-08-04', amount: 35 },
            { date: '2026-08-05', amount: 0 },
            { date: '2026-08-06', amount: 55 },
            { date: '2026-08-07', amount: 70 },
          ],
        },
      }));
    await page.route('**/api/v1/cafeteria/spending-categories/**', (route) =>
      route.fulfill({
        json: {
          days: 30, total: 180,
          categories: [
            { category: 'Comida', total: 120, count: 8, pct: 66.7 },
            { category: 'Bebidas', total: 60, count: 4, pct: 33.3 },
          ],
        },
      }));

    await login(page, DEV_PARENT);
    await expect(page).toHaveURL(/\/portal\/?$/);
    await expect(page.getByText('$230.00').first()).toBeVisible();
    await snapBothViewports(page, 'portal-dashboard');
  });

  test('admin finanzas (stubbed data)', async ({ page }) => {
    await page.route('**/api/v1/finance/admin/dashboard/**', (route) =>
      route.fulfill({
        json: {
          billed: '2500.00', collected: '0.00', outstanding: '2500.00',
          collection_rate: 0, overpaid: 0, overpaid_credit: '0.00',
        },
      }));
    await page.route('**/api/v1/finance/admin/invoices/**', (route) =>
      route.fulfill({
        json: {
          count: 1,
          results: [{
            id: 42, student_name: 'Test Alumno', student_code: 'A-003', grade: '3° Primaria',
            period: '2026-08', period_label: 'Agosto 2026', amount: '2500.00',
            amount_paid: '0.00', balance_due: '2500.00', currency: 'MXN',
            status: 'pending', status_display: 'Pendiente', due_date: '2026-08-05',
          }],
        },
      }));

    await login(page); // admin
    await portalNav(page).getByRole('link', { name: 'Finanzas', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/finanzas/);
    // Desktop default viewport → assert the table row (the mobile card with the
    // same text is display:none here).
    await expect(page.getByRole('table').getByText('Test Alumno')).toBeVisible();
    // The native month input renders differently across platforms — mask it.
    await snapBothViewports(page, 'admin-finanzas', [page.getByLabel('Periodo')]);
  });
});
