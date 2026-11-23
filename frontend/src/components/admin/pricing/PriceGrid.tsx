/**
 * One price table (or one group of it: Inscripción per modality) as a
 * spreadsheet on wide screens and as stacked row cards on phones. Cells edit in
 * place (Tab, Enter, arrows; Alt+↑/↓ moves the row), rows are added,
 * duplicated, deleted (the page confirms), reordered by dragging or with the
 * arrows, and shown or hidden on the site. A changed amount keeps its previous
 * figure under it («antes $6,450.00») until the change is saved.
 */
import { useRef, useState, type DragEvent } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Copy, GripVertical, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { focusCell, gridKeyDown } from '@/cms/editor/gridNav';
import { MoneyInput } from './MoneyInput';
import {
  emptyRow, estimatorWarning, newKey, previousValue, rowTitle,
  type ColDef, type EditRow, type GroupDef, type RowErrors, type TableDef,
} from './model';

const CELL = 'block w-full rounded-sm border bg-white px-2.5 py-2 text-base text-ink placeholder:text-subtle focus:outline-none focus:ring-2 sm:text-sm';
const ok = 'border-line focus:border-purple focus:ring-purple/20';
const bad = 'border-coral-600 focus:border-coral-600 focus:ring-coral-600/20';
const ICON_BTN = 'inline-flex h-11 w-11 items-center justify-center rounded-sm text-muted transition-colors hover:bg-cream hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:pointer-events-none disabled:opacity-30 md:h-9 md:w-9';

interface Props {
  def: TableDef;
  rows: EditRow[];
  before: EditRow[];
  errors: RowErrors;
  onChange: (rows: EditRow[]) => void;
  onDelete: (row: EditRow) => void;
  group?: GroupDef;
  wide: boolean;
  /** Policies: which ones the site highlights. */
  highlighted?: (text: string) => boolean;
}

function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onToggle}
      className="group inline-flex min-h-[44px] items-center gap-2 rounded-full text-sm text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 md:min-h-[36px]">
      <span className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${on ? 'bg-green-strong' : 'bg-line-2 ring-1 ring-inset ring-subtle/30'}`}>
        <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`} />
      </span>
      <span aria-hidden="true" className={on ? 'text-ink' : 'text-subtle'}>{on ? 'Visible' : 'Oculta'}</span>
    </button>
  );
}

