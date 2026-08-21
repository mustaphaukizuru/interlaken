import { describe, it, expect } from 'vitest';
// Vite raw import — avoids node:fs so tsc --noEmit stays happy.
import viteConfig from '../../vite.config.ts?raw';

/**
 * Guards the service worker's navigation routing (vite.config.ts → workbox).
 *
 * Regression (2026-08): generateSW's default navigateFallback ('index.html')
 * registers a Workbox NavigationRoute AHEAD of every runtimeCaching route, so
 * a SW-controlled browser answered EVERY top-level navigation with the SPA
 * shell — the Django admin (/admin/login/) and the Google OAuth flow
 * (/auth/google/ start, /auth/social/... callback) all rendered the React 404.
 */
describe('service worker navigation routing', () => {
  it('disables the generateSW navigateFallback so the pages route owns navigations', () => {
    expect(viteConfig).toContain('navigateFallback: null');
  });

  it('excludes every server-rendered prefix from the SPA pages route', () => {
    // Pull the actual exclusion regex out of the config so this test cannot
    // drift from what ships in the service worker.
    const source = viteConfig.match(/!\/(\^.*?)\/\.test\(url\.pathname\)/)?.[1];
    expect(source).toBeTruthy();
    const excluded = new RegExp(source!);

    // Django-served paths the SW must never answer with the SPA shell.
    for (const path of [
      '/admin/login/',
      '/admin/cafeteria/',
      '/auth/google/',
      '/auth/social/complete/google-oauth2/',
      '/api/v1/accounts/me/',
      '/static/assets/index-abc123.js',
      '/media/documents/acta.pdf',
    ]) {
      expect(excluded.test(path), `${path} should be excluded`).toBe(true);
    }

    // SPA routes that must keep offline support ('/administracion' is public —
    // 'admin' without the trailing slash must NOT match, same trap as the CSP
    // path-scoping bug).
    for (const path of [
      '/',
      '/login',
      '/administracion',
      '/portal/cafeteria/recarga/retorno',
    ]) {
      expect(excluded.test(path), `${path} should stay on the SPA route`).toBe(false);
    }
  });
});
