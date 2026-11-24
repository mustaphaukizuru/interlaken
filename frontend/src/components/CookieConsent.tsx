/**
 * CookieConsent — GDPR/LFPDPPP-style banner shown until the visitor chooses.
 *
 * Only rendered when an analytics provider is configured (no keys → no banner),
 * so local dev and tests stay clean. Accepting boots analytics immediately;
 * declining keeps every tracker dormant. The banner's words are edited in
 * Navegación → «Textos del sitio» (./CookieBanner).
 */
import { lazy, Suspense, useState } from 'react';
import { hasConsentDecision, setConsent } from '@/services/consent';
import { isAnalyticsConfigured } from '@/services/analytics';

// Only a first visit (with analytics configured) shows the banner, so its
// words and markup load on demand instead of in every page's first JS.
const CookieBanner = lazy(() => import('./CookieBanner'));

export function CookieConsent() {
  // Config + stored consent are fixed for the life of the page, so the initial
  // visibility is computed once (lazy init) instead of synced via an effect.
  const [visible, setVisible] = useState(
    () => isAnalyticsConfigured() && !hasConsentDecision(),
  );

  if (!visible) return null;

  // Granting consent is enough: AnalyticsListener (subscribed to consent
  // changes) boots analytics and reports this page once. Doing it here too
  // counted the first page twice (QA 2026-11-23).
  const accept = () => {
    setConsent('granted');
    setVisible(false);
  };

  const decline = () => {
    setConsent('denied');
    setVisible(false);
  };

  return <Suspense fallback={null}><CookieBanner onAccept={accept} onDecline={decline} /></Suspense>;
}
