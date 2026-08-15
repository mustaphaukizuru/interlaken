#!/usr/bin/env node
/**
 * check-budgets.mjs — CI performance-budget gate (see docs/PERFORMANCE.md).
 *
 * Reads dist/.vite/manifest.json (build.manifest: true) after `npm run build`
 * and computes, for each budgeted PUBLIC route, the gzipped total of every JS
 * chunk a cold visit to that route downloads:
 *
 *   entry closure (index + vendor + query, via <script>/modulepreload)
 *   + the route's lazy page chunk and its static-import closure
 *   + chunks the page is known to eagerly dynamic-import on mount
 *     (EAGER_DYNAMIC below — e.g. the framer-motion engine on the home page).
 *
 * Fails (exit 1) when:
 *   1. a budgeted route's total exceeds its budget (default 150 kB gz;
 *      documented overrides in ROUTE_BUDGET_OVERRIDES),
 *   2. any single emitted JS chunk exceeds CHUNK_CAP_KB (120 kB gz) without an
 *      entry in CHUNK_ALLOWLIST,
 *   3. a portal/staff/admin-only chunk (FORBIDDEN_ON_PUBLIC) appears in a
 *      public route's closure — catches import-graph leaks even when the
 *      budget still happens to pass,
 *   4. the manifest or a listed route module is missing (so file renames force
 *      this map to be updated instead of silently skipping the check).
 *
 * Sizes are gzip level 9 of the emitted files; they differ slightly from the
 * numbers vite prints (level 6) — the budget tracks THIS script's numbers.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const MANIFEST_PATH = join(DIST, '.vite', 'manifest.json');

/** Default budget for every budgeted public route, kB gzipped. */
const DEFAULT_BUDGET_KB = 150;

/** Hard cap for any single emitted JS chunk, kB gzipped. */
const CHUNK_CAP_KB = 120;

/**
 * Public routes under budget → their page module in the manifest.
 * If a page file is renamed/moved, update the path here (the script fails
 * loudly on a missing key rather than skipping it).
 */
const PUBLIC_ROUTES = {
  '/': 'src/pages/public/HomePage.tsx',
  '/admisiones': 'src/pages/public/AdmissionsPage.tsx',
  '/admisiones/costos': 'src/pages/public/CostosPage.tsx',
};

/**
 * Chunks a route eagerly dynamic-imports on mount (they download on every cold
 * visit, so they count toward the route's total even though they are not in
 * its static closure). Home: <LazyMotion features> fetches the framer-motion
 * engine (lib/motionFeatures) immediately after render.
 */
const EAGER_DYNAMIC = {
  '/': ['src/lib/motionFeatures.ts'],
};

/**
 * ALLOWLIST — documented, deliberate exceptions to DEFAULT_BUDGET_KB.
 * Raising a number here must be a reviewed decision, never a drive-by fix.
 */
const ROUTE_BUDGET_OVERRIDES = {
  // Home ships the framer-motion entrance/scroll animations by design
  // (HomePage chunk carries the m/LazyMotion runtime, plus the deferred
  // ~14.5 kB gz motionFeatures engine — see src/lib/motion.tsx). That's
  // ~30 kB gz of intentional motion; dropping framer for CSS reveals would
  // reclaim it. Measured 2026-08: ~162 kB gz total.
  '/': { budgetKb: 170, reason: 'intentional framer-motion animations (~30 kB gz)' },
};

/**
 * ALLOWLIST — single chunks allowed to exceed CHUNK_CAP_KB, keyed by the
 * chunk's name prefix (file name up to the content hash). Currently empty:
 * the largest chunk today is AreaChart (~90 kB gz). Add entries with a reason.
 * Example: { prefix: 'AreaChart', maxKb: 130, reason: 'recharts core' }
 */
const CHUNK_ALLOWLIST = [];

/** Chunk-name fragments that must never appear in a public route's closure. */
const FORBIDDEN_ON_PUBLIC = [
  'AreaChart',        // recharts — portal/staff/admin only
  'useChartEntrance', // recharts core + es-toolkit
  'ChartsSection',    // staff analytics
  'KpiRow',           // staff analytics
  'schemas',          // zod + react-hook-form (public FORM pages only — never home/costos/admisiones)
  'PortalLayout',     // authenticated chrome (sidebar, notifications, date-fns es locale)
  'CredencialPage',   // jsbarcode + qrcode
];

// ── helpers ────────────────────────────────────────────────────────────────

function fail(msg) {
  console.error(`\nBUDGET CHECK FAILED: ${msg}`);
  process.exitCode = 1;
}

