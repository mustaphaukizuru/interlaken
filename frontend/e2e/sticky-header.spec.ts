import { expect, test } from '@playwright/test';

/**
 * The public header stays pinned while the page scrolls (it is `sticky top-0`).
 * Regression: an `overflow-x-hidden` wrapper turned the layout into its own
 * scroll box and the header scrolled away with the page.
 */
for (const width of [390, 1280]) {
  test(`the header stays at the top while scrolling (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/admisiones');
    const header = page.locator('header').first();
    await expect(header).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 1600));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    await expect.poll(async () => Math.round((await header.boundingBox())?.y ?? -1)).toBe(0);
    await expect(header.getByRole('link', { name: /Inicio/ })).toBeInViewport();
  });
}
