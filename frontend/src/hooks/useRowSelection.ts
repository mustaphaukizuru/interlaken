import { useCallback, useMemo, useState } from 'react';

export type RowKey = string | number;

/**
 * What a DataTable needs to render selection (C6). `useRowSelection` returns
 * a superset, so a page can pass the hook result straight to `selection`.
 */
export interface DataTableSelection {
  /** Keys picked on the pages the person visited. */
  selected: Set<RowKey>;
  onChange: (next: Set<RowKey>) => void;
  /** Total rows matching the current filters (DRF `count`). */
  allMatchingCount?: number;
  /** "Seleccionar las N que coinciden" is on: the server resolves the ids from the filters. */
  allMatching?: boolean;
  onSelectAllMatching?: () => void;
  onClear?: () => void;
}

export interface RowSelection extends DataTableSelection {
  allMatchingCount: number;
  allMatching: boolean;
  onSelectAllMatching: () => void;
  onClear: () => void;
  /** Effective count for the bulk bar: the match count while `allMatching`, else `selected.size`. */
  count: number;
  isSelected: (key: RowKey) => boolean;
  toggle: (key: RowKey) => void;
  /** Select (or clear) every key of the current page. */
  setPage: (keys: RowKey[], on: boolean) => void;
  /** Selected keys as an array (for `ids` in bulk and export calls). */
  ids: RowKey[];
}

/**
 * Selection state for a paginated admin list (C5/C6). Selection survives
 * paging within one filtered view; it is forgotten whenever `resetOn` changes
 * (pass the filter params), because "select all matching" refers to the
 * filters that were active when it was pressed.
 */
export function useRowSelection(allMatchingCount = 0, resetOn?: unknown): RowSelection {
  const [selected, setSelected] = useState<Set<RowKey>>(() => new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [seenReset, setSeenReset] = useState(resetOn);

  // Filters changed: forget the selection during render, the React-sanctioned
  // way to derive state from props without an effect.
  if (resetOn !== seenReset) {
    setSeenReset(resetOn);
    if (selected.size || allMatching) {
      setSelected(new Set());
      setAllMatching(false);
    }
  }

  const isSelected = useCallback((key: RowKey) => selected.has(key), [selected]);
  const toggle = useCallback((key: RowKey) => {
    setAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const setPage = useCallback((keys: RowKey[], on: boolean) => {
    setAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }, []);
  const onChange = useCallback((next: Set<RowKey>) => {
    setAllMatching(false);
    setSelected(new Set(next));
  }, []);
  const onSelectAllMatching = useCallback(() => setAllMatching(true), []);
  const onClear = useCallback(() => {
    setSelected(new Set());
    setAllMatching(false);
  }, []);

  const count = allMatching ? allMatchingCount : selected.size;
  const ids = useMemo(() => Array.from(selected), [selected]);

  return useMemo(
    () => ({ selected, onChange, allMatchingCount, allMatching, onSelectAllMatching, onClear, count, isSelected, toggle, setPage, ids }),
    [selected, onChange, allMatchingCount, allMatching, onSelectAllMatching, onClear, count, isSelected, toggle, setPage, ids],
  );
}

export default useRowSelection;
