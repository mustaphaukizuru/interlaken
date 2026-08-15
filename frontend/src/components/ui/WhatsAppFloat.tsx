import { useSiteSettings } from '@/hooks/useSiteSettings';
import { waLink } from '@/lib/whatsapp';
import { trackEvent, ConversionEvent } from '@/services/analytics';
import { WhatsAppIcon } from '@/components/icons/WhatsAppIcon';

const FLOAT_TEXT = 'Hola, me gustaría obtener más información sobre el Colegio Interlaken.';

/**
 * Floating WhatsApp bubble, fixed to the right edge of every public page.
 * The number is admin-editable (Contenido del sitio → Ajustes del sitio);
 * with no number configured the bubble simply doesn't render. On phones the
 * sticky "Agendar visita" bar already carries a WhatsApp action, so while
 * that bar is visible the bubble only renders from md up — never two
 * WhatsApp affordances stacked on a phone screen.
 */
export function WhatsAppFloat({ stickyCtaVisible = true }: { stickyCtaVisible?: boolean }) {
  const { whatsapp_number } = useSiteSettings();
  if (!whatsapp_number) return null;

  return (
    <a
      href={waLink(whatsapp_number, FLOAT_TEXT)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Contactar por WhatsApp"
      title="Contactar por WhatsApp"
      onClick={() => trackEvent(ConversionEvent.WhatsappCta, { context: 'burbuja_flotante' })}
      className={`fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 ${
        stickyCtaVisible ? 'hidden md:flex' : 'flex'
      } h-14 w-14 items-center justify-center rounded-full bg-green-600 text-white shadow-green transition-transform hover:scale-105 hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 md:right-6 md:bottom-6`}
    >
      <WhatsAppIcon className="h-7 w-7" />
    </a>
  );
}

export default WhatsAppFloat;
