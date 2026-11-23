import type { RowKey } from '@/hooks/useRowSelection';

/**
 * «Volver a la misma fila»: which record a person last opened from a list, so
 * the list can point at that row again when they come back (browser Back, a
 * «Volver» link, the breadcrumb, after saving on the detail page).
 *
 * One entry per list, keyed by the list's pathname plus its table id (one page
 * can hold several tables, e.g. Admisiones has cases and registrations), in
 * sessionStorage: it outlives the list unmounting while the detail route is
 * open, stays in this tab and dies with it. The list reads it once and clears
 * it, so the row is pointed at once. Search, filters and page live in the URL
 * (D20), so coming back lands on the same page of results.
 *
 * Storage can be missing or throw (private windows, blocked site data): every
 * access is guarded and the feature simply does nothing then.
 */

const PREFIX = 'interlaken:last-opened:';

/** Older memories are ignored: coming back half an hour later is not «coming back». */
export const LAST_OPENED_TTL_MS = 30 * 60 * 1000;

interface Entry { key: string; at: number }

/** The memory slot of one list: `pathname#listId`. Read at event time, not at render. */
export function lastOpenedScope(listId = 'tabla', pathname = window.location.pathname): string {
  return `${pathname}#${listId}`;
}

function read(scope: string): Entry | null {
  try {
    const raw = window.sessionStorage.getItem(PREFIX + scope);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Partial<Entry>;
    if (typeof entry?.key !== 'string' || typeof entry.at !== 'number') return null;
    return entry as Entry;
  } catch {
    return null;
  }
}

/** Remember that the record of `key` was opened from the list `scope`. */
export function rememberOpened(scope: string, key: RowKey): void {
  try {
    window.sessionStorage.setItem(PREFIX + scope, JSON.stringify({ key: String(key), at: Date.now() }));
  } catch {
    // No storage: nothing to point at later, which is fine.
  }
}

/** The remembered row key of `scope` (as a string), or null when none or expired. Does not clear it. */
export function peekOpened(scope: string): string | null {
  const entry = read(scope);
  if (!entry) return null;
  if (Date.now() - entry.at > LAST_OPENED_TTL_MS) return null;
  return entry.key;
}

/** Forget the memory of `scope`; with `key`, only when it still points at that row
 *  (a newer click on another row is left alone). */
export function forgetOpened(scope: string, key?: RowKey): void {
  try {
    if (key !== undefined && read(scope)?.key !== String(key)) return;
    window.sessionStorage.removeItem(PREFIX + scope);
  } catch {
    // No storage: nothing to forget.
  }
}
