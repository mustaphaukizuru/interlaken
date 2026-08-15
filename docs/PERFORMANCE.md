# Performance budgets

The public marketing site has a CI-enforced JavaScript budget. `npm run
check:budgets` (frontend/, runs in CI right after the Vite build) reads
`dist/.vite/manifest.json` and computes, per budgeted route, the gzipped total
of every JS chunk a cold visit downloads: the shared entry (index + vendor +
query), the route's lazy page chunk with its static-import closure, and any
chunk the page eagerly dynamic-imports on mount (home: the framer-motion
engine, `motionFeatures`).

| Route | Budget (gz) | Measured 2026-08 |
| --- | --- | --- |
| `/` (home) | 170 kB (documented override) | ~162 kB |
| `/admisiones` | 150 kB | ~134 kB |
| `/admisiones/costos` | 150 kB | ~128 kB |

Two more gates ride along: any single chunk over **120 kB gz** fails unless
allowlisted, and portal-only chunks (recharts/`AreaChart`, `PortalLayout`,
`schemas` = zod + react-hook-form, `CredencialPage`, staff charts) must never
appear in a public route's import closure — that catches import-graph leaks
even when the numbers still pass.

## Updating the allowlist

All knobs live at the top of `frontend/scripts/check-budgets.mjs`:

- `ROUTE_BUDGET_OVERRIDES` — per-route exceptions to the 150 kB default. Each
  entry needs a reason; today only `/` has one (the intentional framer-motion
  entrance/scroll animations cost ~30 kB gz — HomePage carries the `m`/
  `LazyMotion` runtime and defers the engine; swap them for CSS reveals to
  reclaim it). Raising a number is a reviewed decision, not a fix for a red CI.
- `CHUNK_ALLOWLIST` — single chunks allowed past the 120 kB cap (empty today;
  the largest chunk is recharts' `AreaChart` at ~90 kB gz).
- `PUBLIC_ROUTES` / `EAGER_DYNAMIC` — update the module paths when a page file
  is renamed; the script fails loudly on unresolved paths instead of skipping.

To see *why* a number moved: `ANALYZE=1 npm run build` (PowerShell:
`$env:ANALYZE='1'; npm run build`) writes an interactive treemap to
`frontend/stats.html` (gitignored, rollup-plugin-visualizer).

## Related decisions

- **The `schemas` chunk (~100 kB min / ~30 kB gz)** is zod 4's core (the chunk
  is named after zod's internal `schemas` module) plus react-hook-form and
  @hookform/resolvers. It is shared by the four lazy public *form* pages
  (pre-registro, contacto, puertas-abiertas, agendar-visita) and downloads
  only when one of them is visited — never on home/costos/admisiones (the
  forbidden-chunk check enforces that). It stays as is: zod's classic API
  doesn't tree-shake further, and shrinking it would mean rewriting the four
  schemas against `zod/mini` plus swapping resolvers — a large diff for a
  chunk that already loads only where needed. (The app is already on zod 4,
  so the dependabot 3→4 topic changes nothing here.)
- **Sentry** is dynamically imported in `main.tsx`, so DSN-enabled production
  builds keep ~30 kB gz of `@sentry/react` off the critical path (DSN-less
  dev/CI builds tree-shake it entirely — CI therefore measures without it).
- **PWA precache** is trimmed to the app shell (~1.0 MB / 138 entries, was
  ~1.8 MB / 140): recharts, the admin console, staff analytics, the
  credencial and the zod form bundle are excluded via `globIgnores` in
  `vite.config.ts` and picked up on demand by the `lazy-chunks` CacheFirst
  runtime route (safe: filenames are content-hashed). `offline.html` and the
  navigation fallback are unchanged.
- **Home LCP**: `public/preload-lcp.js` (external file — the public CSP has no
  `unsafe-inline`) preloads the hero image on `/` only, during HTML parse.

## Render free-tier cold start (~50 s) is not a bundle problem

The occasional ~50 s first response is the Render free instance waking from
sleep — server-side spin-up, unrelated to asset sizes, and no frontend change
will move it. Mitigations: the existing `/healthz` pinger keeps the instance
warm most of the time; the real fix is a paid always-on instance. (The service
worker also masks part of it for repeat visitors: navigations fall back to the
cached shell after a 3 s network timeout.)
