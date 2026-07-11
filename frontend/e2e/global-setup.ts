import { chromium } from '@playwright/test';

/**
 * Warm the dev servers before the suite: a cold Vite dev server compiles each
 * route chunk on first hit and Django loads on its first request, which would
 * otherwise blow the first test's timeout. Loading /login in a real browser
 * pre-compiles the auth chunk and warms the API path so the actual tests run
 * against warm servers.
 */
export default async function globalSetup() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto('http://localhost:3010/login', {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });
  } catch {
    // Best-effort warm-up; the tests' own timeouts still cover cold starts.
  } finally {
    await browser.close();
  }
}
