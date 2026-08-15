/**
 * CookieConsent — GDPR/LFPDPPP-style banner shown until the visitor chooses.
 *
 * Only rendered when an analytics provider is configured (no keys → no banner),
 * so local dev and tests stay clean. Accepting boots analytics immediately;
 * declining keeps every tracker dormant.
 */
import { useState } from 'react';
import { Cookie } from 'lucide-react';
import { Link } from 'react-router-dom';
import { hasConsentDecision, setConsent } from '@/services/consent';
import { initAnalytics, isAnalyticsConfigured, trackPageView } from '@/services/analytics';

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

  return (
    <div
      role="region"
      aria-label="Aviso de cookies"
      // mb-[76px] keeps the banner above the mobile tab bar / sticky CTA on small screens.
      className="fixed bottom-0 inset-x-0 z-[100] mb-[76px] lg:mb-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]"
    >
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-2xl border border-line p-5 sm:flex sm:items-center sm:gap-5">
        <div className="flex items-start gap-3 flex-1">
          <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
            <Cookie className="w-5 h-5 text-brand-600" />
          </div>
          <p className="text-sm text-muted leading-relaxed">
            Usamos cookies para medir el uso del sitio y mejorar tu experiencia.
            No se activa ninguna analítica hasta que aceptes.{' '}
            <Link to="/aviso-de-privacidad" className="text-brand-600 underline hover:text-brand-700">
              Más información
            </Link>
            .
          </p>
        </div>
        <div className="flex gap-2 mt-4 sm:mt-0 flex-shrink-0">
          <button
            type="button"
            onClick={decline}
            className="btn-secondary text-sm px-4 py-2 flex-1 sm:flex-none justify-center"
          >
            Rechazar
          </button>
          <button
            type="button"
            onClick={accept}
            className="btn-primary text-sm px-4 py-2 flex-1 sm:flex-none justify-center"
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}
