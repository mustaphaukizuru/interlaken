/**
 * «Costos y precios» (/admin/costos): the six price tables as the console edits
 * them. Mirrors backend apps/content/pricing_admin.py (same fields, limits and
 * messages), so a problem shows next to the cell before anything is sent, and
 * computes the change list (old → new) for the summary and the import preview.
 * Pure functions; the screen lives in pages/admin/AdminPricing.tsx.
 */
import { formatMXN } from '@/lib/format';
import type { PricingRowData, PricingTableKey } from '@/services/pricingAdminApi';

export type ColKind = 'text' | 'textarea' | 'money';

export interface ColDef {
  key: string;
  label: string;
  kind: ColKind;
  required: boolean;
  max?: number;
  /** Shown in an empty optional cell («Sin tarifa mensual»). */
  empty?: string;
  /** Header per group, when the groups name the column differently (Inscripción / Reinscripción). */
  groupLabel?: Record<string, string>;
}

export interface GroupDef { value: string; label: string; hint: string }

export interface TableDef {
  key: PricingTableKey;
  tab: string;
  title: string;
  /** Where the table shows on the site, in the office's words. */
  where: string;
  cols: ColDef[];
  unique: string[];
  groupBy?: { key: string; groups: GroupDef[] };
  addLabel: string;
  /** The field the Admisiones estimator searches for a level name. */
  estimatorField?: string;
}

const text = (key: string, label: string, max: number, required = true): ColDef => ({ key, label, kind: 'text', required, max });
const money = (key: string, label: string, required = true, empty?: string): ColDef => ({ key, label, kind: 'money', required, empty });

export const MODALITIES: GroupDef[] = [
  { value: 'nuevo_ingreso', label: 'Nuevo ingreso', hint: 'Pestaña «Nuevo ingreso» de la página de Costos.' },
  { value: 'reinscripcion', label: 'Reinscripción (alumnos Interlaken)', hint: 'Pestaña «Alumnos Interlaken» de la página de Costos.' },
];

export const TABLES: TableDef[] = [
  {
    key: 'inscripcion', tab: 'Inscripción', title: 'Inscripción y reinscripción',
    where: 'Tarjeta «Inscripción y reinscripción» de Costos y el estimador de Admisiones.',
    cols: [
      text('section', 'Nivel', 60),
      money('gastos_administrativos', 'Gastos administrativos'),
      { ...money('cuota', 'Cuota'), groupLabel: { nuevo_ingreso: 'Inscripción', reinscripcion: 'Reinscripción' } },
    ],
    unique: ['section', 'modality'],
    groupBy: { key: 'modality', groups: MODALITIES },
    addLabel: 'Agregar nivel', estimatorField: 'section',
  },
  {
    key: 'colegiaturas', tab: 'Colegiaturas', title: 'Colegiaturas',
    where: 'Tarjeta «Colegiaturas» de Costos y el estimador de Admisiones.',
    cols: [text('section', 'Sección', 60), money('colegiatura', 'Colegiatura mensual')],
    unique: ['section'], addLabel: 'Agregar sección', estimatorField: 'section',
  },
  {
    key: 'seguros', tab: 'Seguros', title: 'Seguros y credenciales',
    where: 'Tarjeta «Seguros y credenciales» de Costos; el estimador suma los visibles.',
    cols: [text('name', 'Concepto', 80), money('cost', 'Costo anual')],
    unique: ['name'], addLabel: 'Agregar concepto',
  },
  {
    key: 'extraescolares', tab: 'Extraescolares', title: 'Extraescolares',
    where: 'Tarjeta «Extraescolares» de Costos.',
    cols: [text('name', 'Clase', 80), text('levels', 'Niveles', 120), money('annual_cost', 'Anualidad')],
    unique: ['name'], addLabel: 'Agregar clase',
  },
  {
    key: 'estancia', tab: 'Estancia', title: 'Estancia',
    where: 'Tarjeta «Estancia» de Costos.',
    cols: [
      text('schedule', 'Horario', 60), text('service', 'Servicio', 120), money('daily_cost', 'Costo diario'),
      money('monthly_cost', 'Costo mensual', false, 'Sin tarifa mensual'), text('monthly_note', 'Nota de la mensualidad', 120, false),
    ],
    unique: ['schedule', 'service'], addLabel: 'Agregar horario',
  },
  {
    key: 'politicas', tab: 'Políticas', title: 'Políticas de pago',
    where: 'Recuadro «Políticas de pago» de Costos.',
    cols: [{ key: 'text', label: 'Política', kind: 'textarea', required: true, max: 600 }],
    unique: [], addLabel: 'Agregar política',
  },
];

