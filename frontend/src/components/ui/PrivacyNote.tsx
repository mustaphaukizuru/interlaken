import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';

/**
 * LFPDPPP reassurance shown at the point of data collection on public forms.
 * Links to the Aviso de Privacidad (rendered from apps/legal's notice API).
 */
export function PrivacyNote({ className = '' }: { className?: string }) {
  return (
    <p className={`flex items-start gap-2 text-xs leading-relaxed text-muted ${className}`}>
      <ShieldCheck size={15} className="mt-0.5 flex-shrink-0 text-green" aria-hidden="true" />
      <span>
        Protegemos sus datos conforme a la LFPDPPP y solo los usamos para atender su
        solicitud. Consulte nuestro{' '}
        <Link
          to="/aviso-de-privacidad"
          className="font-semibold text-purple underline underline-offset-2 hover:text-purple-mid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 rounded-sm"
        >
          Aviso de Privacidad
        </Link>
        .
      </span>
    </p>
  );
}

export default PrivacyNote;
