import { useCallback, useRef } from 'react';

/**
 * One request at a time for actions that charge, move money or send
 * something. The button still shows its `loading` state (from the mutation),
 * but TanStack Query only flips `isPending` on the next tick, so two clicks
 * (or Enter twice) in a row could both get through before the re-render. This
 * lock is synchronous: while `run`'s promise is pending, further calls are
 * ignored.
 *
 *   const once = useSingleFlight();
 *   onClick={() => once(() => mutation.mutateAsync(vars))}
 *
 * A rejected promise is swallowed here (the mutation's own `onError` already
 * handled it); the lock opens again either way.
 */
export function useSingleFlight() {
  const inFlight = useRef(false);
  return useCallback((run: () => Promise<unknown> | void) => {
    if (inFlight.current) return;
    inFlight.current = true;
    let pending: Promise<unknown> | void;
    try {
      pending = run();
    } catch (err) {
      inFlight.current = false;
      throw err;
    }
    Promise.resolve(pending)
      .catch(() => undefined)
      .finally(() => { inFlight.current = false; });
  }, []);
}
