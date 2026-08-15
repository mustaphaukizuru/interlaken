import { test, expect } from '@playwright/test';
import { login, portalNav, DEV_PARENT } from './helpers';

/**
 * Admin-critical flows. All finance/announcement APIs are stubbed with
 * page.route (the point is the UI flow — selection, ConfirmDialog, composer —
 * not the data plumbing); auth is real for both roles.
 */

const INVOICE = {
  id: 42,
  student_name: 'Test Alumno',
  student_code: 'A-003',
  grade: '3° Primaria',
  period: '2026-08',
  period_label: 'Agosto 2026',
  amount: '2500.00',
  amount_paid: '0.00',
  balance_due: '2500.00',
  currency: 'MXN',
  status: 'pending',
  status_display: 'Pendiente',
  due_date: '2026-08-05',
};

test('finanzas: mark-paid goes through the ConfirmDialog and posts the bulk action', async ({ page }) => {
  await page.route('**/api/v1/finance/admin/dashboard/**', (route) =>
    route.fulfill({
      json: {
        billed: '2500.00', collected: '0.00', outstanding: '2500.00',
        collection_rate: 0, overpaid: 0, overpaid_credit: '0.00',
      },
    }));
  await page.route('**/api/v1/finance/admin/invoices/**', (route) =>
    route.fulfill({ json: { count: 1, results: [INVOICE] } }));

  let bulkPayload: unknown = null;
  await page.route('**/api/v1/finance/admin/bulk/', (route) => {
    bulkPayload = route.request().postDataJSON();
    route.fulfill({ json: { done: 1, failed: 0 } });
  });

  await login(page); // admin → /admin
  await portalNav(page).getByRole('link', { name: 'Finanzas', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/finanzas/);

  // Select the stubbed invoice (scope to the desktop table — the mobile card
  // list renders a hidden checkbox with the same accessible name).
  await expect(page.getByRole('table').getByText('Test Alumno')).toBeVisible();
  await page.getByRole('table')
    .getByLabel('Seleccionar la colegiatura de Test Alumno')
    .check();
  await expect(page.getByText('1 seleccionada(s)')).toBeVisible();

  // Bulk bar → ConfirmDialog (states the consequence) → confirm.
  await page.getByRole('button', { name: 'Marcar pagadas' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Se marcarán como pagadas 1 colegiatura/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Marcar pagadas' }).click();

  await expect(page.getByText('1 colegiatura(s) actualizada(s).')).toBeVisible();
  expect(bulkPayload).toEqual({ invoice_ids: [42], action: 'mark_paid' });
});

test('publishing a comunicado posts it and lists it in the admin console', async ({ page }) => {
  // Stateful stub: the list starts empty; a successful POST appears in the next GET.
  const items: Record<string, unknown>[] = [];
  let createPayload: Record<string, unknown> | null = null;

  await page.route('**/api/v1/portal/admin/announcements/**', (route) => {
    const url = route.request().url();
    if (url.includes('recipient-count')) {
      return route.fulfill({ json: { audience: 'all', count: 12 } });
    }
    if (route.request().method() === 'POST') {
      createPayload = route.request().postDataJSON();
      const item = {
        id: 101,
        ...createPayload,
        created_at: '2026-08-10T12:00:00Z',
        created_by_name: 'Dev Admin',
        read_count: 0,
      };
      items.unshift(item);
      return route.fulfill({ status: 201, json: item });
    }
    return route.fulfill({ json: { count: items.length, results: items } });
  });

  await login(page); // admin
  await portalNav(page).getByRole('link', { name: 'Comunicados', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/comunicados/);
  await expect(page.getByText('Sin comunicados')).toBeVisible();

  // Compose + publish (two same-named buttons: header action + empty state).
  await page.getByRole('button', { name: 'Nuevo comunicado' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Título').fill('Suspensión de clases');
  await dialog.getByLabel('Mensaje').fill('Mañana no habrá clases por mantenimiento del plantel.');
  await dialog.getByRole('button', { name: 'Publicar' }).click();

  await expect(page.getByText('Comunicado publicado.')).toBeVisible();
  await expect(page.getByText('Suspensión de clases')).toBeVisible();
  expect(createPayload).toEqual({
    title: 'Suspensión de clases',
    body: 'Mañana no habrá clases por mantenimiento del plantel.',
    audience: 'all',
    is_active: true,
    push_enabled: true,
  });
});

test('a published comunicado is listed in the parent portal', async ({ page }) => {
  // Parent side of the same story: the announcements feed is stubbed with the
  // comunicado the admin just published (UI flow, not data plumbing).
  await page.route('**/api/v1/portal/announcements/**', (route) => {
    if (route.request().url().includes('mark-read')) {
      return route.fulfill({ json: { updated: 0 } });
    }
    return route.fulfill({
      json: {
        count: 1,
        results: [{
          id: 101,
          title: 'Suspensión de clases',
          body: 'Mañana no habrá clases por mantenimiento del plantel.',
          audience: 'all',
          created_at: '2026-08-10T12:00:00Z',
          comment_count: 0,
        }],
      },
    });
  });

  await login(page, DEV_PARENT);
  await portalNav(page).getByRole('link', { name: 'Comunicados', exact: true }).click();
  await expect(page).toHaveURL(/\/portal\/comunicados/);

  await expect(page.getByText('Suspensión de clases')).toBeVisible();
  await expect(page.getByText('Mañana no habrá clases por mantenimiento del plantel.')).toBeVisible();
});
