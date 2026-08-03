import { test, expect } from '@playwright/test';
import { login, DEV_PARENT } from './helpers';

/**
 * Tuition payment initiation. The invoice list and the pay endpoint are stubbed
 * so the flow is deterministic without gateway credentials or seeded invoices;
 * auth is still real. We assert the app POSTs to the pay endpoint with the
 * chosen gateway and follows the returned redirect.
 */
test('paying a tuition invoice initiates the gateway redirect with the chosen gateway', async ({ page }) => {
  await page.route('**/api/v1/finance/invoices/', (route) => {
    route.fulfill({
      json: {
        results: [{
          id: 42,
          student_name: 'Test Alumno',
          student_code: 'A-001',
          period: '2026-08',
          period_label: 'Agosto 2026',
          amount: '2500.00',
          balance_due: '2500.00',
          currency: 'MXN',
          status: 'pending',
          due_date: '2026-08-05',
        }],
      },
    });
  });

  let payload: unknown = null;
  await page.route('**/api/v1/finance/invoices/*/pay/', (route) => {
    payload = route.request().postDataJSON();
    route.fulfill({ json: { redirect_url: '/pago-simulado' } });
  });
  await page.route('**/pago-simulado', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Pasarela simulada</h1>' }));

  // Log in as a parent (lands on /portal) and navigate client-side via the
  // sidebar — no full reload, so in-memory auth persists (robust on cold CI).
  await login(page, DEV_PARENT);
  // exact: true — the dashboard "Pagar colegiaturas" QuickAction card shares the
  // accessible name, so scope to the sidebar nav link.
  await page.getByRole('link', { name: 'Colegiaturas', exact: true }).click();
  await expect(page).toHaveURL(/\/portal\/colegiaturas/);

  await expect(page.getByText('Agosto 2026 · Test Alumno')).toBeVisible();
  await page.getByRole('button', { name: /^pagar$/i }).click();       // open pay modal
  await page.getByRole('button', { name: /pagar en línea/i }).click(); // default gateway

  await page.waitForURL('**/pago-simulado');
  expect(payload).toEqual({ gateway: 'global_payments' });
});