export const tableDef = (key: PricingTableKey): TableDef => TABLES.find((t) => t.key === key)!;

/* ── Rows in the editor ─────────────────────────────────────────────────── */

/** A row while it is edited: every value as the text in its cell. */
export interface EditRow { _key: string; id: number | null; is_active: boolean; values: Record<string, string> }

let seq = 0;
export const newKey = () => `r${Date.now().toString(36)}${(seq += 1)}`;

export function fromServer(def: TableDef, rows: PricingRowData[]): EditRow[] {
  const fields = [...def.cols.map((c) => c.key), ...(def.groupBy ? [def.groupBy.key] : [])];
  return rows.map((r) => ({
    _key: r.id ? `id${r.id}` : newKey(),
    id: r.id ?? null,
    is_active: r.is_active !== false,
    values: Object.fromEntries(fields.map((k) => [k, r[k] === null || r[k] === undefined ? '' : String(r[k])])),
  }));
}

export function emptyRow(def: TableDef, group?: string): EditRow {
  const values: Record<string, string> = Object.fromEntries(def.cols.map((c) => [c.key, '']));
  if (def.groupBy) values[def.groupBy.key] = group ?? def.groupBy.groups[0].value;
  return { _key: newKey(), id: null, is_active: true, values };
}

/** Grouped tables keep each group together, in group order (that is the order the API numbers them in). */
export function ordered(def: TableDef, rows: EditRow[]): EditRow[] {
  if (!def.groupBy) return rows;
  const { key, groups } = def.groupBy;
  return groups.flatMap((g) => rows.filter((r) => r.values[key] === g.value));
}

/* ── Money ──────────────────────────────────────────────────────────────── */

export const MAX_AMOUNT = 999999.99;

/** «$6,450.5», «6450», «6 450» → «6450.50»; same rules and messages as the API. */
export function parseMoney(input: string): { value: string | null; error?: string } {
  const raw = input.replace(/[$,\s]/g, '');
  if (!raw) return { value: null };
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    return { value: null, error: raw.startsWith('-') ? 'El monto no puede ser negativo.' : 'Escriba un monto, por ejemplo 6450.00.' };
  }
  const [, decimals = ''] = raw.split('.');
  if (decimals.length > 2) return { value: null, error: 'Use como máximo 2 decimales.' };
  const n = Number(raw);
  if (n > MAX_AMOUNT) return { value: null, error: 'El monto máximo es $999,999.99.' };
  return { value: n.toFixed(2) };
}

export const formatMoney = (v: string | null | undefined): string => (v ? formatMXN(v) : '');

/* ── Validation ─────────────────────────────────────────────────────────── */

