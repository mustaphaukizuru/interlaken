import { test, expect, type Browser, type Page, type TestInfo } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEV_ADMIN } from './helpers';

/**
 * CMS visual guard (docs/cms/safe-publish.md): every public page, full height,
 * at 390 and 1280 px, in two states:
 *
 *  1. defaults: no CMS page published, every route renders its template;
 *  2. published from the design: every template is created exactly as
 *     «Personalizar» does and published through the admin API (which must
 *     answer 200 with zero pre-publish issues), then shot again.
 *
 * Checks, per route and width:
 *  - the published shot matches the default shot of the same run (always on,
 *    any platform, no baseline needed): publishing from the design never
 *    changes a pixel beyond anti-aliasing;
 *  - each shot matches the committed baseline `<slug>-<width>-chromium-<platform>.png`.
 *    Until those exist for the platform, that part is skipped (annotated) and
 *    the rest still runs. Baselines come only from the defaults state.
 *
 * Stable shots: fixed data (fresh CI database, video setting off), fixed clock,
 * reduced motion, animations killed, fonts and images awaited, a fresh page per
 * width. Linux baselines are produced by CI, never on Windows: see e2e/README.md.
 */

const ROOT = dirname(fileURLToPath(import.meta.url));
const MANIFEST = resolve(ROOT, '../../backend/apps/content/template_manifest.json');
const NOT_FOUND_PATH = '/esta-pagina-no-existe';
/** Every designed public page (generated manifest), the 404 page at an unknown URL. */
const ROUTES: { slug: string; path: string }[] = Object.entries(
  (JSON.parse(readFileSync(MANIFEST, 'utf-8')) as { templates: Record<string, { path: string }> }).templates,
).map(([slug, t]) => ({ slug, path: slug === 'no-encontrada' ? NOT_FOUND_PATH : t.path }));

const WIDTHS = [{ name: '390', width: 390, height: 844 }, { name: '1280', width: 1280, height: 800 }] as const;
const FIXED_NOW = new Date('2026-08-10T10:00:00');
/** Anti-aliasing tolerance: pixels whose colour moved by more than CHANNEL_DELTA, at most MAX_DIFF_PIXELS of them. */
const CHANNEL_DELTA = 48;
const MAX_DIFF_PIXELS = 2_000;
const KILL_MOTION = `*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
html { scroll-behavior: auto !important; }`;

test.describe.configure({ mode: 'serial' });
test.use({ serviceWorkers: 'block' });

/** Shots of the defaults state, read back by the published state (survives a worker restart). */
const shotDir = (info: TestInfo) => join(info.project.outputDir, 'public-pages-defaults');
const shotFile = (info: TestInfo, name: string) => join(shotDir(info), name);

async function shoot(browser: Browser, r: (typeof ROUTES)[number], vp: (typeof WIDTHS)[number], forceTemplate: boolean): Promise<Buffer> {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage();
  try {
    await page.clock.setFixedTime(FIXED_NOW);
    // The institutional video embeds an external thumbnail (nondeterministic): off, as in visual.spec.ts.
    await page.route('**/api/v1/content/settings/', async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, json: { ...(await res.json()), video_url: '' } });
    });
    if (forceTemplate) {
      // Defaults: no published page, whatever the database holds.
      await page.route(/\/api\/v1\/content\/pages\/[^/?]+\/(\?.*)?$/, (route) => route.fulfill({ status: 404, json: { detail: 'No encontrado.' } }));
    }
    // Which version the page rendered: the template (404) or the published one (200).
    const answers: number[] = [];
    page.on('response', (res) => { if (new URL(res.url()).pathname === `/api/v1/content/pages/${r.slug}/`) answers.push(res.status()); });
    await page.goto(r.path, { waitUntil: 'networkidle' });
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    expect(answers, `${r.slug}: CMS page request`).toContain(forceTemplate ? 404 : 200);
    await page.addStyleTag({ content: KILL_MOTION });
    await settle(page);
    return await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
  } finally {
    await context.close();
  }
}

/** Walk the page so lazy images and reveal observers fire, then wait for fonts and images. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.6));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 50));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 5000); }))));
  });
  await page.waitForTimeout(300);
}

/** Compare two PNGs in a blank page (the browser decodes them): differing pixels beyond anti-aliasing. */
async function pixelDiff(browser: Browser, a: Buffer, b: Buffer): Promise<{ size: string; diff: number }> {
  const page = await browser.newPage();
  try {
    return await page.evaluate(async ([pa, pb, delta]) => {
      const load = async (b64: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height);
      };
      const [x, y] = await Promise.all([load(pa as string), load(pb as string)]);
      if (x.width !== y.width || x.height !== y.height) return { size: `${x.width}x${x.height} vs ${y.width}x${y.height}`, diff: -1 };
      let diff = 0;
      for (let i = 0; i < x.data.length; i += 4) {
        if (Math.abs(x.data[i] - y.data[i]) > (delta as number) || Math.abs(x.data[i + 1] - y.data[i + 1]) > (delta as number)
          || Math.abs(x.data[i + 2] - y.data[i + 2]) > (delta as number)) diff += 1;
      }
      return { size: `${x.width}x${x.height}`, diff };
    }, [a.toString('base64'), b.toString('base64'), CHANNEL_DELTA] as const);
  } finally {
    await page.close();
  }
}

