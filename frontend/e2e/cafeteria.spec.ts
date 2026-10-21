import { test, expect, type Page } from '@playwright/test';
import { login, portalNav, DEV_PARENT } from './helpers';

/**
 * Cafeteria online top-up — the money path. Balance/transactions/top-up and the
 * Banorte checkout hand-off are stubbed (page.route + a fake payment page); auth
 * is real. We assert the app POSTs the top-up with the amount and method (no
 * gateway choice: Banorte only), follows the returned redirect, and that the return page
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

  // Card payment open for this family (live, or a listed tester).
  await page.route('**/api/v1/payments/availability/', (route) =>
    route.fulfill({ json: { online: true, test_mode: false } }));
  // Saved «Titular de la tarjeta» (Banorte requires it on every card payment).
  await page.route('**/api/v1/payments/billing-profile/', (route) =>
    route.fulfill({ json: { data: {
      first_name: 'Ana', last_name: 'Pérez', street: 'Hidalgo', street_number: '12', street_number_2: '',
      colonia: 'Centro', municipio: 'Tlalnepantla', city: 'Tlalnepantla', state: 'EM',
      postal_code: '54000', phone: '5512345678', email: 'ana@familia.mx',
    }, states: [] } }));
  await page.route('**/api/v1/cafeteria/topup/', (route) => {
    captured.payload = route.request().postDataJSON();
    // Dev shape (no Banorte credentials): a redirect to the mock page.
    route.fulfill({ json: { checkout: { kind: 'redirect', url: '/pago-simulado' }, redirect_url: '/pago-simulado' } });
  });
  await page.route('**/pago-simulado', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Pasarela simulada</h1>' }));

  return { get topupPayload() { return captured.payload; } };
}

test('an online cafeteria top-up from the Cafetería page opens the Banorte checkout', async ({ page }) => {
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
  // 3-step wizard (P1-D2): monto → método (tarjeta vía Banorte) → confirmar.
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByLabel('Colonia')).toHaveValue('Centro');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: /ir a pagar/i }).click();

  await page.waitForURL('**/pago-simulado');
  expect(stub.topupPayload).toMatchObject({
    student: 3, amount: 200, method: 'online',
  });
  expect(stub.topupPayload).not.toHaveProperty('gateway');
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

  // Step 2 has a single online option: card through Banorte.
  await modal.getByRole('button', { name: 'Continuar' }).click();
  await expect(modal.getByText(/Pago seguro con Banorte/)).toBeVisible();
  await expect(modal.getByLabel('Colonia')).toHaveValue('Centro');
  await modal.getByRole('button', { name: 'Continuar' }).click();
  await modal.getByRole('button', { name: /ir a pagar/i }).click();

  await page.waitForURL('**/pago-simulado');
  expect(stub.topupPayload).toMatchObject({
    student: 3, amount: 200, method: 'online',
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
    await expect(page.getByRole('link', { name: /ver saldo de cafetería/i })).toBeVisible();
  });

  test('a paid top-up waiting for the 7:30 POS load says so and offers WhatsApp', async ({ page }) => {
    await page.route('**/api/v1/payments/55/', (route) =>
      route.fulfill({ json: {
        id: 55, status: 'success', amount: '200.00',
        topup: { id: 9, status: 'paid', apply_due_at: '2030-01-07T13:30:00Z', applied_at: null },
      } }));
    await login(page, DEV_PARENT);
    await page.goto('/portal/cafeteria/recarga/retorno?payment_id=55');
    await expect(page.getByRole('heading', { name: 'Pago recibido' })).toBeVisible();
    await expect(page.getByText('el lunes 7 de enero a las 7:30 a.m.')).toBeVisible();
    await expect(page.getByRole('link', { name: /La necesito hoy: WhatsApp/ }))
      .toHaveAttribute('href', /^https:\/\/wa\.me\/52\d{10}\?text=/);
  });

  test('a failed payment shows the failure state', async ({ page }) => {
    await openReturn(page, 'failed');
    await expect(page.getByRole('heading', { name: 'La recarga no se completó' })).toBeVisible();
    await expect(page.getByText(/Si ve un cargo en su estado de cuenta/)).toBeVisible();
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
