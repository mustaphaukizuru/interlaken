import { useEffect, useState } from 'react';

/** Reactive media-query hook (SSR-safe: defaults to false). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => window.matchMedia?.(query).matches ?? false,
  );

  useEffect(() => {
    const mql = window.matchMedia?.(query);
    if (!mql) return;
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', onChange);
    setMatches(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export const useReducedMotion = () =>
  useMediaQuery('(prefers-reduced-motion: reduce)');

export const usePrefersDark = () =>
  useMediaQuery('(prefers-color-scheme: dark)');
