/**
 * CookieConsent — GDPR/LFPDPPP-style banner shown until the visitor chooses.
 *
 * Only rendered when an analytics provider is configured (no keys → no banner),
 * so local dev and tests stay clean. Accepting boots analytics immediately;
 * declining keeps every tracker dormant. The banner's words are edited in
 * Navegación → «Textos del sitio» (./CookieBanner).
 */
import { useState } from 'react';
import { hasConsentDecision, setConsent } from '@/services/consent';
import { initAnalytics, isAnalyticsConfigured, trackPageView } from '@/services/analytics';

import CookieBanner from './CookieBanner';

export function CookieConsent() {
  // Config + stored consent are fixed for the life of the page, so the initial
  // visibility is computed once (lazy init) instead of synced via an effect.
  const [visible, setVisible] = useState(
    () => isAnalyticsConfigured() && !hasConsentDecision(),
  );

  if (!visible) return null;

  const accept = () => {
    setConsent('granted');
    initAnalytics();
    trackPageView(window.location.pathname);
    setVisible(false);
  };

  const decline = () => {
    setConsent('denied');
    setVisible(false);
  };

  return <CookieBanner onAccept={accept} onDecline={decline} />;
}
