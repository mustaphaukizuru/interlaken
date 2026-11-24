/**
 * The cookie banner (CookieConsent decides when it shows). Its words come
 * from Navegación → «Textos del sitio» (SiteSettings.chrome cookie_*);
 * blank = the built-in text below.
 */
import { Cookie } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSiteTexts } from '@/hooks/useSiteSettings';

export const COOKIE_DEFAULTS = {
  cookie_text: 'Usamos cookies para medir el uso del sitio y mejorar su experiencia. No se activa ninguna analítica hasta que usted acepte.',
  cookie_link: 'Más información',
  cookie_decline: 'Rechazar',
  cookie_accept: 'Aceptar',
} as const;

/**
 * Lift above the public phone bar («Pagos» + WhatsApp) only where that bar is
 * on screen (phones, on pages that show it: PublicLayout marks it with
 * `data-sticky-cta`). Elsewhere the banner sits on the bottom edge.
 */
const CLEAR_STICKY_CTA = 'max-md:[body:has([data-sticky-cta])_&]:mb-[76px]';
// The portal's phone tab bar (MobileTabBar, data-bottom-bar) shows below lg:
// the banner lifts above it too instead of hiding the tabs (code review 2026-11-22).
const CLEAR_TAB_BAR = 'max-lg:[body:has([data-bottom-bar])_&]:mb-[80px]';

export default function CookieBanner({ onAccept, onDecline }: { onAccept: () => void; onDecline: () => void }) {
  const text = useSiteTexts(COOKIE_DEFAULTS);
  return (
    <div
      role="region"
      aria-label="Aviso de cookies"
      className={`fixed bottom-0 inset-x-0 z-drawer ${CLEAR_STICKY_CTA} ${CLEAR_TAB_BAR} p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 sm:pb-[max(1.5rem,env(safe-area-inset-bottom))] print:hidden`}
    >
      <div className="max-w-3xl mx-auto bg-white rounded-md shadow-raised p-5 sm:flex sm:items-center sm:gap-5">
        <div className="flex items-start gap-3 flex-1">
          <div className="w-10 h-10 rounded-sm bg-brand-50 flex items-center justify-center flex-shrink-0">
            <Cookie className="w-5 h-5 text-brand-600" aria-hidden="true" />
          </div>
          <p className="text-sm text-muted leading-relaxed">
            {text.cookie_text}{' '}
            <Link to="/aviso-de-privacidad" className="text-brand-600 underline hover:text-brand-700">
              {text.cookie_link}
            </Link>
            .
          </p>
        </div>
        <div className="flex gap-2 mt-4 sm:mt-0 flex-shrink-0">
          <button
            type="button"
            onClick={onDecline}
            className="btn-secondary text-sm px-4 py-2 flex-1 sm:flex-none justify-center"
          >
            {text.cookie_decline}
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="btn-primary text-sm px-4 py-2 flex-1 sm:flex-none justify-center"
          >
            {text.cookie_accept}
          </button>
        </div>
      </div>
    </div>
  );
}
