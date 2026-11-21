import { useQuery } from '@tanstack/react-query';
import { TemplatePage } from '@/cms/TemplatePage';
import documentacion from '@/cms/sections/documentacion';
import { publicRequiredDocsQuery } from '@/hooks/queries/requiredDocsPublic';

/** Admisiones → Documentación: designed sections, editable in Contenido (cms/sections/documentacion.tsx). */
export default function DocumentacionPage() {
  // The document list (Admisiones → Documentos requeridos) loads while the CMS
  // lookup runs, so the list section rarely paints its placeholder.
  useQuery(publicRequiredDocsQuery);
  return <TemplatePage template={documentacion.templates[0]} />;
}
