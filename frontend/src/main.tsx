import React from 'react';
import ReactDOM from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import App from './App';
import './index.css';
import { initSentry } from './services/sentry';
import { registerSW } from 'virtual:pwa-register';

// No-op unless VITE_SENTRY_DSN is configured.
initSentry();

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