export type RowErrors = Record<string, Record<string, string>>;

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export function validateRows(def: TableDef, rows: EditRow[]): RowErrors {
  const out: RowErrors = {};
  const add = (row: EditRow, key: string, msg: string) => { (out[row._key] ??= {})[key] ??= msg; };
  for (const row of rows) {
    for (const c of def.cols) {
      const v = (row.values[c.key] ?? '').trim();
      if (!v) { if (c.required) add(row, c.key, 'Este dato es obligatorio.'); continue; }
      if (c.kind === 'money') { const m = parseMoney(v); if (m.error) add(row, c.key, m.error); continue; }
      if (c.max && v.length > c.max) add(row, c.key, `Máximo ${c.max} caracteres.`);
      else if (/^[=@]/.test(v)) add(row, c.key, 'No puede empezar con «=» ni «@».');
    }
  }
  if (def.unique.length) {
    const seen = new Map<string, number>();
    ordered(def, rows).forEach((row, i) => {
      const parts = def.unique.map((k) => fold(row.values[k] ?? ''));
      if (parts.some((p) => !p)) return;
      const id = parts.join('|');
      const first = seen.get(id);
      if (first === undefined) seen.set(id, i);
      else add(row, def.unique[0], 'Repetido: ya hay otra fila con este valor.');
    });
  }
  return out;
}

export const countErrors = (errors: RowErrors) => Object.values(errors).reduce((n, e) => n + Object.keys(e).length, 0);

/** Level words the Admisiones estimator looks for in a row name (its default buttons). */
export const ESTIMATOR_LEVELS = ['Maternal', 'Preescolar', 'Primaria', 'Secundaria'];

/** A non-blocking note: the estimator will not find this row. */
export function estimatorWarning(def: TableDef, row: EditRow): string | null {
  if (!def.estimatorField) return null;
  const name = fold(row.values[def.estimatorField] ?? '');
  if (!name || ESTIMATOR_LEVELS.some((l) => name.includes(fold(l)))) return null;
  return 'El estimador de Admisiones no la mostrará: busca Maternal, Preescolar, Primaria o Secundaria en el nombre.';
}

/* ── Saving ─────────────────────────────────────────────────────────────── */

/** Rows as the API takes them (amounts with 2 decimals, empty optional amounts as null), in saving order. */
export function toPayload(def: TableDef, rows: EditRow[]): { rows: PricingRowData[]; keys: string[] } {
  const list = ordered(def, rows);
  return {
    keys: list.map((r) => r._key),
    rows: list.map((r) => {
      const out: PricingRowData = { id: r.id, is_active: r.is_active };
      if (def.groupBy) out[def.groupBy.key] = r.values[def.groupBy.key];
      for (const c of def.cols) {
        const v = (r.values[c.key] ?? '').trim();
        out[c.key] = c.kind === 'money' ? (parseMoney(v).value ?? (v ? v : null)) : v;
      }
      return out;
    }),
  };
}

/* ── Changes (old → new) ────────────────────────────────────────────────── */

export interface FieldChange { key: string; label: string; before: string; after: string }
export interface RowChange {
  kind: 'added' | 'removed' | 'changed';
  rowKey: string;
  title: string;
  group?: string;
  fields: FieldChange[];
  moved?: boolean;
  visibility?: 'shown' | 'hidden';
}

export const display = (c: ColDef, v: string): string => {
  const t = v.trim();
  if (c.kind === 'money') return t ? (parseMoney(t).value ? formatMoney(parseMoney(t).value) : t) : (c.empty ?? '(vacío)');
  return t || '(vacío)';
};

const same = (c: ColDef, a: string, b: string) => {
  if (c.kind === 'money') return (parseMoney(a).value ?? a.trim()) === (parseMoney(b).value ?? b.trim());
  return a.trim() === b.trim();
};

export function rowTitle(def: TableDef, row: EditRow): string {
  const first = def.cols[0];
  const name = (row.values[first.key] ?? '').trim();
  const label = name.length > 70 ? `${name.slice(0, 70)}…` : name;
  return label || 'Fila sin nombre';
}

const groupLabel = (def: TableDef, row: EditRow) =>
  def.groupBy?.groups.find((g) => g.value === row.values[def.groupBy!.key])?.label;

/** A column's name for this row: «Inscripción» or «Reinscripción» rather than «Cuota». */
export const colLabel = (def: TableDef, c: ColDef, row: EditRow) =>
  (def.groupBy && c.groupLabel?.[row.values[def.groupBy.key]]) || c.label;

