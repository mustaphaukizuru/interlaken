import { ArrowRight, EyeOff, Eye, MoveVertical, Plus, Trash2 } from 'lucide-react';
import type { RowChange, TableDef } from './model';

/** «1 cambio», «3 cambios». */
export const changesLabel = (n: number) => `${n} ${n === 1 ? 'cambio' : 'cambios'}`;

/**
 * Every change of one table, old → new, like corrections in a ledger: the old
 * figure struck through, the new one in ink. Used by the save summary and by
 * the import preview.
 */
export function ChangeList({ def, changes }: { def: TableDef; changes: RowChange[] }) {
  return (
    <section aria-labelledby={`chg-${def.key}`} className="rounded-xl border border-line">
      <h3 id={`chg-${def.key}`} className="flex items-baseline justify-between gap-3 border-b border-line bg-cream-2 px-4 py-2.5 font-head text-sm font-bold text-ink">
        {def.title}
        <span className="text-xs font-semibold text-subtle">{changesLabel(changes.length)}</span>
      </h3>
      <ul className="divide-y divide-line">
        {changes.map((c) => (
          <li key={`${c.kind}-${c.rowKey}`} className="px-4 py-3 text-sm">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {c.kind === 'added' && <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700"><Plus className="h-3 w-3" aria-hidden="true" />Nueva fila</span>}
              {c.kind === 'removed' && <span className="inline-flex items-center gap-1 rounded-full bg-coral-50 px-2 py-0.5 text-[11px] font-semibold text-coral-700"><Trash2 className="h-3 w-3" aria-hidden="true" />Se elimina</span>}
              <span className={`font-semibold ${c.kind === 'removed' ? 'text-coral-700 line-through decoration-coral-600/50' : 'text-ink'}`}>{c.title}</span>
              {c.group && <span className="text-xs text-subtle">· {c.group}</span>}
            </p>
            {c.fields.length > 0 && (
              <dl className="mt-1.5 grid gap-1">
                {c.fields.map((f) => (
                  <div key={f.key} className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 text-[13px] max-sm:grid-cols-1">
                    <dt className="text-muted">{f.label}</dt>
                    <dd className="flex flex-wrap items-center gap-x-2 tabular-nums">
                      {c.kind === 'changed' && (
                        <>
                          <span className="text-subtle line-through decoration-coral-600/50">{f.before}</span>
                          <ArrowRight className="h-3.5 w-3.5 text-subtle" aria-label="cambia a" />
                        </>
                      )}
                      <span className={c.kind === 'removed' ? 'text-subtle' : 'font-semibold text-ink'}>{c.kind === 'removed' ? f.before : f.after}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {(c.moved || c.visibility) && (
              <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
                {c.moved && <span className="inline-flex items-center gap-1"><MoveVertical className="h-3.5 w-3.5" aria-hidden="true" />Cambia de lugar</span>}
                {c.visibility === 'hidden' && <span className="inline-flex items-center gap-1"><EyeOff className="h-3.5 w-3.5" aria-hidden="true" />{c.kind === 'added' ? 'Oculta en el sitio' : 'Se oculta en el sitio'}</span>}
                {c.visibility === 'shown' && <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" aria-hidden="true" />Vuelve a verse en el sitio</span>}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default ChangeList;
