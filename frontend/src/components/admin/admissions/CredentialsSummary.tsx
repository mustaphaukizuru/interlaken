import { Link } from 'react-router-dom';
import { Mail, MessageCircle } from 'lucide-react';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { credentialTemplate, mailtoDeliveryHref, whatsappDeliveryHref } from '@/lib/credentialTemplates';

export interface CredentialsResult {
  student?: number;
  student_id?: string;
  credentials?: { email: string; password: string | null; name: string }[];
  unlinked?: { email: string; name: string; reason: string }[];
}

/**
 * What «Marcar como inscrito» (and the older «Convertir en alumno») created:
 * the matrícula, a link to the student, each family login with its new
 * password ready to send by WhatsApp or email (shown once), and the tutors
 * that were not linked because their email belongs to another kind of account.
 */
export function CredentialsSummary({ result, phone }: { result: CredentialsResult; phone?: string }) {
  const settings = useSiteSettings();
  const credentials = result.credentials ?? [];
  const unlinked = result.unlinked ?? [];
  return (
    <div className="space-y-4">
      {result.student != null && (
        <p className="text-sm text-ink">
          Matrícula <strong>{result.student_id}</strong>.{' '}
          <Link to={`/admin/alumnos/${result.student}`} className="font-semibold text-purple underline">Abrir la ficha del alumno</Link>
        </p>
      )}
      {credentials.length > 0 && (
        <ul className="space-y-3" aria-label="Cuentas de familia">
          {credentials.map((c) => {
            const t = c.password
              ? credentialTemplate({ firstName: (c.name || '').split(' ')[0], email: c.email, password: c.password, supportEmail: settings.contact_email })
              : null;
            const wa = t ? whatsappDeliveryHref(phone, t) : null;
            return (
              <li key={c.email} className="rounded-md border border-line p-3 text-sm">
                <p className="font-semibold text-ink">{c.name || c.email}</p>
                {c.password && t ? (
                  <>
                    <p className="text-xs text-subtle">
                      Usuario {c.email} · contraseña <code className="select-all rounded-sm bg-cream-2 px-1">{c.password}</code>
                    </p>
                    <p className="mt-1 text-xs text-muted">La contraseña se muestra solo esta vez. Envíela ahora a la familia.</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {wa && (
                        <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm min-h-[44px] text-xs">
                          <MessageCircle size={14} aria-hidden="true" /> Enviar por WhatsApp
                        </a>
                      )}
                      <a href={mailtoDeliveryHref(c.email, t)} className="btn-outline btn-sm min-h-[44px] text-xs">
                        <Mail size={14} aria-hidden="true" /> Enviar por correo
                      </a>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-subtle">Ya tenía cuenta ({c.email}); se vinculó al alumno.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {unlinked.length > 0 && (
        <div className="rounded-md border border-coral/30 bg-coral-50/50 p-3 text-sm" role="alert">
          <p className="font-semibold text-coral-dark">Tutores no vinculados</p>
          <ul className="mt-1 space-y-1 text-xs text-ink" aria-label="Tutores no vinculados">
            {unlinked.map((u) => (
              <li key={u.email}><strong>{u.name || u.email}</strong> ({u.email}): {u.reason}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default CredentialsSummary;
