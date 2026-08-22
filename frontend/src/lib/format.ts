/**
 * format.ts — the one place es-MX money/date formatting lives.
 * (BACKLOG P0-12: four identical MXN formatters were declared per page.)
 */

/** `1234.5` → `$1,234.50` (es-MX, MXN). */
export function formatMXN(v: string | number | null | undefined): string {
  return Number(v ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

/** Price-list variant: `null` means the concept has no cost. */
export function formatPrice(v: string | number | null): string {
  return v === null ? 'SIN COSTO' : formatMXN(v);
}
