import { MessageCircle, Mail, KeyRound } from 'lucide-react';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { waHref } from '@/lib/siteContact';
import { siteText } from '@/lib/siteChrome';

/**
 * School policy (2026-08-22): families and students NEVER reset or change
 * their own password. They ask the school (WhatsApp or email) and an admin
 * sets a new one from the portal. This block is the single place that
 * explains it, used on the login page and in "Mi información".
 */
export const PASSWORD_REQUEST_MESSAGE =
  'Hola, necesito que me recuerden o restablezcan la contraseña de mi acceso al portal de familias.';

/** The inline line's words; the login page passes them (Contenido → Iniciar sesión). */
export interface PasswordInlineCopy { before: string; whatsapp: string; or: string; email: string; after: string }

interface Props {
  /** Compact inline variant for the login card; default is a full card body. */
  variant?: 'inline' | 'card';
  /** Email of the person asking, prefilled into the mail body when known. */
  email?: string;
  /** Inline variant copy (the login page passes the school's edited text). */
  copy?: PasswordInlineCopy;
}

export function PasswordHelp({ variant = 'card', email, copy }: Props) {
  const s = useSiteSettings();
  // The WhatsApp/e-mail request text is editable in Navegación → «Textos del sitio».
  const request = siteText(s.chrome, 'wa_password', PASSWORD_REQUEST_MESSAGE);
  const wa = s.whatsapp_number ? waHref(s.whatsapp_number, request) : null;
  const body = email ? `${request}\n\nCorreo de acceso: ${email}` : request;
  const mailto = `mailto:${s.contact_email}?subject=${encodeURIComponent('Solicitud de contraseña del portal')}&body=${encodeURIComponent(body)}`;

  if (variant === 'inline' && copy) {
    const c = copy;
    return (
      <p className="mt-3.5 text-center text-[12px] leading-relaxed text-subtle">
        {c.before}{' '}
        {wa && (
          <>
            <a href={wa} target="_blank" rel="noopener noreferrer" className="font-semibold text-purple hover:underline">{c.whatsapp}</a>
            {` ${c.or} `}
          </>
        )}
        <a href={mailto} className="font-semibold text-purple hover:underline">{c.email}</a>.
        {' '}{c.after}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="flex items-center gap-2 font-head text-base font-semibold text-ink">
        <KeyRound className="h-4 w-4 text-purple" aria-hidden="true" /> Contraseña
      </h2>
      <p className="text-sm text-muted">
        Por seguridad, las contraseñas del portal las asigna el colegio y no se pueden cambiar
        desde el portal. Si necesita que se la recuerden o restablezcan, solicítelo y un
        administrador le enviará una nueva por el mismo medio.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        {wa && (
          <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-[44px] justify-center text-sm">
            <MessageCircle className="h-4 w-4" aria-hidden="true" /> Solicitar por WhatsApp
          </a>
        )}
        <a href={mailto} className="btn-outline min-h-[44px] justify-center text-sm">
          <Mail className="h-4 w-4" aria-hidden="true" /> Solicitar por correo
        </a>
      </div>
    </div>
  );
}

export default PasswordHelp;
