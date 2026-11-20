import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { useSiteText } from '@/hooks/useSiteSettings';

/** Built-in copy; Navegación → «Textos del sitio» edits it (SiteSettings.chrome privacy_*). */
export const PRIVACY_NOTE_DEFAULTS = {
  privacy_note: 'Protegemos sus datos conforme a la LFPDPPP y solo los usamos para atender su solicitud. Consulte nuestro',
  privacy_link: 'Aviso de Privacidad',
} as const;

/**
 * LFPDPPP reassurance shown at the point of data collection on public forms.
 * Links to the Aviso de Privacidad (rendered from apps/legal's notice API).
 */
export function PrivacyNote({ className = '' }: { className?: string }) {
  const text = useSiteText();
  return (
    <p className={`flex items-start gap-2 text-xs leading-relaxed text-muted ${className}`}>
      <ShieldCheck size={15} className="mt-0.5 flex-shrink-0 text-green" aria-hidden="true" />
      <span>
        {text('privacy_note', PRIVACY_NOTE_DEFAULTS.privacy_note)}{' '}
        <Link
          to="/aviso-de-privacidad"
          className="font-semibold text-purple underline underline-offset-2 hover:text-purple-mid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 rounded-sm"
        >
          {text('privacy_link', PRIVACY_NOTE_DEFAULTS.privacy_link)}
        </Link>
        .
      </span>
    </p>
  );
}

export default PrivacyNote;
