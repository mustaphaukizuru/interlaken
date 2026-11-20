import { TemplatePage } from '@/cms/TemplatePage';
import documentacion from '@/cms/sections/documentacion';

/** Admisiones → Documentación: designed sections, editable in Contenido (cms/sections/documentacion.tsx). */
export default function DocumentacionPage() {
  return <TemplatePage template={documentacion.templates[0]} />;
}
