import React from 'react';
import ReactDOM from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import App from './App';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

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
  // installability). autoUpdate applies new content on the next navigation.
  registerSW({ immediate: true });
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </React.StrictMode>,
);