/** The committed baseline check, or a note when this platform has none yet. Only the defaults state writes baselines. */
function matchBaseline(shot: Buffer, name: string, info: TestInfo, { writesBaselines }: { writesBaselines: boolean }) {
  const baseline = info.snapshotPath(name);
  const mayWrite = ['all', 'changed', 'missing'].includes(info.config.updateSnapshots);
  if (!existsSync(baseline) && !(mayWrite && writesBaselines)) {
    info.annotations.push({ type: 'no-baseline', description: `${name}: sin línea base para ${process.platform}; ver e2e/README.md` });
    return;
  }
  if (mayWrite && !writesBaselines) return;   // baselines come from the defaults state only
  expect(shot).toMatchSnapshot(name, { maxDiffPixels: MAX_DIFF_PIXELS, threshold: 0.2 });
}

test.describe('Public pages: defaults', () => {
  for (const r of ROUTES) {
    test(`${r.slug} (${r.path})`, async ({ browser }, info) => {
      test.setTimeout(180_000);
      mkdirSync(shotDir(info), { recursive: true });
      for (const vp of WIDTHS) {
        const name = `${r.slug}-${vp.name}.png`;
        const shot = await shoot(browser, r, vp, true);
        writeFileSync(shotFile(info, name), shot);
        matchBaseline(shot, name, info, { writesBaselines: true });
      }
    });
  }
});

test.describe('Public pages: every template published from the design', () => {
  const created: number[] = [];
  let token = '';

  test.beforeAll(async ({ browser, request }) => {
    test.setTimeout(300_000);
    const login = await request.post('/api/v1/accounts/token/', { data: { email: DEV_ADMIN.email, password: DEV_ADMIN.password } });
    expect(login.ok(), 'admin login').toBeTruthy();
    token = (await login.json()).access;
    const auth = { Authorization: `Bearer ${token}` };
    const existing = await request.get('/api/v1/content/admin/pages/?page_size=100', { headers: auth });
    const rows = ((await existing.json()).results ?? []) as { slug: string }[];
    const taken = rows.filter((p) => ROUTES.some((r) => r.slug === p.slug)).map((p) => p.slug);
    test.skip(taken.length > 0, `La base ya tiene páginas del CMS (${taken.join(', ')}): use una base limpia, como en CI.`);

    // The drafts «Personalizar» creates, built by the app itself (Vite serves the source in dev).
    const page = await browser.newPage();
    await page.goto('/');
    const drafts = (await page.evaluate(`(async () => {
      const { loadAllGroups } = await import('/src/cms/sections/loaders.ts');
      const { allTemplates } = await import('/src/cms/sections/index.ts');
      const { originalBlocks, pageKindFor } = await import('/src/cms/editor/helpers.ts');
      await loadAllGroups();
      return allTemplates().map((t) => ({ title: t.title, slug: t.slug, template: pageKindFor(t.slug), draft_blocks: originalBlocks(t.slug), seo: {} }));
    })()`)) as { slug: string }[];
    await page.close();
    expect(drafts.map((d) => d.slug).sort()).toEqual(ROUTES.map((r) => r.slug).sort());

    for (const draft of drafts) {
      const res = await request.post('/api/v1/content/admin/pages/', { headers: auth, data: draft });
      expect(res.status(), `${draft.slug}: create`).toBe(201);
      const { id, legacy_seed: legacy } = await res.json();
      created.push(id);
      expect(legacy, `${draft.slug}: a designed draft is never «Borrador antiguo»`).toBe(false);
      const checks = await (await request.get(`/api/v1/content/admin/pages/${id}/checks/`, { headers: auth })).json();
      expect(checks.issues, `${draft.slug}: a page straight from the design has no pre-publish issues`).toEqual([]);
      const pub = await request.post(`/api/v1/content/admin/pages/${id}/publish/`, { headers: auth, data: { action: 'publish' } });
      expect(pub.status(), `${draft.slug}: publish`).toBe(200);
    }
  });

  test.afterAll(async ({ request }) => {
    for (const id of created) {
      await request.delete(`/api/v1/content/admin/pages/${id}/`, { headers: { Authorization: `Bearer ${token}` } });
    }
  });

  for (const r of ROUTES) {
    test(`${r.slug} (${r.path})`, async ({ browser }, info) => {
      test.setTimeout(180_000);
      for (const vp of WIDTHS) {
        const name = `${r.slug}-${vp.name}.png`;
        const shot = await shoot(browser, r, vp, false);
        const file = shotFile(info, name);
        if (existsSync(file)) {
          const defaults = readFileSync(file);
          const { size, diff } = await pixelDiff(browser, defaults, shot);
          console.log(`${name}: ${diff} px differ from the defaults (${size})`);
          if (diff !== 0) {
            // Kept next to the defaults shot (test-results is uploaded when CI fails) and in the report.
            writeFileSync(shotFile(info, name.replace('.png', '.published.png')), shot);
            await info.attach(`${name} defaults`, { body: defaults, contentType: 'image/png' });
            await info.attach(`${name} published`, { body: shot, contentType: 'image/png' });
          }
          expect(diff, `${r.path} at ${vp.name} px: published from the design differs from the defaults (${size})`).toBeGreaterThanOrEqual(0);
          expect(diff, `${r.path} at ${vp.name} px: published from the design differs from the defaults (${size})`).toBeLessThanOrEqual(MAX_DIFF_PIXELS);
        } else {
          info.annotations.push({ type: 'no-defaults-shot', description: `${name}: the defaults test did not run` });
        }
        matchBaseline(shot, name, info, { writesBaselines: false });
      }
    });
  }
});
