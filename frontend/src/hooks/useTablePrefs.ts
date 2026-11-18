import { useCallback, useMemo, useState } from 'react';

/**
 * Per-table view preferences (Data Ops round, C6): hidden columns, density
 * and resized widths, persisted in localStorage under `interlaken:table:<id>`.
 *
 * Replaces the roster-only prefs in `lib/rosterTable.ts`; the old
 * `interlaken:roster-prefs` key is migrated once into `interlaken:table:students`
 * (the id AdminStudents adopts in Phase 3) and left in place until that page
 * stops reading it.
 */
export type Density = 'normal' | 'dense';

export interface TablePrefs {
  hidden: string[];
  density: Density;
  widths: Record<string, number>;
}

export const TABLE_PREFS_PREFIX = 'interlaken:table:';
const LEGACY_ROSTER_KEY = 'interlaken:roster-prefs';
const LEGACY_ROSTER_TABLE_ID = 'students';

export const prefsKey = (tableId: string) => `${TABLE_PREFS_PREFIX}${tableId}`;

/**
 * Sidecar key: the default-hidden columns a stored entry was saved against.
 * Kept apart from the entry so the entry's shape (`{hidden, density, widths}`)
 * stays exactly what older builds read and write.
 */
export const TABLE_DEFAULTS_PREFIX = 'interlaken:table-defaults:';
export const defaultsKey = (tableId: string) => `${TABLE_DEFAULTS_PREFIX}${tableId}`;

/**
 * Default-hidden columns as they were BEFORE the 2026-11 column review, for
 * the tables whose defaults that review changed. Entries saved by older
 * builds carry no sidecar; this is what they were saved against, so a column
 * that only became default-hidden in the review is hidden for them too, while
 * a column they had already chosen to show stays shown.
 */
export const LEGACY_DEFAULT_HIDDEN: Readonly<Record<string, readonly string[]>> = {
  students: ['loyverse_code', 'email', 'enrollment_date'],
  staff: ['date_joined', 'has_password'],
  'cafeteria-balances': ['threshold'],
  'cafeteria-low-balance': [],
  'cafeteria-customers': [],
  payments: ['reference'],
  'booking-slots': [],
  'contact-messages': [],
  forms: ['updated'],
  'cms-pages': ['published'],
};

function safeRead(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota: prefs simply do not persist */
  }
}

function safeRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function normalize(raw: unknown, defaults: TablePrefs): TablePrefs | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Record<keyof TablePrefs, unknown>>;
  return {
    hidden: Array.isArray(r.hidden) ? r.hidden.filter((h): h is string => typeof h === 'string') : defaults.hidden,
    density: r.density === 'dense' ? 'dense' : r.density === 'normal' ? 'normal' : defaults.density,
    widths:
      r.widths && typeof r.widths === 'object'
        ? Object.fromEntries(
            Object.entries(r.widths as Record<string, unknown>).filter(
              (e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]) && e[1] > 0,
            ),
          )
        : defaults.widths,
  };
}

/**
 * One-time migration of the roster prefs (`{hidden, dense}`) into the new
 * shape. Runs lazily the first time the `students` table asks for its prefs
 * and only when nothing was stored under the new key yet.
 */
export function migrateLegacyRosterPrefs(): boolean {
  const target = prefsKey(LEGACY_ROSTER_TABLE_ID);
  if (safeRead(target)) return false;
  const legacy = safeRead(LEGACY_ROSTER_KEY) as { hidden?: unknown; dense?: unknown } | null;
  if (!legacy || typeof legacy !== 'object') return false;
  const hidden = Array.isArray(legacy.hidden) ? legacy.hidden.filter((h): h is string => typeof h === 'string') : [];
  safeWrite(target, { hidden, density: legacy.dense ? 'dense' : 'normal', widths: {} } satisfies TablePrefs);
  return true;
}

function readSavedDefaults(tableId: string): string[] | null {
  const raw = safeRead(defaultsKey(tableId));
  return Array.isArray(raw) ? raw.filter((h): h is string => typeof h === 'string') : null;
}

/**
 * Stored prefs merged with the current defaults.
 *
 * The stored `hidden` is the full hidden set at save time. Columns that became
 * default-hidden AFTER that save (not in the defaults it was saved against)
 * are added, so a new default reaches people who already customised the
 * table. Nothing is ever un-hidden and every explicit choice survives: a
 * column the person showed was in the old defaults, so it is not "new".
 */
