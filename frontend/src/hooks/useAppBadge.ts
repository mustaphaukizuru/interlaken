import { useEffect } from 'react';

/**
 * Mirror the unread count on the installed app icon (BACKLOG P4-9). No-op where
 * the Badging API is missing (Safari iOS < 16.4, Firefox).
 */
export function useAppBadge(count: number | undefined) {
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (!nav.setAppBadge) return;
    const n = count ?? 0;
    (n > 0 ? nav.setAppBadge(n) : nav.clearAppBadge?.() ?? Promise.resolve()).catch(() => undefined);
  }, [count]);
}