if (!existsSync(MANIFEST_PATH)) {
  console.error(`Missing ${MANIFEST_PATH} — run \`npm run build\` first (build.manifest must stay enabled in vite.config.ts).`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

const gzCache = new Map();
function gzKb(file) {
  if (!gzCache.has(file)) {
    const abs = join(DIST, file);
    if (!existsSync(abs)) {
      fail(`chunk listed in manifest but missing from dist: ${file}`);
      gzCache.set(file, 0);
    } else {
      gzCache.set(file, gzipSync(readFileSync(abs), { level: 9 }).length / 1024);
    }
  }
  return gzCache.get(file);
}

/**
 * Resolve a source path to its manifest key. Usually the src path itself; but
 * when a lazy page chunk absorbs a module that another chunk statically
 * imports (e.g. framer-motion lives inside the HomePage chunk and
 * motionFeatures imports it), Rollup drops the facade and the manifest keys
 * the chunk as "_<Name>-<hash>.js" instead. Fall back to matching the emitted
 * chunk name, and fail loudly if neither resolves (renames must update the map).
 */
function resolveKey(srcPath) {
  if (manifest[srcPath]) return srcPath;
  const base = srcPath.split('/').pop().replace(/\.(tsx?|jsx?)$/, '');
  const matches = Object.entries(manifest).filter(
    ([, v]) => typeof v.file === 'string' && v.file.startsWith(`assets/${base}-`),
  );
  if (matches.length === 1) return matches[0][0];
  fail(`cannot resolve "${srcPath}" in the manifest (${matches.length} chunk-name matches) — was the file renamed? Update PUBLIC_ROUTES/EAGER_DYNAMIC in scripts/check-budgets.mjs.`);
  return null;
}

/** Static-import closure of a manifest key → Set of emitted JS files. */
function closure(key, seen = new Set()) {
  if (key === null) return seen;
  const entry = manifest[key];
  if (!entry) {
    fail(`manifest key not found: "${key}" — was the file renamed? Update PUBLIC_ROUTES/EAGER_DYNAMIC in scripts/check-budgets.mjs.`);
    return seen;
  }
  if (seen.has(entry.file)) return seen;
  seen.add(entry.file);
  for (const imp of entry.imports ?? []) closure(imp, seen);
  return seen;
}

const fmt = (kb) => `${kb.toFixed(1)} kB`;

// ── 1+3: per-route budgets + forbidden-chunk leak check ────────────────────

const entryFiles = closure('index.html');
console.log(`Shared entry JS (index + vendor + query): ${fmt([...entryFiles].reduce((s, f) => s + gzKb(f), 0))} gz\n`);

for (const [route, modulePath] of Object.entries(PUBLIC_ROUTES)) {
  const files = new Set(entryFiles);
  closure(resolveKey(modulePath), files);
  for (const eager of EAGER_DYNAMIC[route] ?? []) closure(resolveKey(eager), files);

  const total = [...files].reduce((s, f) => s + gzKb(f), 0);
  const override = ROUTE_BUDGET_OVERRIDES[route];
  const budget = override?.budgetKb ?? DEFAULT_BUDGET_KB;
  const status = total <= budget ? 'OK  ' : 'OVER';
  const note = override ? `  [override: ${override.reason}]` : '';

  console.log(`${status}  ${route.padEnd(20)} ${fmt(total).padStart(9)} gz  / budget ${budget} kB  (${files.size} chunks)${note}`);

  if (total > budget) {
    const rows = [...files]
      .map((f) => [f, gzKb(f)])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([f, kb]) => `    ${fmt(kb).padStart(9)}  ${f}`)
      .join('\n');
    fail(`route ${route} loads ${fmt(total)} gz of JS — over its ${budget} kB budget.\n  Largest chunks:\n${rows}\n  Shrink the regression, or (reviewed!) raise ROUTE_BUDGET_OVERRIDES with a reason.`);
  }

  for (const f of files) {
    const hit = FORBIDDEN_ON_PUBLIC.find((frag) => f.includes(frag));
    if (hit) {
      fail(`portal-only chunk "${hit}" (${f}) is imported by public route ${route} — a static import is leaking portal code into the public site.`);
    }
  }
}

// ── 2: single-chunk cap across the whole build ─────────────────────────────

console.log('');
for (const file of readdirSync(join(DIST, 'assets'))) {
  if (!file.endsWith('.js')) continue;
  const kb = gzKb(join('assets', file));
  if (kb <= CHUNK_CAP_KB) continue;
  const allowed = CHUNK_ALLOWLIST.find((a) => file.startsWith(a.prefix));
  if (allowed && kb <= allowed.maxKb) {
    console.log(`allowlisted oversize chunk: assets/${file} (${fmt(kb)} gz ≤ ${allowed.maxKb} kB — ${allowed.reason})`);
    continue;
  }
  fail(`chunk assets/${file} is ${fmt(kb)} gz (cap ${CHUNK_CAP_KB} kB). Split it, or (reviewed!) add a CHUNK_ALLOWLIST entry with a reason.`);
}

if (process.exitCode) {
  console.error('\nSee docs/PERFORMANCE.md for what these budgets mean and how to change them.');
} else {
  console.log('All performance budgets OK.');
}
