import { TemplatePage } from '@/cms/TemplatePage';
import pagos from '@/cms/sections/pagos';

/**
 * Pagos → Colegiaturas y cafetería (bitácora 13/10/2026, ref. 6 y 7): los dos
 * accesos de pago para familias. Designed sections, editable in Contenido
 * (cms/sections/pagos.tsx).
 */
export default function PagosPage() {
  return <TemplatePage template={pagos.templates[0]} />;
}
