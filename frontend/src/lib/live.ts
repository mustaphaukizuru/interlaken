/**
 * Query profile for screens that show money that moves while you look at it.
 *
 * The app's default is "fresh for 5 minutes, never poll". That was fine when
 * the backend itself only learned about a sale every 5 minutes. Since
 * 2026-09-16 Loyverse pushes each receipt and each POS recarga to the server
 * within seconds, so a 5-minute cache on the client became the slowest link:
 * a parent could watch their child buy lunch and see the old balance until
 * they reloaded.
 *
 * Polling is deliberately modest and stops in background tabs: the data is
 * small, the API is cheap, and 30 s is faster than anyone reads a receipt.
 */
export const LIVE = {
  staleTime: 15_000,
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true as const,
  refetchOnReconnect: true as const,
};

/** "hace un momento" / "hace 3 min" / "hace 2 h" for a live badge. */
export function agoLabel(updatedAt: number | undefined, now = Date.now()): string {
  if (!updatedAt) return '';
  const s = Math.max(0, Math.floor((now - updatedAt) / 1000));
  if (s < 45) return 'hace un momento';
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  return `hace ${h} h`;
}
