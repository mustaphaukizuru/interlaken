/**
 * analytics.ts — consent-gated web analytics (GA4 *or* Plausible).
 *
 * Design goals:
 *  - Privacy first: nothing loads until cookie consent is granted (see consent.ts).
 *  - Zero config = zero effect: with no env keys set, every function is a no-op,
 *    so dev and CI never talk to a tracker.
 *  - Provider-agnostic API: trackPageView / trackEvent work the same whether
 *    GA4 or Plausible is configured.
 *
 * Configure exactly one provider via env:
 *   VITE_GA4_MEASUREMENT_ID   e.g. G-XXXXXXXXXX
 *   VITE_PLAUSIBLE_DOMAIN     e.g. interlaken.edu.mx
 *   VITE_PLAUSIBLE_SRC        (optional) self-hosted script URL
 */
import { hasAnalyticsConsent } from './consent';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    plausible?: (event: string, opts?: { props?: Record<string, unknown> }) => void;
  }
}

const GA4_ID = import.meta.env.VITE_GA4_MEASUREMENT_ID;
const PLAUSIBLE_DOMAIN = import.meta.env.VITE_PLAUSIBLE_DOMAIN;
const PLAUSIBLE_SRC =
  import.meta.env.VITE_PLAUSIBLE_SRC || 'https://plausible.io/js/script.manual.js';

type Provider = 'ga4' | 'plausible' | null;

const provider: Provider = GA4_ID ? 'ga4' : PLAUSIBLE_DOMAIN ? 'plausible' : null;

let loaded = false;

/** True when a provider is configured via env. */
export function isAnalyticsConfigured(): boolean {
  return provider !== null;
}

function injectScript(src: string, attrs: Record<string, string> = {}): void {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  document.head.appendChild(s);
}

/**
 * Load the configured provider's script. Safe to call repeatedly — it only runs
 * once, and never before consent is granted or without a configured provider.
 */
export function initAnalytics(): void {
  if (loaded || !provider || !hasAnalyticsConsent()) return;
  loaded = true;

  if (provider === 'ga4') {
    injectScript(`https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
    window.gtag('js', new Date());
    // Manual page_view so SPA route changes are tracked explicitly.
    window.gtag('config', GA4_ID, { send_page_view: false, anonymize_ip: true });
  } else if (provider === 'plausible') {
    injectScript(PLAUSIBLE_SRC, { 'data-domain': PLAUSIBLE_DOMAIN! });
    window.plausible =
      window.plausible ||
      function plausible() {
        (window.plausible as unknown as { q: unknown[] }).q =
          (window.plausible as unknown as { q?: unknown[] }).q || [];
        // eslint-disable-next-line prefer-rest-params
        (window.plausible as unknown as { q: unknown[] }).q.push(arguments);
      };
  }
}

/** Record a page view for the current SPA route. No-op without consent/config. */
export function trackPageView(path: string): void {
  if (!loaded || !provider) return;
  if (provider === 'ga4') {
    window.gtag?.('event', 'page_view', {
      page_path: path,
      page_location: window.location.origin + path,
    });
  } else if (provider === 'plausible') {
    window.plausible?.('pageview');
  }
}

/** Record a custom event with optional properties. No-op without consent/config. */
export function trackEvent(name: string, props: Record<string, unknown> = {}): void {
  if (!loaded || !provider) return;
  if (provider === 'ga4') {
    window.gtag?.('event', name, props);
  } else if (provider === 'plausible') {
    window.plausible?.(name, { props });
  }
}

/**
 * Admissions funnel + conversion events. Centralised so names stay consistent
 * across the codebase and are easy to build funnels/goals from in the tool.
 */
export const FunnelEvent = {
  ViewAdmissions: 'funnel_view_admisiones',
  StartPreRegister: 'funnel_start_pre_registro',
  SubmitPreRegister: 'funnel_submit_pre_registro',
  ViewInscripcion: 'funnel_view_inscripcion',
  BookingConversion: 'conversion_agendar_visita',
} as const;

/**
 * Admissions conversion micro-events (P6 funnel work). Fired through the same
 * consent-gated trackEvent transport:
 *  - AdmissionsStepCta → props { step }        (timeline CTA clicked)
 *  - EstimatorUsed     → props { section, modality }
 *  - WhatsappCta       → props { context }     (which WhatsApp button)
 */
export const ConversionEvent = {
  AdmissionsStepCta: 'admissions_step_cta',
  EstimatorUsed: 'estimator_used',
  WhatsappCta: 'whatsapp_cta',
} as const;
