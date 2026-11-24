import { expect, test } from '@playwright/test';

/**
 * Galería photo grid (QA 2026-11-24):
 * - below 1024 px the «Ampliar» hint and the caption are both always shown;
 *   they must never overlap (the hint used to sit on top of every caption);
 * - tiles download their -480/-960 files, not the full-size photo (the three
 *   ~680 px originals are their own 960w file).
 * Site notices are switched off so the layout does not depend on them.
 */
const SMALL_ORIGINALS = /\/assets\/(secundaria|primaria-gate|hopscotch)\.webp$/;

for (const width of [360, 390, 820, 1023]) {
  test(`gallery hint and captions never overlap at ${width} px`, async ({ page }) => {
    await page.route('**/api/v1/portal/avisos/', (route) => route.fulfill({ json: [] }));
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/galeria');
    const tiles = page.locator('main button[aria-label^="Ampliar imagen"]');
    await expect(tiles).toHaveCount(14);
    const rows = await tiles.evaluateAll((buttons) => buttons.map((btn) => {
      const tag = btn.querySelector('[data-zoom-tag]')!;
      const caption = [...btn.querySelectorAll('span')].find((s) => !s.closest('[aria-hidden]') && s.textContent?.trim());
      const range = document.createRange();
      if (caption) range.selectNodeContents(caption);
      const t = tag.getBoundingClientRect();
      const c = caption ? range.getBoundingClientRect() : null;
      const b = btn.getBoundingClientRect();
      return {
        caption: caption?.textContent?.trim() ?? '',
        hintShown: getComputedStyle(tag).opacity !== '0',
        overlap: !!c && t.left < c.right && t.right > c.left && t.top < c.bottom && t.bottom > c.top,
        inside: t.left >= b.left && t.right <= b.right && t.top >= b.top && t.bottom <= b.bottom,
      };
    }));
    expect(rows.filter((r) => !r.hintShown).map((r) => r.caption)).toEqual([]);
    expect(rows.filter((r) => r.overlap).map((r) => r.caption)).toEqual([]);
    expect(rows.filter((r) => !r.inside).map((r) => r.caption)).toEqual([]);
  });
}

test('gallery tiles load their smaller files on a phone', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.route('**/api/v1/portal/avisos/', (route) => route.fulfill({ json: [] }));
  await page.goto('/galeria');
  const tiles = page.locator('main button[aria-label^="Ampliar imagen"] img');
  await expect(tiles).toHaveCount(14);
  // Lazy tiles: scroll through the grid, then wait until every photo is decoded.
  for (let y = 0; y < 6000; y += 600) await page.evaluate((top) => window.scrollTo(0, top), y);
  await expect.poll(() => tiles.evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0)), { timeout: 20_000 }).toBe(true);
  const used = await tiles.evaluateAll((imgs) => imgs.map((i) => decodeURIComponent((i as HTMLImageElement).currentSrc)));
  const fullSize = used.filter((u) => !/-(480|960)\.webp$/.test(u) && !SMALL_ORIGINALS.test(new URL(u).pathname));
  expect(fullSize).toEqual([]);
  await context.close();
});
