import { TemplatePage } from '@/cms/TemplatePage';
import preregistro from '@/cms/sections/preregistro';

/** Pre-registro: designed sections, editable in Contenido (cms/sections/preregistro.tsx). */
export default function PreRegisterPage() {
  return <TemplatePage template={preregistro.templates[0]} />;
}
