import { useCallback, useEffect, useRef } from 'react';

const PREFIX = 'draft:';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Persist a long public form's values in localStorage so a family who leaves
 * mid-form (phone call, app switch on mobile) does not start over (BACKLOG P1-I2).
 * Never stores files; callers pass only serializable text fields. Cleared on submit.
 */
export function useDraft<T extends object>(key: string) {
  const storageKey = PREFIX + key;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback((): Partial<T> | null => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const { at, data } = JSON.parse(raw) as { at: number; data: Partial<T> };
      if (Date.now() - at > TTL_MS) { localStorage.removeItem(storageKey); return null; }
      return data;
    } catch { return null; }
  }, [storageKey]);

  const save = useCallback((data: Partial<T>) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try { localStorage.setItem(storageKey, JSON.stringify({ at: Date.now(), data })); } catch { /* quota/private */ }
    }, 400);
  }, [storageKey]);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
  }, [storageKey]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { load, save, clear };
}
