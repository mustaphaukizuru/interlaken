import { TemplatePage } from '@/cms/TemplatePage';
import facturacion from '@/cms/sections/facturacion';

/** Comunidad → Facturación: designed sections, editable in Contenido (cms/sections/facturacion.tsx). */
export default function FacturacionPage() {
  return <TemplatePage template={facturacion.templates[0]} />;
}
