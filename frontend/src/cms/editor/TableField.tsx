/**
 * Grid editor of the «Tabla» block (docs/cms/price-tables.md): headers and
 * cells edited in place like a spreadsheet (Tab, Enter, arrows), rows and
 * columns added, removed and reordered, one row highlighted, and cells
 * pasted straight from Excel or Google Sheets (TSV). Each column picks its
 * format (texto, dinero MXN, número, porcentaje) and alignment.
 */
import { useId, useState, type ClipboardEvent } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Plus, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  ALIGN_OPTIONS, FORMAT_OPTIONS, TABLE_LIMITS, isMultiCell, normalizeTable, parseTsv, pasteBlock,
  type CellAlign, type CellFormat, type TableValue,
} from '../blocks/table';
import type { FieldSpec } from '../blocks/registry';
import { gridKeyDown } from './gridNav';

const CELL = 'block w-full min-w-[7rem] rounded-md border border-line bg-white px-2 py-1.5 text-base text-ink focus:border-purple focus:outline-none focus:ring-2 focus:ring-purple/20 sm:text-sm';
const ICON_BTN = 'inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-cream hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:opacity-40 sm:h-8 sm:w-8';

const swap = <T,>(list: T[], i: number, j: number): T[] => {
  if (j < 0 || j >= list.length) return list;
  const next = list.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

export function TableField({ spec, value, onChange }: { spec: FieldSpec; value: unknown; onChange: (v: TableValue) => void }) {
  const id = useId();
  const limits = spec.limits ?? TABLE_LIMITS;
  const table = normalizeTable(value);
  const { columns, rows } = table;
  const highlight = table.highlight ?? null;
  const [notice, setNotice] = useState('');
  const set = (patch: Partial<TableValue>) => onChange({ ...table, ...patch });
  const colName = (i: number) => columns[i]?.label.trim() || `columna ${i + 1}`;

  const setCell = (r: number, c: number, v: string) =>
    set({ rows: rows.map((cells, i) => (i === r ? cells.map((x, j) => (j === c ? v.slice(0, limits.cell) : x)) : cells)) });
  const setColumn = (c: number, patch: Partial<TableValue['columns'][number]>) =>
    set({ columns: columns.map((col, i) => (i === c ? { ...col, ...patch } : col)) });

  const addRow = () => set({ rows: [...rows, columns.map(() => '')] });
  const addColumn = () => set({ columns: [...columns, { label: '', format: 'text' }], rows: rows.map((cells) => [...cells, '']) });
  const removeRow = (r: number) => set({
    rows: rows.filter((_, i) => i !== r),
    highlight: highlight === r ? null : highlight !== null && highlight > r ? highlight - 1 : highlight,
  });
  const moveRow = (r: number, d: -1 | 1) => {
    const to = r + d;
    if (to < 0 || to >= rows.length) return;
    set({ rows: swap(rows, r, to), highlight: highlight === r ? to : highlight === to ? r : highlight });
  };
  const removeColumn = (c: number) => set({ columns: columns.filter((_, i) => i !== c), rows: rows.map((cells) => cells.filter((_, i) => i !== c)) });
  const moveColumn = (c: number, d: -1 | 1) => {
    const to = c + d;
    if (to < 0 || to >= columns.length) return;
    set({ columns: swap(columns, c, to), rows: rows.map((cells) => swap(cells, c, to)) });
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    const row = Number(el.dataset?.row);
    const col = Number(el.dataset?.col);
    const text = e.clipboardData.getData('text/plain');
    if (!Number.isInteger(row) || !Number.isInteger(col) || !isMultiCell(text)) return;
    e.preventDefault();
    const block = parseTsv(text);
    const { table: next, dropped } = pasteBlock(table, { row, col }, block, limits);
    onChange(next);
    const cells = block.reduce((n, line) => n + line.length, 0) - dropped;
    setNotice(dropped
      ? `Se pegaron ${cells} celdas; ${dropped} no cupieron (máximo ${limits.columns} columnas y ${limits.rows} filas).`
      : `Se pegaron ${cells} celdas.`);
  };

  return (
    <fieldset className="space-y-3 rounded-xl border border-line p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-subtle">{spec.label}{spec.required ? ' *' : ''}</legend>
      <p id={`${id}-help`} className="text-xs text-subtle">
        Escriba en las celdas o pegue celdas copiadas de Excel o Google Sheets; en la fila de encabezados se pegan también los títulos.
        Enter y las flechas mueven entre celdas; Alt + ↑ / ↓ mueve la fila.
      </p>
      {/* Keys and paste bubble up from the cell inputs (the inputs are the interactive elements). */}
      <div role="presentation" className="overflow-x-auto rounded-lg border border-line" onKeyDown={(e) => gridKeyDown(e, { onMoveRow: moveRow })} onPaste={onPaste}>
        <table className="w-full border-collapse text-sm" aria-describedby={`${id}-help`}>
          <caption className="sr-only">Contenido de la tabla</caption>
          <thead className="bg-cream-2">
            <tr>
              <th scope="col" className="w-10 px-1 text-xs font-semibold text-subtle">#</th>
              {columns.map((c, i) => (
                <th key={i} scope="col" className="p-1 align-bottom">
                  <input
                    className={`${CELL} font-semibold`}
                    value={c.label}
                    placeholder={`Columna ${i + 1}`}
                    aria-label={`Encabezado de la columna ${i + 1}`}
                    data-row={-1}
                    data-col={i}
                    maxLength={limits.cell}
                    onChange={(e) => setColumn(i, { label: e.target.value })}
                  />
                </th>
              ))}
              <th scope="col" className="px-1 text-left text-xs font-semibold text-subtle"><span className="sr-only">Acciones de la fila</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, r) => (
              <tr key={r} className={`border-t border-line ${highlight === r ? 'bg-green-50' : ''}`}>
                <th scope="row" className="px-1 text-center text-xs font-semibold text-subtle">{r + 1}</th>
                {cells.map((cell, c) => (
                  <td key={c} className="p-1">
                    <input
                      className={`${CELL} ${columns[c]?.format && columns[c].format !== 'text' ? 'text-right tabular-nums' : ''}`}
                      value={cell}
                      aria-label={`Fila ${r + 1}, ${colName(c)}`}
                      data-row={r}
                      data-col={c}
                      maxLength={limits.cell}
                      onChange={(e) => setCell(r, c, e.target.value)}
                    />
                  </td>
                ))}
                <td className="whitespace-nowrap p-1">
                  <div className="flex items-center">
                    <button type="button" className={`${ICON_BTN} ${highlight === r ? 'text-green-700' : ''}`} aria-pressed={highlight === r} aria-label={`Destacar la fila ${r + 1}`} title="Destacar" onClick={() => set({ highlight: highlight === r ? null : r })}>
                      <Star className="h-4 w-4" fill={highlight === r ? 'currentColor' : 'none'} aria-hidden="true" />
                    </button>
                    <button type="button" className={ICON_BTN} aria-label={`Subir la fila ${r + 1}`} disabled={r === 0} onClick={() => moveRow(r, -1)}><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
                    <button type="button" className={ICON_BTN} aria-label={`Bajar la fila ${r + 1}`} disabled={r === rows.length - 1} onClick={() => moveRow(r, 1)}><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
                    <button type="button" className={ICON_BTN} aria-label={`Quitar la fila ${r + 1}`} onClick={() => removeRow(r)}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="text-sm text-muted">La tabla no tiene filas. Agregue una o pegue celdas en los encabezados.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={addRow} disabled={rows.length >= limits.rows}><Plus className="h-4 w-4" aria-hidden="true" /> Fila</Button>
        <Button type="button" size="sm" variant="secondary" onClick={addColumn} disabled={columns.length >= limits.columns}><Plus className="h-4 w-4" aria-hidden="true" /> Columna</Button>
        <span className="text-xs text-subtle">{columns.length} de {limits.columns} columnas · {rows.length} de {limits.rows} filas</span>
      </div>
      {notice && <p role="status" className="text-xs text-green-700">{notice}</p>}

      <details className="rounded-lg bg-cream-2 p-3" open={columns.length <= 3}>
        <summary className="cursor-pointer text-xs font-semibold text-subtle">Columnas: formato y alineación</summary>
        <ul className="mt-3 space-y-3">
          {columns.map((c, i) => (
            <li key={i} className="rounded-lg bg-white p-2">
              <p className="mb-2 truncate text-sm font-semibold text-ink">{i + 1}. {c.label || 'Sin título'}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-muted">
                  Formato
                  <select className="input-field mt-1" value={c.format ?? 'text'} onChange={(e) => setColumn(i, { format: e.target.value as CellFormat })}>
                    {FORMAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <label className="text-xs text-muted">
                  Alineación
                  <select className="input-field mt-1" value={c.align ?? ''} onChange={(e) => setColumn(i, { align: (e.target.value || undefined) as CellAlign | undefined })}>
                    <option value="">Automática</option>
                    {ALIGN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="mt-1 flex justify-end">
                <button type="button" className={ICON_BTN} aria-label={`Mover la columna ${i + 1} a la izquierda`} disabled={i === 0} onClick={() => moveColumn(i, -1)}><ArrowLeft className="h-4 w-4" aria-hidden="true" /></button>
                <button type="button" className={ICON_BTN} aria-label={`Mover la columna ${i + 1} a la derecha`} disabled={i === columns.length - 1} onClick={() => moveColumn(i, 1)}><ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
                <button type="button" className={ICON_BTN} aria-label={`Quitar la columna ${i + 1}`} disabled={columns.length === 1} onClick={() => removeColumn(i)}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-subtle">Dinero muestra «$6,450.00»; Número, «1,250»; Porcentaje, «5%». Un texto como «Sin costo» se muestra tal cual.</p>
      </details>
    </fieldset>
  );
}

export default TableField;
