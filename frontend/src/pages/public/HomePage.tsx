import { TemplatePage } from '@/cms/TemplatePage';
import home from '@/cms/sections/home';

/** Inicio: designed sections, editable in Contenido (cms/sections/home.tsx). */
export default function HomePage() {
  return <TemplatePage template={home.templates[0]} />;
}
