import { TemplatePage } from '@/cms/TemplatePage';
import documentos from '@/cms/sections/documentos';

/**
 * /inscripcion/documentos?rid=&token= — standalone document upload (BACKLOG P1-G4),
 * editable in Contenido → Documentos de inscripción (cms/sections/documentos.tsx).
 * The link is single-use (invite token → session); each required document shows
 * its review status and can be re-uploaded when rejected.
 */
export default function DocumentsUploadPage() {
  return <TemplatePage template={documentos.templates[0]} />;
}
