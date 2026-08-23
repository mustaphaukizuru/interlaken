/**
 * credentialTemplates.ts — the message an admin sends a family with a new
 * password (BACKLOG P1-A5). Mirrors backend `delivery_templates()` so the
 * reset dialog and the request inbox produce the same text.
 */
import { waHref } from './siteContact';

export interface CredentialTemplate {
  whatsapp_text: string;
  email_subject: string;
  email_body: string;
}

export function credentialTemplate(opts: {
  firstName?: string; email: string; password: string; supportEmail: string; origin?: string;
}): CredentialTemplate {
  const name = opts.firstName?.trim() || 'familia';
  const origin = opts.origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  const body =
    `Hola ${name}, le compartimos su acceso al Portal de Familias del Colegio Interlaken.\n\n` +
    `Usuario: ${opts.email}\n` +
    `Contraseña: ${opts.password}\n` +
    `Ingrese en: ${origin}/login\n\n` +
    'Guarde esta contraseña: por seguridad no se puede cambiar desde el portal. ' +
    `Si la olvida, solicítela de nuevo por WhatsApp o a ${opts.supportEmail}.\n\n` +
    'Colegio Interlaken';
  return { whatsapp_text: body, email_subject: 'Acceso al Portal de Familias - Colegio Interlaken', email_body: body };
}

/** wa.me link with the template prefilled; null when the family has no number. */
export function whatsappDeliveryHref(number: string | undefined, t: CredentialTemplate): string | null {
  return number?.replace(/\D/g, '') ? waHref(number, t.whatsapp_text) : null;
}

export function mailtoDeliveryHref(email: string, t: CredentialTemplate): string {
  return `mailto:${email}?subject=${encodeURIComponent(t.email_subject)}&body=${encodeURIComponent(t.email_body)}`;
}
