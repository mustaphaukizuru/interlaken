#!/usr/bin/env node
/**
 * check-sw.mjs — CI gate for the generated service worker (dist/sw.js).
 *
 * Incident (2026-08-21): vite-plugin-pwa's generateSW default navigateFallback
 * registered a NavigationRoute bound to index.html AHEAD of runtimeCaching.
 * Every SW-controlled browser then answered EVERY navigation with the SPA
 * shell — including the server-rendered /auth/google/ and /admin/ paths — so
 * Google login rendered the React 404 page and the Django admin was
 * unreachable. vite.config.ts sets `navigateFallback: null` to fix it; this
 * script makes sure that fix can never silently regress (a plugin upgrade or
 * a well-meaning config edit would otherwise reintroduce it unnoticed, since
 * nothing in the unit tests exercises the built worker).
 *
 * Fails (exit 1) when:
 *   1. dist/sw.js is missing (the build no longer emits a worker),
 *   2. the worker contains a NavigationRoute / createHandlerBoundToURL
 *      (the global navigation hijack),
 *   3. the worker no longer excludes the server-rendered prefixes
 *      (/api, /admin, /auth, /static, /media) from its page route,
 *   4. the push companion (push-sw.js) is not imported.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const swPath = join(root, 'dist', 'sw.js');

const fail = (msg) => {
  console.error(`✗ check-sw: ${msg}`);
  process.exit(1);
};

if (!existsSync(swPath)) fail(`${swPath} is missing — run \`npm run build\` first`);
const sw = readFileSync(swPath, 'utf8');

if (/NavigationRoute|createHandlerBoundToURL/.test(sw)) {
  fail(
    'dist/sw.js registers a NavigationRoute (navigateFallback). This answers ' +
      '/auth/* and /admin/* with the SPA shell and breaks Google login + the ' +
      'Django admin. Keep `workbox.navigateFallback: null` in vite.config.ts.',
  );
}

// The 'pages' route's exclusion regex survives minification verbatim.
if (!/\^\\\/\(api\|admin\|auth\|static\|media\)\\\//.test(sw)) {
  fail(
    'dist/sw.js no longer excludes /api, /admin, /auth, /static and /media ' +
      'from the page (navigate) route — see the `pages` runtimeCaching entry ' +
      'in vite.config.ts.',
  );
}

if (!/importScripts\(["']push-sw\.js["']\)/.test(sw)) {
  fail('dist/sw.js does not import push-sw.js (push notifications would stop working).');
}

console.log('✓ check-sw: no navigation hijack, server paths excluded, push companion imported');
