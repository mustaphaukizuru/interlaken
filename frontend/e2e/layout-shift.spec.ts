import { test, expect } from '@playwright/test';

/**
 * Layout stability of /admisiones/costos (Lighthouse CI budget: CLS < 0.1).
 *
 * Every CMS-overridable public page first asks whether the school published a
 * CMS version of it (GET /content/pages/<slug>/) and renders nothing until the
 * answer arrives. The footer used to paint right under the header during that
 * wait and then jump below the fold when the content came: CLS 0.32-0.41 on the
 * runs where the browser painted in between. The wait is held open here, so the
 * check no longer depends on timing.
 */
test('costos: the footer stays below the fold while the page loads, and nothing jumps', async ({ page }) => {
  await page.setViewportSize({ width: 1350, height: 940 }); // Lighthouse desktop preset
  let release = () => {};
  const answered = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/api\/v1\/content\/pages\/costos\/?(\?.*)?$/, async (route) => {
    await answered;
    await route.fulfill({ status: 404, json: { detail: 'No encontrado.' } });
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __shift: number };
    w.__shift = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (!e.hadRecentInput) w.__shift += e.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });

  await page.goto('/admisiones/costos');
  const footer = page.locator('footer').first();
  await expect(footer).toBeAttached();
  await page.waitForTimeout(300); // a few frames painted while the CMS answer is pending
  const top = await footer.evaluate((f) => f.getBoundingClientRect().top);
  expect(top, 'footer painted inside the first screen while the page was empty').toBeGreaterThanOrEqual(940);

  release();
  await expect(page.getByRole('heading', { level: 1, name: 'Costos' })).toBeVisible();
  await expect(page.getByText('Información de referencia', { exact: false })).toBeVisible();
  await page.waitForTimeout(1500); // the costs request settles (data, error or empty)
  const shift = await page.evaluate(() => (window as unknown as { __shift: number }).__shift);
  expect(shift).toBeLessThan(0.1);
});
