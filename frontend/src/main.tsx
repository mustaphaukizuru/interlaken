import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { registerSW } from 'virtual:pwa-register';
import { freshPageLoad, markUpdateReady } from './lib/appUpdate';
import { captureInstallPrompt } from './lib/installPrompt';

// Sentry is dynamically imported (perf budget): a static import would put the
// whole @sentry/react runtime (~30 kB gz) in the critical `index` chunk of
// every route whenever a DSN is configured at build time. The env check is
// statically replaced by Vite, so DSN-less builds (dev/CI) emit no Sentry
// chunk at all; DSN builds fetch it in parallel with the route chunk. Errors
// thrown in the few ms before init are traded for a faster first paint.
if (import.meta.env.VITE_SENTRY_DSN) {
  void import('./services/sentry').then(({ initSentry }) => initSentry());
}

if (import.meta.env.PROD) {
  // Register the service worker only in production builds (offline shell +
  // installability). A new version installs in the background; the plugin
  // used to reload the page right then (even mid-form). Now: a page opened
  // seconds ago reloads at once (nothing to lose), otherwise the new version
  // loads on the next page change or from the «Actualizar» banner.
  registerSW({
    immediate: true,
    onNeedReload: () => {
      markUpdateReady();
      if (freshPageLoad()) window.location.reload();
      else void import('./components/UpdateBanner').then((m) => m.showUpdateBanner());
    },
    // Consoles stay open all day: look for a new version every hour.
    onRegisteredSW: (_url, reg) => {
      if (reg) window.setInterval(() => { if (!document.hidden && navigator.onLine) void reg.update().catch(() => {}); }, 60 * 60 * 1000);
    },
  });
  // A page left open across a deploy asks for code files that no longer
  // exist: load the new version instead of showing the error screen (at most
  // once a minute, so a real outage cannot loop).
  window.addEventListener('vite:preloadError', (e) => {
    try {
      const last = Number(sessionStorage.getItem('interlaken.reloadedAt') || 0);
      if (Date.now() - last < 60_000) return;
      sessionStorage.setItem('interlaken.reloadedAt', String(Date.now()));
    } catch { return; }
    e.preventDefault();
    window.location.reload();
  });
} else if ('serviceWorker' in navigator) {
  // Dev: proactively tear down any service worker left over from a previous
  // production build, and drop its caches, so `vite dev` always serves the
  // freshest code instead of a stale precached shell.
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => regs.forEach((r) => r.unregister()))
    .catch(() => {});
  if (typeof caches !== 'undefined') {
    caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
  }
}

// The browser's «install this app» offer fires once, early: keep it for the credential page.
captureInstallPrompt();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