export function PriceGrid({ def, rows, before, errors, onChange, onDelete, group, wide, highlighted }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const inGroup = (r: EditRow) => !group || !def.groupBy || r.values[def.groupBy.key] === group.value;
  const view = rows.filter(inGroup);
  const name = (i: number) => rowTitle(def, view[i]);
  const header = (c: ColDef) => (group && c.groupLabel?.[group.value]) || c.label;

  const patch = (key: string, p: Partial<EditRow> | ((r: EditRow) => EditRow)) =>
    onChange(rows.map((r) => (r._key === key ? (typeof p === 'function' ? p(r) : { ...r, ...p }) : r)));
  const setValue = (key: string, field: string, value: string) => patch(key, (r) => ({ ...r, values: { ...r.values, [field]: value } }));

  /** Moves view row i by delta inside its group (the full list keeps the other groups in place). */
  const move = (i: number, delta: -1 | 1) => {
    const a = view[i];
    const b = view[i + delta];
    if (!a || !b) return;
    const next = rows.slice();
    const ia = next.indexOf(a);
    const ib = next.indexOf(b);
    [next[ia], next[ib]] = [next[ib], next[ia]];
    onChange(next);
  };
  const moveTo = (fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    const from = rows.findIndex((r) => r._key === fromKey);
    const to = rows.findIndex((r) => r._key === toKey);
    if (from < 0 || to < 0) return;
    const next = rows.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };
  const duplicate = (row: EditRow) => {
    const copy: EditRow = { ...row, _key: newKey(), id: null, values: { ...row.values } };
    const at = rows.indexOf(row);
    onChange([...rows.slice(0, at + 1), copy, ...rows.slice(at + 1)]);
  };
  const add = () => {
    const row = emptyRow(def, group?.value);
    const lastOfGroup = view.length ? rows.indexOf(view[view.length - 1]) + 1 : rows.length;
    onChange([...rows.slice(0, lastOfGroup), row, ...rows.slice(lastOfGroup)]);
    requestAnimationFrame(() => root.current && focusCell(root.current, view.length, 0));
  };

  const drag = (row: EditRow) => ({
    onDragOver: (e: DragEvent) => { if (dragKey && dragKey !== row._key) { e.preventDefault(); setOverKey(row._key); } },
    onDragLeave: () => setOverKey((k) => (k === row._key ? null : k)),
    onDrop: (e: DragEvent) => { e.preventDefault(); if (dragKey) moveTo(dragKey, row._key); setDragKey(null); setOverKey(null); },
  });
  const grip = (row: EditRow) => (
    <span
      draggable
      onDragStart={(e) => { setDragKey(row._key); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', row._key); }}
      onDragEnd={() => { setDragKey(null); setOverKey(null); }}
      className="hidden cursor-grab items-center justify-center rounded-sm text-subtle hover:text-ink active:cursor-grabbing md:inline-flex md:h-9 md:w-6"
      title="Arrastre para mover la fila (o Alt + ↑ / ↓ desde una celda)"
      aria-hidden="true"
    >
      <GripVertical className="h-4 w-4" />
    </span>
  );

  const cell = (row: EditRow, i: number, c: ColDef, j: number, labelled: boolean) => {
    const id = `${def.key}-${row._key}-${c.key}`;
    const err = errors[row._key]?.[c.key];
    const prev = previousValue(def, before, row, c);
    const warn = c.key === def.estimatorField ? estimatorWarning(def, row) : null;
    const describedBy = [err && `${id}-err`, prev && `${id}-prev`, warn && `${id}-warn`].filter(Boolean).join(' ') || undefined;
    const common = {
      id,
      'data-row': i,
      'data-col': j,
      'aria-invalid': err ? true : undefined,
      'aria-describedby': describedBy,
      // The row's name joins the column's (the visible label is part of it): «Colegiatura mensual, Primaria».
      'aria-label': `${header(c)}, ${name(i)}`,
    };
    const value = row.values[c.key] ?? '';
    return (
      <>
        {labelled && <label htmlFor={id} className="label !mb-1 !text-xs">{header(c)}{c.required ? '' : ' (opcional)'}</label>}
        {c.kind === 'money' ? (
          <MoneyInput {...common} className={`${CELL} ${err ? bad : ok}`} value={value} placeholder={c.empty} onChange={(v) => setValue(row._key, c.key, v)} />
        ) : c.kind === 'textarea' ? (
          <textarea {...common} rows={wide ? 2 : 4} maxLength={(c.max ?? 600) + 50} className={`${CELL} ${err ? bad : ok} min-h-[44px] resize-y`} value={value} onChange={(e) => setValue(row._key, c.key, e.target.value)} />
        ) : (
          <input {...common} type="text" autoComplete="off" maxLength={(c.max ?? 120) + 20} className={`${CELL} ${err ? bad : ok}`} value={value} placeholder={c.required ? undefined : 'Opcional'} onChange={(e) => setValue(row._key, c.key, e.target.value)} />
        )}
        {err && <p id={`${id}-err`} className="mt-1 text-xs font-medium text-coral-700">{err}</p>}
        {prev !== null && <p id={`${id}-prev`} className="mt-1 text-[11px] text-subtle">antes <span className="line-through decoration-coral-600/60">{prev}</span></p>}
        {warn && !err && <p id={`${id}-warn`} className="mt-1 flex items-start gap-1 text-[11px] text-amber"><AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />{warn}</p>}
      </>
    );
  };

  const rowTools = (row: EditRow, i: number) => (
    <>
      <button type="button" className={ICON_BTN} aria-label={`Subir: ${name(i)}`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
      <button type="button" className={ICON_BTN} aria-label={`Bajar: ${name(i)}`} disabled={i === view.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
      <button type="button" className={ICON_BTN} aria-label={`Duplicar: ${name(i)}`} onClick={() => duplicate(row)}><Copy className="h-4 w-4" aria-hidden="true" /></button>
      <button type="button" className={`${ICON_BTN} hover:!bg-coral-50 hover:!text-coral-700`} aria-label={`Eliminar: ${name(i)}`} onClick={() => onDelete(row)}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
    </>
  );
  const badges = (row: EditRow) => (
    <>
      {!row.id && <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">Nueva</span>}
      {highlighted && highlighted(row.values.text ?? '') && <span className="rounded-full bg-amber/10 px-2 py-0.5 text-[11px] font-semibold text-amber" title="Se ve en negritas con el ícono ámbar">Destacada</span>}
    </>
  );

  const caption = `${def.title}${group ? `, ${group.label}` : ''}`;
  const empty = view.length === 0 && (
    <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
      No hay filas. {group ? `Sin filas aquí, la pestaña «${group.label}» no aparece en el sitio.` : 'Sin filas, esta tarjeta no aparece en el sitio.'}
    </p>
  );

  return (
    <div ref={root} className="space-y-3">
      {/* Keys bubble up from the cell inputs (the inputs are the interactive elements). */}
      <div role="presentation" onKeyDown={(e) => gridKeyDown(e, { onMoveRow: (r, d) => move(r, d) })}>
        {empty}
        {view.length > 0 && wide && (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">{caption}: celdas editables</caption>
              <thead className="bg-cream-2 text-left text-xs font-semibold text-muted">
                <tr>
                  <th scope="col" className="w-8 px-1 py-2.5"><span className="sr-only">Mover</span></th>
                  {def.cols.map((c) => (
                    <th key={c.key} scope="col" className={`px-2 py-2.5 ${c.kind === 'money' ? 'w-44 text-right' : ''} ${c.kind === 'textarea' ? 'min-w-[22rem]' : 'min-w-[9rem]'}`}>
                      {header(c)}{!c.required && <span className="font-normal text-subtle"> (opcional)</span>}
                    </th>
                  ))}
                  <th scope="col" className="w-28 px-2 py-2.5">En el sitio</th>
                  <th scope="col" className="w-40 px-2 py-2.5"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {view.map((row, i) => (
                  <tr key={row._key} {...drag(row)}
                    className={`border-t border-line align-top transition-colors ${!row.is_active ? 'bg-cream-2/70' : ''} ${!row.id ? 'shadow-[inset_3px_0_0_var(--green)]' : ''} ${overKey === row._key ? 'bg-green-50' : ''} ${dragKey === row._key ? 'opacity-50' : ''}`}>
                    <td className="px-1 py-2">{grip(row)}</td>
                    {def.cols.map((c, j) => <td key={c.key} className="px-2 py-2">{cell(row, i, c, j, false)}</td>)}
                    <td className="px-2 py-1.5">
                      <Switch on={row.is_active} onToggle={() => patch(row._key, { is_active: !row.is_active })} label={`Visible en el sitio: ${name(i)}`} />
                      <div className="mt-0.5 flex flex-wrap gap-1">{badges(row)}</div>
                    </td>
                    <td className="whitespace-nowrap px-1 py-1.5 text-right">{rowTools(row, i)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {view.length > 0 && !wide && (
          <ol className="space-y-3" aria-label={caption}>
            {view.map((row, i) => (
              <li key={row._key} className={`rounded-md border bg-white p-3 ${!row.id ? 'border-green/40' : 'border-line'} ${!row.is_active ? 'bg-cream-2' : ''}`}>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <p className="min-w-0 break-words font-head text-sm font-bold text-ink">
                    <span className="mr-1 text-subtle">{i + 1}.</span>{name(i)}
                  </p>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">{badges(row)}</div>
                </div>
                <div className="grid gap-3">
                  {def.cols.map((c, j) => <div key={c.key}>{cell(row, i, c, j, true)}</div>)}
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-1 border-t border-line pt-2">
                  <Switch on={row.is_active} onToggle={() => patch(row._key, { is_active: !row.is_active })} label={`Visible en el sitio: ${name(i)}`} />
                  <div className="flex">{rowTools(row, i)}</div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={add} disabled={rows.length >= 100}>
        <Plus className="h-4 w-4" aria-hidden="true" /> {def.addLabel}{group ? ` (${group.label.split(' (')[0].toLowerCase()})` : ''}
      </Button>
    </div>
  );
}

export default PriceGrid;
