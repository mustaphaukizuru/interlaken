import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, KeyRound, X } from 'lucide-react';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { waLink } from '@/lib/whatsapp';
import { PASSWORD_REQUEST_MESSAGE } from '@/components/portal/PasswordHelp';
import { trackEvent, ConversionEvent } from '@/services/analytics';
import { WhatsAppIcon } from '@/components/icons/WhatsAppIcon';

const FLOAT_TEXT = 'Hola, me gustaría obtener más información sobre el Colegio Interlaken.';

/**
 * Floating launcher on every public page (BACKLOG P2-14): one bubble that opens
 * three actions: WhatsApp, Agendar visita, Solicitar contraseña. The number is
 * admin-editable; with no number the launcher only offers the visit link.
 * On phones the sticky "Agendar visita" bar already carries WhatsApp, so while
 * that bar is visible the bubble renders from md up only.
 */
export function WhatsAppFloat({ stickyCtaVisible = true }: { stickyCtaVisible?: boolean }) {
  const { whatsapp_number } = useSiteSettings();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!whatsapp_number) return null;
  const wrap = `fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 ${stickyCtaVisible ? 'hidden md:flex' : 'flex'} flex-col items-end gap-2 md:right-6 md:bottom-6`;
  const item = 'flex min-h-[44px] items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-ink shadow-card ring-1 ring-line hover:bg-cream-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40';

  return (
    <div className={wrap}>
      {open && (
        <div role="menu" aria-label="Contacto rápido" className="flex flex-col items-end gap-2">
          <a role="menuitem" href={waLink(whatsapp_number, FLOAT_TEXT)} target="_blank" rel="noopener noreferrer" className={item}
            onClick={() => { trackEvent(ConversionEvent.WhatsappCta, { context: 'burbuja_flotante' }); setOpen(false); }}>
            <WhatsAppIcon className="h-4 w-4 text-green-600" /> WhatsApp
          </a>
          <Link role="menuitem" to="/agendar-visita" className={item} onClick={() => setOpen(false)}>
            <CalendarCheck className="h-4 w-4 text-purple" aria-hidden="true" /> Agendar visita
          </Link>
          <a role="menuitem" href={waLink(whatsapp_number, PASSWORD_REQUEST_MESSAGE)} target="_blank" rel="noopener noreferrer" className={item} onClick={() => setOpen(false)}>
            <KeyRound className="h-4 w-4 text-coral" aria-hidden="true" /> Recuperar contraseña
          </a>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={open ? 'Cerrar contacto rápido' : 'Contactar al colegio'}
        title="Contactar al colegio"
        className="flex h-14 w-14 items-center justify-center rounded-full bg-green-600 text-white shadow-green transition-transform hover:scale-105 hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
      >
        {open ? <X className="h-6 w-6" aria-hidden="true" /> : <WhatsAppIcon className="h-7 w-7" />}
      </button>
    </div>
  );
}

export default WhatsAppFloat;
