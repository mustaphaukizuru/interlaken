/**
 * The cookie banner (CookieConsent decides when it shows). Its words come
 * from Navegación → «Textos del sitio» (SiteSettings.chrome cookie_*);
 * blank = the built-in text below.
 */
import { Cookie } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSiteTexts } from '@/hooks/useSiteSettings';

export const COOKIE_DEFAULTS = {
  cookie_text: 'Usamos cookies para medir el uso del sitio y mejorar tu experiencia. No se activa ninguna analítica hasta que aceptes.',
  cookie_link: 'Más información',
  cookie_decline: 'Rechazar',
  cookie_accept: 'Aceptar',
} as const;

export default function CookieBanner({ onAccept, onDecline }: { onAccept: () => void; onDecline: () => void }) {
  const text = useSiteTexts(COOKIE_DEFAULTS);
  return (
    <div
      role="region"
      aria-label="Aviso de cookies"
      // mb-[76px] keeps the banner above the mobile tab bar / sticky CTA on small screens.
      className="fixed bottom-0 inset-x-0 z-drawer mb-[76px] lg:mb-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]"
    >
      <div className="max-w-3xl mx-auto bg-white rounded-md shadow-2xl p-5 sm:flex sm:items-center sm:gap-5">
        <div className="flex items-start gap-3 flex-1">
          <div className="w-10 h-10 rounded-md bg-brand-50 flex items-center justify-center flex-shrink-0">
            <Cookie className="w-5 h-5 text-brand-600" />
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
