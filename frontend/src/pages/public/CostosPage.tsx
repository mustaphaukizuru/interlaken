import { TemplatePage } from '@/cms/TemplatePage';
import costos from '@/cms/sections/costos';

/**
 * Admisiones → Costos: designed sections, editable in Contenido
 * (cms/sections/costos.tsx). Every figure comes from the /content/pricing/
 * bundle (Ajustes, Costos); the school cycle is computed automatically.
 */
export default function CostosPage() {
  return <TemplatePage template={costos.templates[0]} />;
}
