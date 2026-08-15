/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
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
        // index.html references hashed assets at /static/assets/* (vite base),
        // so precache them under that URL — a bare 'assets/…' entry would never
        // match the browser's actual requests and the shell would break offline.
        modifyURLPrefix: { 'assets/': '/static/assets/' },
        // Push/notificationclick handlers live in public/push-sw.js so generateSW
        // stays simple (GO-LIVE-AUDIT #15).
        importScripts: ['push-sw.js'],
        cleanupOutdatedCaches: true,
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
