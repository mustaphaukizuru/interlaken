/**
 * Field kinds with editors of their own, rendered by BlockForm's fallback
 * branch so the generated form stays one switch:
 *
 * - `table`: the «Tabla» block's grid (./TableField);
 * - `action`: a button to a console screen, e.g. «Editar precios» on the
 *   Costos sections. It opens in a new tab, so the page draft (autosaved
 *   1.5 s after each change) stays open and nothing is lost. Staff without
 *   that screen read who edits it instead.
 */
import { ExternalLink } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import type { FieldSpec } from '../blocks/registry';
import type { TableValue } from '../blocks/table';
import { TableField } from './TableField';

function ActionField({ spec }: { spec: FieldSpec }) {
  const role = useAuthStore((s) => s.user?.role);
  return (
    <div className="space-y-2 rounded-xl border border-green/30 bg-green-50 p-3">
      {spec.hint && <p className="text-sm text-ink">{spec.hint}</p>}
      {role === 'admin' && spec.href ? (
        <>
          <a href={spec.href} target="_blank" rel="noopener noreferrer" className="btn-outline min-h-[44px] w-full gap-2 !px-4 !py-2 text-sm sm:w-auto">
            {spec.label} <ExternalLink size={15} aria-hidden="true" />
            <span className="sr-only">(se abre en otra pestaña)</span>
          </a>
          <p className="text-xs text-subtle">Se abre en otra pestaña: este borrador sigue aquí. Al volver, la vista previa muestra los precios nuevos.</p>
        </>
      ) : (
        <p className="text-xs text-subtle">Las cifras las cambia Dirección en «Costos y precios».</p>
      )}
    </div>
  );
}

export function CustomField({ spec, value, onChange }: { spec: FieldSpec; value: unknown; onChange: (v: unknown) => void }) {
  switch (spec.kind) {
    case 'table': return <TableField spec={spec} value={value} onChange={(v: TableValue) => onChange(v)} />;
    case 'action': return <ActionField spec={spec} />;
    default: return null;
  }
}

export default CustomField;
