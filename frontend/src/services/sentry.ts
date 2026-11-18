/**
 * sentry.ts — optional front-end error monitoring.
 *
 * A complete no-op unless VITE_SENTRY_DSN is set at build time, so local dev and
 * the test suite never talk to Sentry (no init, no integrations, zero overhead).
 * No personal data is sent: see sentryScrub.ts (user reduced to its opaque id,
 * URLs without query string or fragment, no request bodies, emails and CURPs
 * masked, secret-looking headers filtered). Release is the deployed commit
 * (VITE_GIT_SHA, passed by deploy.sh when the DSN is set). Activation guide:
 * docs/SENTRY.md.
 */
import * as Sentry from '@sentry/react';
import { scrubBreadcrumb, scrubEvent } from './sentryScrub';

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
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  });
}
