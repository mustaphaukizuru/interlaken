/**
 * sentry.ts — optional front-end error monitoring.
 *
 * A complete no-op unless VITE_SENTRY_DSN is set at build time, so local dev and
 * the test suite never talk to Sentry (no init, no integrations, zero overhead).
 * PII is not sent: the user object is reduced to its opaque id, and query
 * strings / auth-ish request headers are scrubbed before events leave the
 * browser. Release defaults to the build's VITE_GIT_SHA when provided.
 */
import * as Sentry from '@sentry/react';

const SENSITIVE = ['token', 'password', 'secret', 'authorization', 'credential', 'curp'];

function parseRate(raw: string | undefined): number {
  const rate = Number(raw);
  return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 0;
}

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    release: import.meta.env.VITE_GIT_SHA || undefined,
    sendDefaultPii: false,
    // Only instantiated when a DSN exists (we returned above otherwise); the
    // sample rate stays 0 unless explicitly raised, so no transactions are
    // sent by default — the integration then only adds trace headers locally.
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: parseRate(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE),
    beforeSend(event) {
      // Keep only the opaque user id — never email/name/username/IP.
      if (event.user) {
        event.user = event.user.id !== undefined ? { id: event.user.id } : undefined;
      }
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
