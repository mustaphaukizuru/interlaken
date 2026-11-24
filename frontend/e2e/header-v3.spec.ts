import { expect, test, type Page } from '@playwright/test';

/**
 * Header version 3 (school, 2026-11-23) layout guards:
 * - from 1024 px the header row never overflows, with the two buttons of the
 *   design and with a third one (the most Navegación allows);
 * - on phones the home hero fits the first screen and its buttons stay clear
 *   of the bottom bar («Pagos» + WhatsApp), down to 360 x 640.
 * Site notices are switched off so the measurements do not depend on them.
 */
const TWO = [
  { label: 'Portal Cafetería', href: '/login', icon: 'Coffee' },
  { label: 'Colegiaturas', href: 'https://interlaken.servoescolar.mx/', icon: 'CreditCard' },
];
const THREE = [...TWO, { label: 'Agendar visita', href: '/agendar-visita', primary: true }];

async function withHeader(page: Page, buttons: object[]) {
  await page.route('**/api/v1/portal/avisos/', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/content/settings/', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.chrome = { ...(body.chrome ?? {}), header_buttons: buttons, sticky_label: 'Pagos', sticky_href: '/pagos' };
    await route.fulfill({ response: res, json: body });
  });
}

for (const [name, buttons] of [['two', TWO], ['three', THREE]] as const) {
  for (const width of [1024, 1149, 1280]) {
    test(`header row fits at ${width} px with ${name} buttons`, async ({ page }) => {
      await withHeader(page, buttons);
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      const header = page.locator('header[data-sticky-header]');
      await expect(header.getByRole('link', { name: 'Portal Cafetería' })).toBeVisible();
      const m = await header.evaluate((el) => {
        const row = el.firstElementChild as HTMLElement;
        const nav = el.querySelector('nav')!;
        const wide = nav.nextElementSibling as HTMLElement;
        const r = (e: Element) => e.getBoundingClientRect();
        return {
          overflow: row.scrollWidth - row.clientWidth,
          logoGap: r(nav).left - r(row.firstElementChild!).right,
          buttonsGap: r(wide).left - r(nav).right,
        };
      });
      expect(m.overflow).toBe(0);
      expect(m.logoGap).toBeGreaterThanOrEqual(0);
      expect(m.buttonsGap).toBeGreaterThanOrEqual(0);
      // Two buttons (the design) keep spare room at 1024 px.
      if (name === 'two') expect(m.logoGap + m.buttonsGap).toBeGreaterThanOrEqual(24);
    });
  }
}

for (const [width, height] of [[360, 640], [375, 667], [390, 844]]) {
  test(`phone hero fits ${width} x ${height} and clears the bottom bar`, async ({ page }) => {
    await withHeader(page, TWO);
    await page.setViewportSize({ width, height });
    await page.goto('/');
    const bar = page.locator('[data-sticky-cta]');
    await expect(bar.getByRole('link', { name: 'Pagos' })).toBeVisible();
    const hero = page.locator('main section').first();
    await expect(hero.getByRole('link', { name: 'Ver costos' })).toBeVisible();
    // Measure the settled layout: the page and the hero buttons rise into place on load.
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
    await expect.poll(() => hero.evaluate((el) => getComputedStyle(el.querySelector('a')!.parentElement!).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
    const m = await page.evaluate(() => {
      const section = document.querySelector('main section')!;
      const links = [...section.querySelectorAll('a')].map((a) => a.getBoundingClientRect().bottom);
      return {
        heroBottom: section.getBoundingClientRect().bottom,
        buttonsBottom: Math.max(...links),
        barTop: document.querySelector('[data-sticky-cta]')!.getBoundingClientRect().top,
        vh: innerHeight,
      };
    });
    expect(Math.abs(m.heroBottom - m.vh)).toBeLessThanOrEqual(1);
    expect(m.buttonsBottom).toBeLessThanOrEqual(m.barTop - 8);
  });
}

test('the bottom bar hides while the phone menu is open', async ({ page }) => {
  await withHeader(page, TWO);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const bar = page.locator('[data-sticky-cta]');
  await expect(bar).toBeVisible();
  await page.getByRole('button', { name: 'Abrir menú' }).click();
  await expect(page.getByRole('group', { name: 'Pagos de familias' })).toBeVisible();
  await expect(bar).toHaveCount(0);
});
