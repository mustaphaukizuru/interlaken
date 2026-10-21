import { TemplatePage } from '@/cms/TemplatePage';
import modelo from '@/cms/sections/modelo';

/** Modelo educativo: designed sections, editable in Contenido (cms/sections/modelo.tsx). */
export default function ModeloEducativoPage() {
  return <TemplatePage template={modelo.templates[0]} />;
}
