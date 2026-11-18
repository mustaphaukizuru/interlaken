/**
 * tableFormat.ts — date formats of the console tables, once.
 *
 * Each page had its own: «18/11/2026», «18 nov 2026», «18 nov 2026, 14:05»,
 * «18 de nov 2026, 14:05». Tables now read one short form. Empty or invalid
 * input returns '' so DataTable shows its muted dash.
 *
 * Admin/portal only: never import this from a public page (the home budget).
 */
const SHORT: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };

/** A date-only value ('2026-11-18') is read at noon so no timezone moves it a day. */
function parse(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** «18 nov 2026» */
export function shortDate(value: string | null | undefined): string {
  const d = parse(value);
  return d ? d.toLocaleDateString('es-MX', SHORT) : '';
}

/** «18 nov 2026, 14:05» */
export function shortDateTime(value: string | null | undefined): string {
  const d = parse(value);
  return d ? d.toLocaleString('es-MX', { ...SHORT, hour: '2-digit', minute: '2-digit' }) : '';
}
