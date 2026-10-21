import { TemplatePage } from '@/cms/TemplatePage';
import calendario from '@/cms/sections/calendario';

/** /calendario: designed sections, editable in Contenido (cms/sections/calendario.tsx). */
export default function CalendarioPage() {
  return <TemplatePage template={calendario.templates[0]} />;
}
