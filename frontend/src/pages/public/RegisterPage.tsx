import { TemplatePage } from '@/cms/TemplatePage';
import inscripcion from '@/cms/sections/inscripcion';

/**
 * /inscripcion: the invitation wizard, editable in Contenido → Inscripción
 * (cms/sections/inscripcion.tsx). The wizard is a locked section with the
 * same steps, rules and single-use invitation exchange as before.
 */
export default function RegisterPage() {
  return <TemplatePage template={inscripcion.templates[0]} />;
}
