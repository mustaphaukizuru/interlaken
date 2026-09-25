import { ChevronDown, RotateCcw, Rows3, SlidersHorizontal } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import type { TablePrefsApi } from '@/hooks/useTablePrefs';

export interface ColumnControlOption {
  id: string;
  /** Text shown in the popover (the column header, or `Column.label`). */
  label: string;
  hideable: boolean;
}

interface Props {
  columns: ColumnControlOption[];
  prefs: TablePrefsApi;
  className?: string;
}

/**
 * Column visibility + density + reset for a DataTable (Data Ops round, C6).
 *
 * Two controls: a compact-rows toggle (one tap, the thing people flip most)
 * and a "Columnas" popover with one checkbox per hideable column and the
 * "Restablecer" escape hatch. State lives in `useTablePrefs`, so the choice
 * survives a reload per table.
 */
export function ColumnControls({ columns, prefs, className = '' }: Props) {
  const dense = prefs.density === 'dense';
  const hideable = columns.filter((c) => c.hideable);
  const hiddenCount = hideable.filter((c) => prefs.isHidden(c.id)).length;
  const iconBtn =
    'inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 sm:min-h-[36px]';

  return (
    <div className={`flex items-center gap-1 ${className}`.trim()} role="group" aria-label="Opciones de la tabla">
      <button
        type="button"
        aria-pressed={dense}
        aria-label="Vista compacta"
        title="Vista compacta"
        onClick={prefs.toggleDensity}
        className={`${iconBtn} ${dense ? 'bg-purple/10 text-purple' : 'text-subtle hover:bg-cream hover:text-ink'}`}
      >
        <Rows3 size={16} aria-hidden="true" />
      </button>
      <Dropdown
        width={260}
        trigger={({ open, toggle }) => (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-haspopup="true"
            className={`${iconBtn} ${hiddenCount ? 'text-purple' : 'text-muted hover:bg-cream hover:text-ink'}`}
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
            <span>Columnas</span>
            {hiddenCount > 0 && (
              <span className="rounded-full bg-purple/10 px-1.5 text-[11px] font-semibold text-purple" aria-label={`${hiddenCount} ocultas`}>
                {hiddenCount}
              </span>
            )}
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        )}
      >
        {() => (
          <div className="p-2">
            <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">Columnas visibles</p>
            <ul className="max-h-64 overflow-y-auto">
              {columns.map((c) => {
                const checked = !c.hideable || !prefs.isHidden(c.id);
                return (
                  <li key={c.id}>
                    <label className={`flex min-h-[40px] cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm text-ink hover:bg-cream-2 ${c.hideable ? '' : 'cursor-default opacity-60'}`}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-line text-purple focus:ring-purple/40"
                        checked={checked}
                        disabled={!c.hideable}
                        onChange={() => prefs.toggleColumn(c.id)}
                      />
                      <span className="truncate">{c.label}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="mt-2 border-t border-line pt-2">
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">Densidad</p>
              <div className="flex gap-1 px-1" role="group" aria-label="Densidad de filas">
                {(['normal', 'dense'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={prefs.density === d}
                    onClick={() => prefs.setDensity(d)}
                    className={`min-h-[36px] flex-1 rounded-lg px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 ${
                      prefs.density === d ? 'bg-purple text-white' : 'bg-cream-2 text-muted hover:text-ink'
                    }`}
                  >
                    {d === 'dense' ? 'Compacta' : 'Normal'}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-2 border-t border-line pt-2">
              <button
                type="button"
                onClick={prefs.reset}
                disabled={!prefs.dirty}
                className="flex min-h-[40px] w-full items-center gap-2 rounded-lg px-2 text-sm text-muted hover:bg-cream-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw size={14} aria-hidden="true" /> Restablecer
              </button>
            </div>
          </div>
        )}
      </Dropdown>
    </div>
  );
}

export default ColumnControls;
