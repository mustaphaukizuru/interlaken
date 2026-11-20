import { TemplatePage } from '@/cms/TemplatePage';
import acceso from '@/cms/sections/acceso';

/**
 * /login: the portal entry screen, editable in Contenido → Iniciar sesión
 * (cms/sections/acceso.tsx). The sign-in logic lives in that locked section,
 * unchanged; the page only adds its texts, photo and SEO from the CMS.
 */
export default function LoginPage() {
  return <TemplatePage template={acceso.templates[0]} />;
}
