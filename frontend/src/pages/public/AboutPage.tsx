import { TemplatePage } from '@/cms/TemplatePage';
import about from '@/cms/sections/about';

/** Nosotros: designed sections, editable in Contenido (cms/sections/about.tsx). */
export default function AboutPage() {
  return <TemplatePage template={about.templates[0]} />;
}