/** Rows that changed position: those outside the longest run kept in the same relative order. */
function movedKeys(before: string[], after: string[]): Set<string> {
  const index = new Map(before.map((k, i) => [k, i]));
  const seqs = after.filter((k) => index.has(k)).map((k) => index.get(k)!);
  const keys = after.filter((k) => index.has(k));
  // Longest increasing subsequence (n ≤ 100): O(n²) is plenty.
  const len = seqs.map(() => 1);
  const prev = seqs.map(() => -1);
  for (let i = 0; i < seqs.length; i += 1) {
    for (let j = 0; j < i; j += 1) if (seqs[j] < seqs[i] && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
  }
  let best = len.indexOf(Math.max(0, ...len));
  const stay = new Set<string>();
  while (best >= 0) { stay.add(keys[best]); best = prev[best]; }
  return new Set(keys.filter((k) => !stay.has(k)));
}

export function diffRows(def: TableDef, before: EditRow[], after: EditRow[]): RowChange[] {
  const changes: RowChange[] = [];
  const old = new Map(before.filter((r) => r.id).map((r) => [r.id!, r]));
  const groups = def.groupBy ? def.groupBy.groups.map((g) => g.value) : [''];
  const moved = new Set<string>();
  for (const g of groups) {
    const inGroup = (r: EditRow) => !def.groupBy || r.values[def.groupBy.key] === g;
    const b = before.filter(inGroup).map((r) => `id${r.id}`);
    const a = after.filter((r) => r.id && inGroup(r)).map((r) => `id${r.id}`);
    movedKeys(b, a).forEach((k) => moved.add(k));
  }
  for (const row of after) {
    const prev = row.id ? old.get(row.id) : undefined;
    if (!prev) {
      changes.push({
        kind: 'added', rowKey: row._key, title: rowTitle(def, row), group: groupLabel(def, row),
        fields: def.cols.filter((c) => (row.values[c.key] ?? '').trim()).map((c) => ({ key: c.key, label: colLabel(def, c, row), before: '', after: display(c, row.values[c.key]) })),
        visibility: row.is_active ? undefined : 'hidden',
      });
      continue;
    }
    const fields = def.cols
      .filter((c) => !same(c, prev.values[c.key] ?? '', row.values[c.key] ?? ''))
      .map((c) => ({ key: c.key, label: colLabel(def, c, row), before: display(c, prev.values[c.key] ?? ''), after: display(c, row.values[c.key] ?? '') }));
    const regrouped = def.groupBy && prev.values[def.groupBy.key] !== row.values[def.groupBy.key];
    const visibility = prev.is_active === row.is_active ? undefined : row.is_active ? 'shown' : 'hidden';
    const isMoved = moved.has(`id${row.id}`) || !!regrouped;
    if (fields.length || visibility || isMoved) {
      changes.push({ kind: 'changed', rowKey: row._key, title: rowTitle(def, prev), group: groupLabel(def, row), fields, moved: isMoved || undefined, visibility });
    }
  }
  const kept = new Set(after.map((r) => r.id).filter(Boolean));
  for (const row of before) {
    if (row.id && !kept.has(row.id)) {
      changes.push({
        kind: 'removed', rowKey: row._key, title: rowTitle(def, row), group: groupLabel(def, row),
        fields: def.cols.filter((c) => c.kind === 'money' && (row.values[c.key] ?? '').trim()).map((c) => ({ key: c.key, label: colLabel(def, c, row), before: display(c, row.values[c.key]), after: '' })),
      });
    }
  }
  return changes;
}

/** A row's previous value of one cell, when it changed (the grid shows «antes $6,450.00»). */
export function previousValue(def: TableDef, before: EditRow[], row: EditRow, col: ColDef): string | null {
  if (!row.id) return null;
  const prev = before.find((r) => r.id === row.id);
  if (!prev || same(col, prev.values[col.key] ?? '', row.values[col.key] ?? '')) return null;
  return display(col, prev.values[col.key] ?? '');
}
