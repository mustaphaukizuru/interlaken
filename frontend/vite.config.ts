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
        // Precache the app shell only; campus photos (.webp) are runtime-cached
        // on demand (see runtimeCaching below) to keep the install lightweight.
        globPatterns: ['**/*.{js,css,html,ico,svg,woff2}', 'icon-*.png', 'favicon.ico', 'apple-touch-icon.png', 'og-image.png'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/auth/, /^\/admin/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
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
          {
            // Campus imagery — serve fast, refresh in the background.
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'images',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
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
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://localhost:8000',
        changeOrigin: true,
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
