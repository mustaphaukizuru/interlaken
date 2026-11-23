import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, KeyRound, X } from 'lucide-react';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { waHref } from '@/lib/siteContact';
import { siteTexts } from '@/lib/siteChrome';
import { PASSWORD_REQUEST_MESSAGE } from '@/components/portal/PasswordHelp';
import { trackEvent, ConversionEvent } from '@/services/analytics';
import { WhatsAppIcon } from '@/components/icons/WhatsAppIcon';

/** Built-in copy; Navegación → «Textos del sitio» edits it (SiteSettings.chrome). */
export const FLOAT_DEFAULTS = {
  wa_float: 'Hola, me gustaría obtener más información sobre el Colegio Interlaken.',
  wa_password: PASSWORD_REQUEST_MESSAGE,
  float_whatsapp: 'WhatsApp',
  float_visit: 'Agendar visita',
  float_password: 'Recuperar contraseña',
} as const;

/**
 * Floating launcher on every public page (BACKLOG P2-14): one bubble that opens
 * three actions: WhatsApp, Agendar visita, Solicitar contraseña. The number is
 * admin-editable; with no number the launcher only offers the visit link.
 * On phones the sticky "Agendar visita" bar already carries WhatsApp, so while
 * that bar is visible the bubble renders from md up only. The ficha's steps
 * (FichaWizard, `data-ficha-steps` on <html>) put their own action bar at the
 * bottom of a phone, so there too the bubble waits for md.
 */
export function WhatsAppFloat({ stickyCtaVisible = true }: { stickyCtaVisible?: boolean }) {
  const { whatsapp_number, chrome } = useSiteSettings();
  const text = siteTexts(chrome, FLOAT_DEFAULTS);
  const [open, setOpen] = useState(false);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!whatsapp_number) return null;
  const wrap = `fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-sticky ${stickyCtaVisible ? 'hidden md:flex' : 'flex'} flex-col items-end gap-2 md:right-6 md:bottom-6 max-[767px]:[html[data-ficha-steps]_&]:hidden print:hidden`;
  const item = 'flex min-h-[44px] items-center gap-2 rounded-sm bg-white px-4 text-sm font-semibold text-ink shadow-raised hover:bg-cream-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40';

  return (
    <div className={wrap}>
      {open && (
        // A plain list of links (no role="menu": that promises arrow-key
        // navigation these links don't implement). Tab reaches them in order.
        <ul id={listId} aria-label="Contacto rápido" className="flex flex-col items-end gap-2">
          <li>
            <a href={waHref(whatsapp_number, text.wa_float)} target="_blank" rel="noopener noreferrer" className={item}
              onClick={() => { trackEvent(ConversionEvent.WhatsappCta, { context: 'burbuja_flotante' }); setOpen(false); }}>
              <WhatsAppIcon className="h-4 w-4 text-green-600" /> {text.float_whatsapp}
            </a>
          </li>
          <li>
            <Link to="/agendar-visita" className={item} onClick={() => setOpen(false)}>
              <CalendarCheck className="h-4 w-4 text-purple" aria-hidden="true" /> {text.float_visit}
            </Link>
          </li>
          <li>
            <a href={waHref(whatsapp_number, text.wa_password)} target="_blank" rel="noopener noreferrer" className={item} onClick={() => setOpen(false)}>
              <KeyRound className="h-4 w-4 text-coral" aria-hidden="true" /> {text.float_password}
            </a>
          </li>
        </ul>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={open ? 'Cerrar contacto rápido' : 'Contactar al colegio'}
        title="Contactar al colegio"
        className="flex h-14 w-14 items-center justify-center rounded-md bg-green-600 text-white shadow-green transition-transform hover:scale-105 hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
      >
        {open ? <X className="h-6 w-6" aria-hidden="true" /> : <WhatsAppIcon className="h-6 w-6" />}
      </button>
    </div>
  );
}

export default WhatsAppFloat;
