import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDebouncedValue } from './useDebouncedValue';

/**
 * URL-synced list filters (Admin console v2): search/filter/page state lives in
 * the query string so a filtered view is shareable and survives refresh.
 *
 * - `get(key)` reads a param; `set({...})` writes several at once (empty/null
 *   values are removed so defaults keep clean URLs). Writes use `replace` so
 *   filter churn doesn't pollute the history stack.
 * - `useUrlSyncedSearch` pairs a controlled input with a debounced (300 ms)
 *   URL write, so the URL doesn't churn per keystroke, and reflects external
 *   URL changes (back/forward, shared link) back into the input.
 */
export function useUrlFilters() {
  const [params, setParams] = useSearchParams();

  const set = useCallback(
    (updates: Record<string, string | null>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(updates)) {
            if (value === null || value === '') next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const get = useCallback((key: string, fallback = '') => params.get(key) ?? fallback, [params]);

  return { params, get, set };
}

/** 1-based page number synced to `?page=` (omitted when 1). */
export function useUrlPage(): [number, (page: number) => void] {
  const { get, set } = useUrlFilters();
  const raw = parseInt(get('page'), 10);
  const page = Number.isFinite(raw) && raw > 1 ? raw : 1;
  const setPage = useCallback(
    (next: number) => set({ page: next > 1 ? String(next) : null }),
    [set],
  );
  return [page, setPage];
}

/**
 * Search input two-way synced to a URL param, debounced 300 ms.
 * Returns the immediate input value (for the field), its setter, and the
 * debounced value (for query keys). Writing the search resets `?page=`.
 */
export function useUrlSyncedSearch(key = 'q', delay = 300) {
  const { get, set } = useUrlFilters();
  const urlValue = get(key);
  const [input, setInput] = useState(urlValue);
  const debounced = useDebouncedValue(input.trim(), delay);
  const lastPushed = useRef(urlValue);

  // Input → URL (debounced): a new search always starts from page 1.
  useEffect(() => {
    if (debounced !== lastPushed.current) {
      lastPushed.current = debounced;
      set({ [key]: debounced || null, page: null });
    }
  }, [debounced, key, set]);

  // URL → input (back/forward or a shared link changed the param externally).
  useEffect(() => {
    if (urlValue !== lastPushed.current) {
      lastPushed.current = urlValue;
      setInput(urlValue);
    }
  }, [urlValue]);

  return { input, setInput, search: debounced };
}
