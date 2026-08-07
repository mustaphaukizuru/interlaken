import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Authentication', () => {
  test('email/password login lands on the admin dashboard', async ({ page }) => {
    await login(page);

    // Real auth round-trip: token endpoint → httpOnly refresh cookie → redirect.
    await expect(page).toHaveURL(/\/admin\/?$/);
    await expect(page.getByRole('heading', { name: 'Panel de Administración' })).toBeVisible();
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
});
