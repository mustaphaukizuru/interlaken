import { TemplatePage } from '@/cms/TemplatePage';
import aviso from '@/cms/sections/aviso';

// The parser lives with the locked notice section; re-exported for its test.
export { parseNotice } from '@/cms/sections/aviso';

/** /aviso-de-privacidad: designed sections, editable in Contenido (cms/sections/aviso.tsx). */
export default function AvisoPrivacidadPage() {
  return <TemplatePage template={aviso.templates[0]} />;
}
