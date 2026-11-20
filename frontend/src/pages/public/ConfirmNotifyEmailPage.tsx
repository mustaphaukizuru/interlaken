import { TemplatePage } from '@/cms/TemplatePage';
import correo from '@/cms/sections/correo';

/**
 * /confirmar-correo?token=… — the page the «correo para avisos» email opens
 * (owner, 2026-11-08), editable in Contenido → Confirmar correo
 * (cms/sections/correo.tsx). Public: the signed token proves the mailbox and
 * names the account, so a parent confirms from their own phone without signing
 * in. Opening the page changes nothing; the button does (email scanners
 * pre-open links).
 */
export default function ConfirmNotifyEmailPage() {
  return <TemplatePage template={correo.templates[0]} />;
}
