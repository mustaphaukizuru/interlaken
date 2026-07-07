import React from 'react';
import ReactDOM from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import App from './App';
import './index.css';
import { initSentry } from './services/sentry';
import { registerSW } from 'virtual:pwa-register';

// No-op unless VITE_SENTRY_DSN is configured.
initSentry();

// Register the service worker for offline shell + installability.
// autoUpdate: new content is fetched and applied on the next navigation.
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </React.StrictMode>,
);
