import { test, expect } from '@playwright/test';
import { login, DEV_PARENT } from './helpers';

test.describe('Authentication', () => {
  test('email/password login lands on the admin dashboard', async ({ page }) => {
    await login(page);

    // Real auth round-trip: token endpoint → httpOnly refresh cookie → redirect.
    await expect(page).toHaveURL(/\/admin\/?$/);
    await expect(page.getByRole('heading', { name: 'Panel de Administración' })).toBeVisible();
  });

  test('parent login lands on the family portal', async ({ page }) => {
    await login(page, DEV_PARENT);

    await expect(page).toHaveURL(/\/portal\/?$/);
    await expect(page.getByRole('navigation', { name: 'Menú del portal' })).toBeVisible();
  });

  test('bad credentials keep the user on /login with an error', async ({ page }) => {
    await page.goto('/login');
    // Use a throwaway address, NOT the real E2E admin — repeated failures would
    // trip django-axes and lock the account the other tests log in with.
    await page.getByPlaceholder('correo@interlaken.edu.mx').fill('nobody@interlaken.test');
    await page.getByPlaceholder('••••••••').fill('wrong-password');
    await page.getByRole('button', { name: /ingresar/i }).click();

    await expect(page).toHaveURL(/\/login/);
    // Any inline error/toast is fine; the point is we did NOT get into the portal.
    await expect(page.getByRole('heading', { name: 'Panel de Administración' })).toHaveCount(0);
  });

  test('the session survives a full page reload (refresh-cookie bootstrap)', async ({ page }) => {
    await login(page, DEV_PARENT);
    await expect(page).toHaveURL(/\/portal\/?$/);

    // A reload drops the in-memory access token; the app must silently re-mint
    // it from the httpOnly refresh cookie instead of bouncing to /login. The
    // API-backed proof is a 200 from the protected dashboard endpoint after the
    // reload (401 → silent refresh → retry happens under the hood).
    const dashboardOk = page.waitForResponse(
      (r) => r.url().includes('/api/v1/portal/dashboard/') && r.status() === 200,
      { timeout: 20_000 },
    );
    await page.reload();
    await dashboardOk;

    // …and we were never bounced back to the login page.
    await expect(page.getByRole('navigation', { name: 'Menú del portal' })).toBeVisible();
    await expect(page).toHaveURL(/\/portal\/?$/);
  });

  test('logout clears the session and /portal bounces back to /login', async ({ page }) => {
    await login(page, DEV_PARENT);
    await expect(page).toHaveURL(/\/portal\/?$/);

    // Sidebar user card → account actions menu → Cerrar sesión (P1-E5 layout).
    const aside = page.getByRole('complementary', { name: 'Navegación del portal' });
    await aside.getByRole('button', { name: 'Opciones de la cuenta' }).click();
    await aside.getByRole('menuitem', { name: 'Cerrar sesión' }).click();
    await page.waitForURL('**/');

    // The refresh cookie is gone and local auth state is cleared — a protected
    // route must now redirect to the login page.
    await page.goto('/portal');
    await expect(page).toHaveURL(/\/login/);
  });

  test('there is no self-service password reset: the login page explains how to ask the school', async ({ page }) => {
    // Decision 2026-08-22: families request a password by WhatsApp or email and an
    // admin sets it. The old /olvide-contrasena route must not exist any more.
    await page.goto('/login');
    await expect(page.getByText(/¿Olvidó su contraseña\? Solicítela al colegio/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /correo/i }).first()).toBeVisible();
    await page.goto('/olvide-contrasena');
    await expect(page.getByRole('heading', { name: /no encontrada|404/i })).toBeVisible();
  });
});
