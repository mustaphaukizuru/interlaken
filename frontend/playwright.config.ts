import { defineConfig, devices } from '@playwright/test';

/**
 * E2E for the money-critical flows. Runs against the Vite dev server (proxying
 * to the SQLite dev backend). Auth is exercised for real; the gateway hand-off
 * is stubbed with page.route so the flow is deterministic without Global
 * Payments / Banorte credentials or seeded parent data.
 *
 * Locally: start both dev servers (SQLITE_LOCAL backend on 8800, frontend on
 * 3010) and `npm run test:e2e` — reuseExistingServer picks them up. In CI the
 * webServer entries boot them.
 */
export default defineConfig({
  testDir: './e2e',
  // Generous: a cold Vite dev server compiles each route chunk on first hit.
  timeout: 60_000,
  expect: {
    timeout: 20_000,
    // Visual baselines: absorb sub-pixel AA jitter without hiding real
    // regressions (≈0.2% of a 1280×800 shot ≈ 2k px).
    toHaveScreenshot: { maxDiffPixelRatio: 0.002 },
  },
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3010',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'python manage.py runserver 8800',
      cwd: '../backend',
      env: {
        SQLITE_LOCAL: '1',
        DJANGO_SETTINGS_MODULE: 'config.settings.development',
        // The suite logs in ~19×/run; without this the 10/min per-IP login
        // rate limit 429s mid-suite (honored by development.py only).
        RATELIMIT_DISABLE: '1',
      },
      url: 'http://localhost:8800/api/v1/content/settings/',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'npm run dev -- --port 3010',
      env: { DEV_API_TARGET: 'http://localhost:8800' },
      url: 'http://localhost:3010',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
