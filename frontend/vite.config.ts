/// <reference types="vitest/config" />
import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'path';

export default defineConfig(({ command }) => ({
  // In production the SPA is served by Django/whitenoise under /static/, so
  // hashed asset URLs must resolve there (see DEPLOYMENT.md §5). The dev server
  // serves from the root, so keep base '/' during `vite dev`.
  base: command === 'build' ? '/static/' : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // The SPA is built with base '/static/' but pages live at the web ROOT
      // (whitenoise serves dist/ at '/', Django's catch-all renders index.html).
      // Register the SW at /sw.js with scope '/' — with the default (vite base)
      // it would register at /static/sw.js and never control navigations, so
      // offline fallback and notificationclick client.navigate() wouldn't work.
      base: '/',
      scope: '/',
      // Reuse the curated public/site.webmanifest (already linked in index.html)
      // instead of generating a second manifest.
      manifest: false,
      includeAssets: [
        'favicon.ico',
        'apple-touch-icon.png',
        'site.webmanifest',
        'robots.txt',
      ],
      workbox: {
        // Precache the app shell (+ offline.html); campus photos (.webp) are
        // runtime-cached on demand (see runtimeCaching) to keep the install light.
        globPatterns: ['**/*.{js,css,html,ico,svg,woff2}', 'icon-*.png', 'favicon.ico', 'apple-touch-icon.png', 'og-image.png'],
        // Keep the precache to the true app shell (~1 MB instead of ~1.8 MB):
        // the biggest role-gated lazy chunks — recharts (AreaChart +
        // useChartEntrance + charts UI), the whole admin console, staff
        // analytics, the credencial (jsbarcode/qrcode) and the zod+RHF form
        // bundle — are trimmed here and picked up on demand by the
        // 'lazy-chunks' runtime route below (hash-named → CacheFirst is safe).
        // NOTE 'Admin*' must not swallow public chunks: AdmissionsPage differs
        // ('Admis'), but keep an eye on future 'Admin…'-named public pages.
        globIgnores: [
          '**/assets/AreaChart-*.js',
          '**/assets/useChartEntrance-*.js',
          '**/assets/ChartsSection-*.js',
          '**/assets/KpiRow-*.js',
          '**/assets/StaffDashboard-*.js',
          '**/assets/CredencialPage-*.js',
          '**/assets/schemas-*.js',
          '**/assets/Admin*.js',
        ],
        // index.html references hashed assets at /static/assets/* (vite base),
        // so precache them under that URL — a bare 'assets/…' entry would never
        // match the browser's actual requests and the shell would break offline.
        // Same story for the LCP preload script (vite rewrites its <script src>
        // with the /static/ base too).
        modifyURLPrefix: {
          'assets/': '/static/assets/',
          'preload-lcp.js': '/static/preload-lcp.js',
        },
        // Push/notificationclick handlers live in public/push-sw.js so generateSW
        // stays simple (GO-LIVE-AUDIT #15).
        importScripts: ['push-sw.js'],
        cleanupOutdatedCaches: true,
        // generateSW's default navigateFallback ('index.html') registers a
        // NavigationRoute AHEAD of runtimeCaching, answering EVERY navigation
        // with the SPA shell — including /admin/ and /auth/, which broke the
        // Django admin (SPA 404 at /admin/login/ in any SW-controlled browser).
        // Disable it; the 'pages' route below owns navigations and already
        // excludes the server-rendered paths + provides the offline fallback.
        navigateFallback: null,
        // First matching route wins — keep money/health NetworkOnly ABOVE the
        // generic API route. Routes register for GET only (Workbox default), so
        // POST/PUT/DELETE are never cached or served from cache.
        runtimeCaching: [
          {
            // Money + health endpoints must never be served stale: no fallback
            // cache at all. (Payments, cafetería balance, health probe.)
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api/v1/payments') ||
              url.pathname.startsWith('/api/v1/cafeteria/balance') ||
              url.pathname === '/healthz',
            handler: 'NetworkOnly',
          },
          {
            // App navigations (mirrors the Django SPA catch-all exclusions):
            // fresh HTML when online, cached copy when the network is slow/down
            // (3s timeout also masks Render free-tier cold starts), and the
            // branded es-MX offline page when nothing is cached.
            urlPattern: ({ request, url }) =>
              request.mode === 'navigate' &&
              !/^\/(api|admin|auth|static|media)\//.test(url.pathname) &&
              url.pathname !== '/healthz',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [200] },
              precacheFallback: { fallbackURL: '/offline.html' },
            },
          },
          {
            // Other API GETs — network-first with a short-lived fallback cache
            // so the portal shows recent data during brief offline windows.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 5 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Hashed build assets trimmed from the precache (see globIgnores:
            // charts/admin/staff/credencial/forms). Content-hashed filenames
            // are immutable, so CacheFirst is safe; cached on first use so a
            // portal user who visited a section keeps it working offline.
            // Precached assets never reach this route (precache wins).
            urlPattern: ({ url }) => url.pathname.startsWith('/static/assets/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'lazy-chunks',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Campus imagery — hashed/immutable-ish: cache-first, capped.
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'images',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Google Fonts stylesheet + files.
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        // Keep the SW off during `vite dev` to avoid stale-cache confusion.
        enabled: false,
      },
    }),
    // Bundle analysis, build-time only and opt-in: `ANALYZE=1 npm run build`
    // (PowerShell: `$env:ANALYZE='1'; npm run build`) writes an interactive
    // treemap to stats.html (gitignored). Never runs in normal/CI builds.
    ...(process.env.ANALYZE
      ? [
          visualizer({
            filename: 'stats.html',
            template: 'treemap',
            gzipSize: true,
          }) as PluginOption,
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
  server: {
    port: 3000,
    proxy: {
      // Backend dev server; override with DEV_API_TARGET when :8000 is taken
      // (e.g. Windows dynamic port exclusions reserving 7901–8100).
      '/api': {
        target: process.env.DEV_API_TARGET || 'http://localhost:8000',
        changeOrigin: true,
        configure: (proxy) => {
          // Backend unreachable in dev → JSON 502 the SPA's data layer surfaces
          // (ErrorState), instead of Vite's raw HTML 500.
          proxy.on('error', (_err, _req, res) => {
            if ('writeHead' in res && !res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ detail: 'Backend no disponible (dev). ¿Está corriendo en :8000?' }));
            }
          });
        },
      },
      '/auth': {
        target: process.env.DEV_API_TARGET || 'http://localhost:8000',
        changeOrigin: true,
        configure: (proxy) => {
          // A full-page nav to a down backend (e.g. /auth/google/) should land on
          // the SPA login with a friendly error, not a raw browser 500.
          proxy.on('error', (_err, req, res) => {
            if (!('writeHead' in res) || res.headersSent) return;
            if ((req.headers?.accept || '').includes('text/html')) {
              res.writeHead(302, { Location: '/login?error=backend_unreachable' });
              res.end();
            } else {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ detail: 'Backend no disponible (dev).' }));
            }
          });
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // .vite/manifest.json maps source modules → emitted chunks (+ their static
    // import graph). scripts/check-budgets.mjs walks it to compute the real JS
    // payload of each public route (see docs/PERFORMANCE.md).
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
}));
