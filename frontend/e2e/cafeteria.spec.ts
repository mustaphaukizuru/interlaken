import { test, expect } from '@playwright/test';
import { login, DEV_PARENT } from './helpers';

/**
 * Cafeteria online top-up initiation. Balance + transactions + the top-up
 * endpoint are stubbed; auth is real. We assert the app POSTs the top-up with
 * the amount, method and chosen gateway and follows the returned redirect.
 */
test('an online cafeteria top-up initiates the gateway redirect', async ({ page }) => {
  await page.route('**/api/v1/cafeteria/balance/', (route) => {
    route.fulfill({
      json: [{
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
      }],
    });
  });
  await page.route('**/api/v1/cafeteria/transactions/**', (route) =>
    route.fulfill({ json: { results: [] } }));

  let payload: any = null;
  await page.route('**/api/v1/cafeteria/topup/', (route) => {
    payload = route.request().postDataJSON();
    route.fulfill({ json: { redirect_url: '/pago-simulado' } });
  });
  await page.route('**/pago-simulado', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Pasarela simulada</h1>' }));

  // Log in as a parent (lands on /portal) and navigate client-side via the
  // sidebar — no full reload, so in-memory auth persists (robust on cold CI).
  await login(page, DEV_PARENT);
  // exact: true — the dashboard "Recargar cafetería" QuickAction card shares the
  // accessible name, so scope to the sidebar nav link.
  await page.getByRole('link', { name: 'Cafetería', exact: true }).click();
  await expect(page).toHaveURL(/\/portal\/cafeteria/);

  await expect(page.getByText('Test Alumno')).toBeVisible();
  await page.getByRole('button', { name: /recargar/i }).first().click(); // open top-up modal
  await page.getByPlaceholder('Ej. 200').fill('200');
  await page.getByRole('button', { name: /continuar al pago/i }).click();

  await page.waitForURL('**/pago-simulado');
  expect(payload).toMatchObject({ amount: 200, method: 'online', gateway: 'global_payments' });
});
