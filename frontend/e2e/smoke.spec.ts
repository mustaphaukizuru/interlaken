import { test, expect, type Page } from '@playwright/test';
import { login, portalNav, DEV_ADMIN, DEV_PARENT } from './helpers';

/**
 * Route smoke test: every route renders a non-empty <main> and authenticated
 * routes don't bounce to /login. Guards against orphaned/blank pages and
 * broken lazy chunks. Data is real (mostly empty) — pages render their empty
 * states, which still counts as "connected".
 */
async function expectRenders(page: Page, path: string) {
  await page.goto(path);
  await expectMainSettled(page);
}

/** Assert the current route has a non-empty <main> once its data settles. */
async function expectMainSettled(page: Page) {
  const main = page.getByRole('main');
  await expect(main, `no <main> at ${page.url()}`).toBeVisible();
  // Poll so we don't measure during the loading skeleton/spinner.
  await expect
    .poll(async () => (await main.textContent())?.trim().length ?? 0,
      { timeout: 15_000, message: `blank content at ${page.url()}` })
    .toBeGreaterThan(30);
}

const PUBLIC_ROUTES = [
  '/', '/nosotros', '/admisiones', '/admisiones/documentacion', '/admisiones/costos',
  '/pre-registro', '/inscripcion', '/puertas-abiertas', '/agendar-visita', '/contacto',
  '/aviso-de-privacidad', '/modelo-educativo', '/galeria',
  '/niveles/preescolar', '/niveles/primaria', '/niveles/secundaria',
  '/comunidad/plataformas', '/comunidad/facturacion', '/login',
];

test.describe('Public routes render', () => {
  for (const path of PUBLIC_ROUTES) {
    test(`renders ${path}`, async ({ page }) => {
      await expectRenders(page, path);
    });
  }

  test('unknown route shows the 404 page', async ({ page }) => {
    await page.goto('/definitely-not-a-real-route-xyz');
    await expect(page.getByRole('main')).toContainText(/404|no.*(encontr|existe)/i);
  });
});

// Authenticated routes are visited via CLIENT-SIDE sidebar nav (no full reload),
// which avoids racing the refresh-token rotation that repeated goto() reloads
// would trigger. Cross-portal homes (/staff, /alumno) use a single goto.

async function clickNavAndSettle(page: Page, name: string, urlRe: RegExp) {
  await portalNav(page).getByRole('link', { name, exact: true }).click();
  await expect(page).toHaveURL(urlRe);
  await expectMainSettled(page);
}

test('admin portal routes render', async ({ page }) => {
  await login(page, DEV_ADMIN);
  await expect(page).toHaveURL(/\/admin\/?$/);
  await expectMainSettled(page);
  await clickNavAndSettle(page, 'Alumnos', /\/admin\/alumnos/);
  await clickNavAndSettle(page, 'Admisiones', /\/admin\/admisiones/);
  await clickNavAndSettle(page, 'Visitas', /\/admin\/visitas/);
  await clickNavAndSettle(page, 'Finanzas', /\/admin\/finanzas/);
  await clickNavAndSettle(page, 'Cafetería', /\/admin\/cafeteria/);
});

test('parent portal routes render', async ({ page }) => {
  await login(page, DEV_PARENT);
  await expect(page).toHaveURL(/\/portal\/?$/);
  await expectMainSettled(page);
  await clickNavAndSettle(page, 'Cafetería', /\/portal\/cafeteria/);
  await clickNavAndSettle(page, 'Pagos', /\/portal\/pagos/);
});

test('staff analytics home renders', async ({ page }) => {
  await login(page, DEV_ADMIN);
  await page.goto('/staff');
  await expect(page).not.toHaveURL(/\/login/);
  await expectMainSettled(page);
});

test('student portal renders', async ({ page }) => {
  await login(page, DEV_ADMIN);
  // The student portal was merged into the family portal — /alumno* redirects
  // to /portal, so the nav lands on the /portal cafetería route.
  await page.goto('/alumno');
  await expect(page).not.toHaveURL(/\/login/);
  await expectMainSettled(page);
  await clickNavAndSettle(page, 'Cafetería', /\/portal\/cafeteria/);
});
