# E2E (Playwright)

End-to-end coverage of the money-critical and auth-critical flows, plus visual
regression baselines. Auth is always real (seeded dev users); payment gateways
and admin/portal data are stubbed with `page.route` so runs are deterministic.

## Specs

| Spec | Covers |
| --- | --- |
| `smoke.spec.ts` | Every public + portal route renders a non-empty `<main>` |
| `auth.spec.ts` | Admin/parent login, bad credentials, reload survival (refresh-cookie bootstrap), logout, forgot-password |
| `cafeteria.spec.ts` | Top-up from CafeteriaPage and from the dashboard quick chip (`?recarga=200`), gateway choice in the POST payload, stubbed hosted-page redirect, return page success/failed/processing states |
| `admin.spec.ts` | Comunicado publish from the admin console, parent portal listing it |
| `visual.spec.ts` | `toHaveScreenshot` baselines at 390×844 and 1280×800 for home, costos, admisiones, login, parent dashboard (stubbed) |

## Running locally

```sh
# one-time: browsers + seeded users
npx playwright install chromium
cd ../backend && python manage.py migrate && python manage.py seed_e2e_user  # with SQLITE_LOCAL=1

cd frontend && npm run test:e2e
```

`playwright.config.ts` boots both dev servers itself (Django on 8800 with
`SQLITE_LOCAL=1 RATELIMIT_DISABLE=1`, Vite on 3010) — or reuses yours if they
are already running. If you start the backend yourself, set `RATELIMIT_DISABLE=1`
too: the suite logs in once per test, which would otherwise trip the 10/min
login rate limit.

## Visual baselines

Baselines live in `visual.spec.ts-snapshots/` and are **per-platform**
(`…-win32.png`, `…-linux.png`). The spec freezes the clock, emulates
`prefers-reduced-motion`, kills CSS animations, waits for `document.fonts.ready`
and stubs all portal/admin data, so shots are stable; `maxDiffPixelRatio: 0.002`
absorbs sub-pixel AA jitter.

**Updating after an intentional UI change:**

```sh
npx playwright test visual.spec.ts --update-snapshots
```

then review the diff of the regenerated PNGs and commit them.

**Linux (CI) baselines:** these are the ones CI diffs against, and they are
**blocking** — a Windows-only refresh leaves CI red. Whenever you update win32
baselines on purpose, refresh the linux ones too:

1. push and let the E2E job fail on the intentional change;
2. download the **`visual-baselines-linux`** artifact from that run — the job
   regenerates the complete linux set after failing, precisely so an accepted
   redesign does not cost one CI round per viewport (a visual failure stops at
   the first mismatching viewport, so the `visual-diffs` artifact only ever
   shows part of it);
3. review the PNGs, copy them into `visual.spec.ts-snapshots/`, and commit.

## Visual regression and Lighthouse in CI (BACKLOG P5-3)

- `visual.spec.ts` is **blocking** in CI on linux. Baselines are committed per
  platform (`*-linux.png` for CI, `*-win32.png` for local Windows runs). When a
  change is intentional, regenerate on linux (`npm run test:e2e -- --grep "Visual
  baselines" --update-snapshots`, or download the `visual-diffs` artifact, eyeball
  it, and copy the `-actual.png` over the baseline) and commit the PNGs.
- `lighthouserc.json` + `lighthouse-budget.json` run Lighthouse CI against the
  built SPA served by `scripts/preview-static.mjs` (mirrors production: dist at `/static/` + SPA fallback; `vite preview` cannot, it serves dist at `/`) for Inicio, Admisiones, Costos, Pre-registro and
  Login. Failing thresholds: performance < 0.85, accessibility < 0.95, SEO < 0.9,
  CLS > 0.1, JS > 400 KB. LCP/TBT/best-practices only warn (the preview has no
  API, so data sections render their empty states). Run locally with
  `npm run build && npx @lhci/cli autorun`.