export function readTablePrefs(tableId: string, defaults: TablePrefs): TablePrefs {
  if (tableId === LEGACY_ROSTER_TABLE_ID) migrateLegacyRosterPrefs();
  const stored = normalize(safeRead(prefsKey(tableId)), defaults);
  if (!stored) return defaults;
  const savedAgainst = readSavedDefaults(tableId) ?? LEGACY_DEFAULT_HIDDEN[tableId] ?? defaults.hidden;
  const added = defaults.hidden.filter((id) => !savedAgainst.includes(id) && !stored.hidden.includes(id));
  return added.length ? { ...stored, hidden: [...stored.hidden, ...added] } : stored;
}

export interface UseTablePrefsOptions {
  /** Columns hidden until the person chooses otherwise. */
  defaultHidden?: string[];
  defaultDensity?: Density;
}

export interface TablePrefsApi extends TablePrefs {
  hiddenSet: Set<string>;
  isHidden: (columnId: string) => boolean;
  toggleColumn: (columnId: string) => void;
  setColumnHidden: (columnId: string, hidden: boolean) => void;
  setDensity: (density: Density) => void;
  toggleDensity: () => void;
  setWidth: (columnId: string, width: number | null) => void;
  /** Back to the defaults and forget the stored entry. */
  reset: () => void;
  /** True when anything differs from the defaults. */
  dirty: boolean;
  /** False when no `tableId` was given: prefs live in memory for this mount only. */
  persisted: boolean;
}

/**
 * `useTablePrefs('payments', { defaultHidden: ['reference'] })`.
 * Without a `tableId` the hook still works (in-memory), so DataTable can call
 * it unconditionally.
 */
export function useTablePrefs(tableId: string | undefined, options: UseTablePrefsOptions = {}): TablePrefsApi {
  const { defaultHidden, defaultDensity } = options;
  // Options are usually inline literals; key on their serialized value so the
  // defaults object is referentially stable across renders.
  const hiddenKey = (defaultHidden ?? []).join('\u0000');
  const defaults = useMemo<TablePrefs>(
    () => ({ hidden: hiddenKey ? hiddenKey.split('\u0000') : [], density: defaultDensity ?? 'normal', widths: {} }),
    [hiddenKey, defaultDensity],
  );

  const [state, setState] = useState<TablePrefs>(() => (tableId ? readTablePrefs(tableId, defaults) : defaults));

  const commit = useCallback(
    (updater: (prev: TablePrefs) => TablePrefs) => {
      setState((prev) => {
        const next = updater(prev);
        if (tableId) {
          safeWrite(prefsKey(tableId), next);
          safeWrite(defaultsKey(tableId), defaults.hidden);
        }
        return next;
      });
    },
    [tableId, defaults],
  );

  const setColumnHidden = useCallback(
    (columnId: string, hidden: boolean) =>
      commit((p) => {
        const has = p.hidden.includes(columnId);
        if (hidden === has) return p;
        return { ...p, hidden: hidden ? [...p.hidden, columnId] : p.hidden.filter((h) => h !== columnId) };
      }),
    [commit],
  );
  const toggleColumn = useCallback(
    (columnId: string) => commit((p) => ({ ...p, hidden: p.hidden.includes(columnId) ? p.hidden.filter((h) => h !== columnId) : [...p.hidden, columnId] })),
    [commit],
  );
  const setDensity = useCallback((density: Density) => commit((p) => (p.density === density ? p : { ...p, density })), [commit]);
  const toggleDensity = useCallback(() => commit((p) => ({ ...p, density: p.density === 'dense' ? 'normal' : 'dense' })), [commit]);
  const setWidth = useCallback(
    (columnId: string, width: number | null) =>
      commit((p) => {
        const widths = { ...p.widths };
        if (width === null) delete widths[columnId];
        else widths[columnId] = Math.round(width);
        return { ...p, widths };
      }),
    [commit],
  );
  const reset = useCallback(() => {
    if (tableId) {
      safeRemove(prefsKey(tableId));
      safeRemove(defaultsKey(tableId));
    }
    setState(defaults);
  }, [tableId, defaults]);

  const hiddenSet = useMemo(() => new Set(state.hidden), [state.hidden]);
  const isHidden = useCallback((id: string) => hiddenSet.has(id), [hiddenSet]);
  const dirty =
    state.density !== defaults.density ||
    Object.keys(state.widths).length > 0 ||
    state.hidden.length !== defaults.hidden.length ||
    state.hidden.some((h) => !defaults.hidden.includes(h));

  return {
    ...state,
    hiddenSet,
    isHidden,
    toggleColumn,
    setColumnHidden,
    setDensity,
    toggleDensity,
    setWidth,
    reset,
    dirty,
    persisted: Boolean(tableId),
  };
}

export default useTablePrefs;
