import { test, expect, type Page } from '@playwright/test';
import { login, portalNav } from './helpers';

/**
 * The console frame (PortalLayout) is exactly the viewport and only the content
 * column scrolls. Owner's report (/admin/pagos, 1919×937): after scrolling, the
 * whole console (sidebar + content) slid up and left an empty band at the
 * bottom. Cause: an absolutely positioned element inside the content (the
 * table's sr-only <caption>) had the page as its containing block, so neither
 * overflow-hidden box clipped it and it made the DOCUMENT taller than the
 * screen; the wheel, End or a focus() near the bottom then scrolled the page.
 * Ledger data is stubbed so a 20-row table sits below the fold on any screen.
 */

const rows = Array.from({ length: 20 }, (_, i) => ({
  id: i + 1,
  payment_type: 'cafeteria',
  amount: '200.00',
  currency: 'MXN',
  description: 'Recarga de cafetería',
  status: 'success',
  gateway: 'banorte',
  gateway_label: 'Banorte',
  gateway_tx_id: `CTRL-${1000 + i}`,
  student_id: null,
  student_name: '',
  created_at: '2026-11-10T18:00:00Z',
  updated_at: '2026-11-10T18:00:00Z',
  payer_name: 'Familia Ejemplo',
  payer_email: 'familia@ejemplo.test',
}));

async function stubLedger(page: Page) {
  await page.route('**/api/v1/payments/admin/summary/**', (route) =>
    route.fulfill({
      json: {
        days: 30, since: '2026-10-19', series: [], failed_by_reason: {}, stuck_pending: 0,
        by_status: { success: { count: 60, total: '12000.00' } },
      },
    }),
  );
  await page.route(/\/api\/v1\/payments\/admin\/(\?.*)?$/, (route) =>
    route.fulfill({ json: { count: 60, next: 'http://x/?page=2', previous: null, results: rows } }),
  );
}

/** Where the frame, the document and the content column stand right now. */
async function frameState(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector('main#contenido') as HTMLElement;
    const frame = main.parentElement!.parentElement as HTMLElement;
    const aside = document.querySelector('aside[aria-label="Navegación del portal"]') as HTMLElement;
    return {
      windowScrollY: Math.round(window.scrollY),
      documentOverflow: document.scrollingElement!.scrollHeight - window.innerHeight,
      frameScrollTop: frame.scrollTop,
      mainScrollTop: main.scrollTop,
      frameTop: Math.round(frame.getBoundingClientRect().top),
      frameBottomGap: Math.round(window.innerHeight - frame.getBoundingClientRect().bottom),
      asideTop: Math.round(aside.getBoundingClientRect().top),
    };
  });
}

const STILL = { windowScrollY: 0, documentOverflow: 0, frameScrollTop: 0, mainScrollTop: 0, frameTop: 0, frameBottomGap: 0 };

for (const vp of [{ width: 1919, height: 937 }, { width: 390, height: 844 }]) {
  test(`the console never slides up, ${vp.width}×${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await stubLedger(page);
    await login(page); // admin, lands on /admin
    if (vp.width >= 1024) {
      await portalNav(page).getByRole('link', { name: 'Pagos', exact: true }).click();
    } else {
      // Phones: client-side navigation (a full reload would drop the in-memory session).
      await page.evaluate(() => {
        window.history.pushState({}, '', '/admin/pagos');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
    }
    await expect(page).toHaveURL(/\/admin\/pagos/);
    await expect(page.getByRole('table', { name: 'Pagos en línea' })).toBeVisible();
    await expect(page.getByText('familia@ejemplo.test').first()).toBeVisible();

    // The page is never taller than the screen.
    expect(await frameState(page)).toMatchObject(STILL);

    // Wheel over the content (past its end) and, on desktop, over the sidebar.
    const content = (await page.locator('main#contenido').boundingBox())!;
    await page.mouse.move(content.x + content.width / 2, content.y + content.height / 2);
    for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 700);
    if (vp.width >= 1024) {
      const aside = (await page.getByRole('complementary', { name: 'Navegación del portal' }).boundingBox())!;
      await page.mouse.move(aside.x + aside.width / 2, aside.y + aside.height - 60);
      for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 700);
    }
    await page.keyboard.press('End');
    await page.waitForTimeout(300);
    expect(await frameState(page)).toMatchObject(STILL);

    // Programmatic scrolling: focus() and scrollIntoView() on what sits at the
    // bottom of the content, and the skip link.
    await page.evaluate(() => {
      const main = document.querySelector('main#contenido') as HTMLElement;
      const focusables = main.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input');
      focusables[focusables.length - 1]?.focus();
      main.querySelector('caption')?.scrollIntoView({ block: 'end' });
      main.querySelector('tbody tr:last-child')?.scrollIntoView({ block: 'end' });
    });
    await page.getByRole('button', { name: 'Página siguiente' }).focus();
    await page.waitForTimeout(200);
    expect(await frameState(page)).toMatchObject(STILL);

    // Any future absolutely positioned element at the bottom of a page (an
    // sr-only label, a tooltip) stays inside the scrolling column.
    await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.className = 'sr-only';
      probe.textContent = 'sonda';
      const column = document.querySelector('main#contenido .overflow-y-auto') as HTMLElement;
      column.appendChild(probe);
      probe.scrollIntoView({ block: 'end' });
    });
    await page.waitForTimeout(200);
    const end = await frameState(page);
    expect(end).toMatchObject(STILL);
    if (vp.width >= 1024) expect(end.asideTop).toBe(0);
  });
}
