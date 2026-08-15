import { test, expect, type Page } from '@playwright/test';
import { login, portalNav, DEV_PARENT } from './helpers';

/**
 * Cafeteria online top-up — the money path. Balance/transactions/top-up and the
 * hosted-payment hand-off are stubbed (page.route + a fake gateway page); auth
 * is real. We assert the app POSTs the top-up with the amount, method and the
 * chosen gateway, follows the returned redirect, and that the return page
 * (cafeteria/recarga/retorno) renders the success/failed/processing outcomes.
 */

const BALANCES = [{
  id: 7,
  balance: '30.00',
  low_balance_threshold: '50',
  last_synced: '2026-07-11T12:00:00Z',
  student: {
    id: 3,
    grade: '3° Primaria',
    group: 'A',
    student_id: 'A-003',
    loyverse_id: 'loy-test-alumno',
    user: { full_name: 'Test Alumno' },
  },
}];

/** Stub the cafeteria read APIs + capture the top-up POST + fake gateway page. */
async function stubCafeteria(page: Page): Promise<{ readonly topupPayload: unknown }> {
  const captured: { payload: unknown } = { payload: null };

  await page.route('**/api/v1/cafeteria/balance/', (route) =>
    route.fulfill({ json: BALANCES }));
  await page.route('**/api/v1/cafeteria/transactions/**', (route) =>
    route.fulfill({ json: { count: 0, results: [] } }));
  await page.route('**/api/v1/cafeteria/spending-categories/**', (route) =>
    route.fulfill({ json: { days: 30, total: 0, categories: [] } }));
  await page.route('**/api/v1/cafeteria/spending-trend/**', (route) =>
    route.fulfill({ json: { days: 30, total: 0, average: 0, series: [] } }));

  await page.route('**/api/v1/cafeteria/topup/', (route) => {
    captured.payload = route.request().postDataJSON();
    route.fulfill({ json: { redirect_url: '/pago-simulado' } });
  });
  await page.route('**/pago-simulado', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Pasarela simulada</h1>' }));

  return { get topupPayload() { return captured.payload; } };
}

test('an online cafeteria top-up from the Cafetería page initiates the gateway redirect', async ({ page }) => {
  const stub = await stubCafeteria(page);

  // Log in as a parent (lands on /portal) and navigate client-side via the
  // sidebar — no full reload, so in-memory auth persists (robust on cold CI).
  await login(page, DEV_PARENT);
  // exact: true — the dashboard "Recargar cafetería" QuickAction card shares the
  // accessible name, so scope to the sidebar nav link.
  await portalNav(page).getByRole('link', { name: 'Cafetería', exact: true }).click();
  await expect(page).toHaveURL(/\/portal\/cafeteria/);

  await expect(page.getByText('Test Alumno')).toBeVisible();
  await page.getByRole('button', { name: /recargar/i }).first().click(); // open top-up modal
  await page.getByPlaceholder('Ej. 200').fill('200');
  // Default gateway is Global Payments (PaymentMethodPicker's first option).
  await page.getByRole('button', { name: /continuar al pago/i }).click();

  await page.waitForURL('**/pago-simulado');
  expect(stub.topupPayload).toMatchObject({
    student: 3, amount: 200, method: 'online', gateway: 'global_payments',
  });
});

test('the dashboard quick chip deep-links into the top-up modal with the amount prefilled', async ({ page }) => {
  const stub = await stubCafeteria(page);

  // Deterministic dashboard: one Loyverse-linked child with cafeteria balance so
  // the saldo hero card (and its quick-recarga chips) renders.
  await page.route('**/api/v1/portal/dashboard/', (route) =>
    route.fulfill({
      json: {
        children_count: 1,
        children: [{ id: 3, name: 'Test Alumno', grade: '3° Primaria', group: 'A', student_id: 'A-003' }],
        cafeteria_balances: [
          { student_name: 'Test Alumno', balance: '30.00', low: false, last_synced: '2026-07-11T12:00:00Z' },
        ],
        recent_payments: [],
        announcements: [],
        unread_notifications: 0,
      },
    }));

  await login(page, DEV_PARENT);
  await expect(page).toHaveURL(/\/portal\/?$/);

  // The $200 chip navigates to /portal/cafeteria?recarga=200 …
  await page.getByRole('link', { name: 'Recargar $200 en cafetería' }).click();
  await expect(page).toHaveURL(/\/portal\/cafeteria/);

  // … which opens the top-up modal with the amount prefilled (param consumed).
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible();
  await expect(modal.getByLabel('Monto (MXN)')).toHaveValue('200');

  // Choose the OTHER gateway to prove the selection reaches the payload.
  await modal.getByRole('button', { name: /Banorte Pago en Línea/ }).click();
  await modal.getByRole('button', { name: /continuar al pago/i }).click();

  await page.waitForURL('**/pago-simulado');
  expect(stub.topupPayload).toMatchObject({
    student: 3, amount: 200, method: 'online', gateway: 'banorte',
  });
});

test.describe('top-up return page (cafeteria/recarga/retorno)', () => {
  /** Route the payment-status endpoint, then open the return page as a parent. */
  async function openReturn(page: Page, status: string) {
    await page.route('**/api/v1/payments/55/', (route) =>
      route.fulfill({ json: { id: 55, status } }));
    await login(page, DEV_PARENT);
    await page.goto('/portal/cafeteria/recarga/retorno?payment_id=55');
  }

  test('a confirmed payment shows the success state', async ({ page }) => {
    await openReturn(page, 'success');
    await expect(page.getByRole('heading', { name: 'Pago confirmado' })).toBeVisible();
    await expect(page.getByRole('link', { name: /volver a cafetería/i })).toBeVisible();
  });

  test('a failed payment shows the failure state', async ({ page }) => {
    await openReturn(page, 'failed');
    await expect(page.getByRole('heading', { name: 'La recarga no se completó' })).toBeVisible();
    await expect(page.getByText('No se realizó ningún cargo')).toBeVisible();
  });

  test('a payment still processing shows the pending state after polling', async ({ page }) => {
    // Status never resolves — the page polls MAX_POLLS times (2 s apart) and
    // then concludes "en proceso". ~8 s wall time; expect timeout covers it.
    await openReturn(page, 'processing');
    await expect(page.getByRole('heading', { name: 'Confirmando su pago…' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recarga en proceso' }))
      .toBeVisible({ timeout: 20_000 });
  });
});
