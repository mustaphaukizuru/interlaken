import { type Page } from '@playwright/test';

/**
 * The portal sidebar nav (admin/parent/student share the landmark). Scope nav
 * clicks here — dashboards render same-named quick links in the main content.
 */
export const portalNav = (page: Page) =>
  page.getByRole('navigation', { name: 'Menú del portal' });

/** Dev users seeded for E2E (see `manage.py seed_e2e_user`). */
export const DEV_ADMIN = { email: 'devadmin@interlaken.test', password: 'DevAdmin123!' };
export const DEV_PARENT = { email: 'devparent@interlaken.test', password: 'DevParent123!' };

/** Log in through the real UI + backend (email/password). */
export async function login(page: Page, creds = DEV_ADMIN) {
  // The admin dashboard asks once a day «Faltan los precios del ciclo…» in a
  // modal while Costos lacks next cycle's prices (the E2E database has none).
  // Flows here start from the dashboard, so it counts as seen today; the
  // reminder itself is covered by PriceYearsPanel.test.tsx.
  await page.addInitScript(() => {
    try {
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      localStorage.setItem('interlaken.priceReminder', today);
    } catch { /* storage blocked: the test sees the reminder */ }
  });
  await page.goto('/login');
  await page.getByPlaceholder('correo@interlaken.com.mx').fill(creds.email);
  await page.getByPlaceholder('••••••••').fill(creds.password);
  await page.getByRole('button', { name: /ingresar/i }).click();
  // Wait until auth is established (redirected away from /login, refresh cookie
  // set) before the test navigates on — otherwise a follow-up goto races ahead
  // unauthenticated and bounces back to /login.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
}
