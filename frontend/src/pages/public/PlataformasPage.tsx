import { TemplatePage } from '@/cms/TemplatePage';
import plataformas from '@/cms/sections/plataformas';

/**
 * El Colegio → Plataformas (bitácora 13/10/2026, ref. 6): las plataformas del
 * aula y de acompañamiento a padres. Designed sections, editable in Contenido
 * (cms/sections/plataformas.tsx).
 */
export default function PlataformasPage() {
  return <TemplatePage template={plataformas.templates[0]} />;
}
