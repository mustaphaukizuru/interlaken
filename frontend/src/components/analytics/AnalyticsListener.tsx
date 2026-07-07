/**
 * AnalyticsListener — bridges React Router navigation to the analytics service.
 *
 * Rendered once inside <BrowserRouter>. Boots analytics if consent was granted
 * on a previous visit, re-boots the instant consent changes, and reports a
 * page view on every SPA route change. All calls no-op without consent/config.
 */
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { hasAnalyticsConsent, onConsentChange } from '@/services/consent';
import { initAnalytics, trackPageView } from '@/services/analytics';

export function AnalyticsListener() {
  const { pathname } = useLocation();
  const firstRun = useRef(true);

  // Boot on load (returning visitor) and whenever consent flips to granted.
  useEffect(() => {
    if (hasAnalyticsConsent()) initAnalytics();
    return onConsentChange((value) => {
      if (value === 'granted') {
        initAnalytics();
        trackPageView(window.location.pathname);
      }
    });
  }, []);

  // Report a page view on every route change (including the initial load).
  useEffect(() => {
    // Skip the very first render only if consent isn't granted yet; the
    // CookieConsent accept handler tracks the initial view once granted.
    if (firstRun.current) {
      firstRun.current = false;
      if (!hasAnalyticsConsent()) return;
    }
    trackPageView(pathname);
  }, [pathname]);

  return null;
}
