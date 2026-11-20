/**
 * The generic «Tabla» block (docs/cms/price-tables.md): its value shape,
 * limits, cell formats and the TSV reader used when an editor pastes cells
 * copied from Excel or Google Sheets. Shared by the renderer (./TableBlock,
 * generic-blocks chunk), the grid editor (cms/editor/TableField) and tests.
 * The backend enforces the same limits (content/table_block.py, read from
 * block_manifest.json).
 */
import { formatPrice } from '@/lib/format';

export type CellFormat = 'text' | 'money' | 'number' | 'percent';
export type CellAlign = 'left' | 'center' | 'right';

export interface TableColumn { label: string; align?: CellAlign; format?: CellFormat }
export interface TableValue { columns: TableColumn[]; rows: string[][]; highlight?: number | null }

export const TABLE_LIMITS = { columns: 8, rows: 60, cell: 300 } as const;

export const FORMAT_OPTIONS: { value: CellFormat; label: string }[] = [
  { value: 'text', label: 'Texto' },
  { value: 'money', label: 'Dinero (MXN)' },
  { value: 'number', label: 'Número' },
  { value: 'percent', label: 'Porcentaje' },
];
export const ALIGN_OPTIONS: { value: CellAlign; label: string }[] = [
  { value: 'left', label: 'Izquierda' },
  { value: 'center', label: 'Centro' },
  { value: 'right', label: 'Derecha' },
];

/** A table a new block starts with: two columns and one example row. */
export const emptyTable = (): TableValue => ({
  columns: [{ label: 'Concepto', align: 'left', format: 'text' }, { label: 'Monto', align: 'right', format: 'money' }],
  rows: [['', '']],
  highlight: null,
});

const asText = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/** Any stored prop → a well-formed table within the limits (the renderer never trusts the draft). */
export function normalizeTable(value: unknown): TableValue {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<TableValue>;
  const columns = (Array.isArray(v.columns) ? v.columns : []).slice(0, TABLE_LIMITS.columns).map((c) => {
    const col = (c && typeof c === 'object' ? c : {}) as Partial<TableColumn>;
    const align = ALIGN_OPTIONS.some((o) => o.value === col.align) ? col.align : undefined;
    const format = FORMAT_OPTIONS.some((o) => o.value === col.format) ? col.format : 'text';
    return { label: asText(col.label).slice(0, TABLE_LIMITS.cell), align, format } as TableColumn;
  });
  const width = columns.length;
  const rows = (Array.isArray(v.rows) ? v.rows : []).slice(0, TABLE_LIMITS.rows).map((r) => {
    const cells = (Array.isArray(r) ? r : []).slice(0, width).map((c) => asText(c).slice(0, TABLE_LIMITS.cell));
    while (cells.length < width) cells.push('');
    return cells;
  });
  const h = typeof v.highlight === 'number' && v.highlight >= 0 && v.highlight < rows.length ? v.highlight : null;
  return { columns, rows, highlight: h };
}

/** Numbers as people type them: «$6,450.50», «6450», «5 %», «-3». */
export function parseCellNumber(text: string): number | null {
  const clean = text.replace(/[$\s,%]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(clean)) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

const NUMBER = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 });

/** What a cell shows: money as «$6,450.00», numbers with thousands, «5%». Text that is not a number shows as typed. */
export function formatCell(text: string, format: CellFormat | undefined): string {
  if (!format || format === 'text') return text;
  const n = parseCellNumber(text);
  if (n === null) return text;
  if (format === 'money') return formatPrice(n);
  if (format === 'percent') return `${NUMBER.format(n)}%`;
  return NUMBER.format(n);
}

/** The default alignment of a column: figures to the right, text to the left. */
export const alignOf = (c: TableColumn): CellAlign => c.align ?? (c.format && c.format !== 'text' ? 'right' : 'left');

/**
 * Cells copied from Excel or Google Sheets (tab-separated, one line per row;
 * a cell with a tab, a newline or a quote comes quoted, with "" for a quote).
 */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim()));
}

/** True when pasted text is more than one cell (a tab or a line break). */
export const isMultiCell = (text: string) => /[\t\n]/.test(text.replace(/\r?\n$/, ''));

/**
 * Writes a pasted block into the table at (row, col): extends rows and
 * columns up to the limits; `row = -1` means the header row (labels).
 * Returns the new table and how many pasted cells did not fit.
 */
export function pasteBlock(
  table: TableValue, at: { row: number; col: number }, block: string[][], limits: { columns: number; rows: number; cell: number } = TABLE_LIMITS,
): { table: TableValue; dropped: number } {
  const columns = table.columns.map((c) => ({ ...c }));
  const rows = table.rows.map((r) => r.slice());
  let dropped = 0;
  block.forEach((line, i) => {
    const r = at.row + i;
    line.forEach((value, j) => {
      const c = at.col + j;
      if (c >= limits.columns) { dropped += 1; return; }
      while (columns.length <= c) {
        columns.push({ label: '', align: undefined, format: 'text' });
        rows.forEach((cells) => cells.push(''));
      }
      if (r === -1) { columns[c].label = value.slice(0, limits.cell); return; }
      if (r >= limits.rows) { dropped += 1; return; }
      while (rows.length <= r) rows.push(columns.map(() => ''));
      rows[r][c] = value.slice(0, limits.cell);
    });
  });
  return { table: { ...table, columns, rows }, dropped };
}
