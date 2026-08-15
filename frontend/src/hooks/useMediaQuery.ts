import { useCallback, useSyncExternalStore } from 'react';

/**
 * Reactive media-query hook. A media query is an external store, so this uses
 * `useSyncExternalStore` (subscribe to `change`, snapshot from `matches`)
 * rather than mirroring it into local state from an effect.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia?.(query);
      if (!mql) return () => {};
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia?.(query).matches ?? false);
}

export const useReducedMotion = () =>
  useMediaQuery('(prefers-reduced-motion: reduce)');

export const usePrefersDark = () =>
  useMediaQuery('(prefers-color-scheme: dark)');
