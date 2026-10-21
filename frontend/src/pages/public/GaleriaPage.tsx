import { TemplatePage } from '@/cms/TemplatePage';
import galeria from '@/cms/sections/galeria';

/** Galería: designed sections, editable in Contenido (cms/sections/galeria.tsx). */
export default function GaleriaPage() {
  return <TemplatePage template={galeria.templates[0]} />;
}
