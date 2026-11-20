import { TemplatePage } from '@/cms/TemplatePage';
import visita from '@/cms/sections/visita';

/** Agendar visita: designed sections, editable in Contenido (cms/sections/visita.tsx). */
export default function BookVisitPage() {
  return <TemplatePage template={visita.templates[0]} />;
}
