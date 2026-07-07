/**
 * sentry.ts — optional front-end error monitoring.
 *
 * A complete no-op unless VITE_SENTRY_DSN is set at build time, so local dev and
 * the test suite never talk to Sentry. PII is not sent, and query strings /
 * auth-ish request headers are scrubbed before events leave the browser.
 */
import * as Sentry from '@sentry/react';

const SENSITIVE = ['token', 'password', 'secret', 'authorization', 'credential', 'curp'];

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      // Drop query strings (may carry OAuth tokens) and secret-looking headers.
      if (event.request) {
        if (event.request.query_string) event.request.query_string = '[Filtered]';
        const headers = event.request.headers;
        if (headers) {
          for (const key of Object.keys(headers)) {
            if (SENSITIVE.some((s) => key.toLowerCase().includes(s))) {
              headers[key] = '[Filtered]';
            }
          }
        }
      }
      return event;
    },
  });
}
