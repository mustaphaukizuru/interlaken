import { test, expect } from '@playwright/test';
import { login, portalNav, DEV_PARENT } from './helpers';

/**
 * Admin-critical flows. All announcement APIs are stubbed with page.route
 * (the point is the UI flow — composer, listing — not the data plumbing);
 * auth is real for both roles.
 */

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
