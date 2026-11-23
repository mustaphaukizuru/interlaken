/**
 * Idempotency key for one deliberate action (a dialog opening, a preview):
 * a retry or a double click with the same key is applied once by the server.
 */
export function newRequestId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
