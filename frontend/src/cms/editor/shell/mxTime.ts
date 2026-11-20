/**
 * The school schedules publications in Mexico City time, whatever the time
 * zone of the computer: a «datetime-local» value is read and written as
 * America/Mexico_City wall time and stored as an ISO instant.
 */
export const SCHOOL_TZ = 'America/Mexico_City';

function parts(t: number): Record<string, number> {
  const out: Record<string, number> = {};
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: SCHOOL_TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  for (const p of fmt.formatToParts(new Date(t))) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out;
}

/** Offset of the school's time zone at instant `t`, in ms (UTC-6 gives -21 600 000). */
function offsetAt(t: number): number {
  const p = parts(t);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** ISO instant → "YYYY-MM-DDTHH:mm" in Mexico City time (for <input type="datetime-local">). */
export function isoToSchoolInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const p = parts(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour % 24)}:${pad(p.minute)}`;
}

/** "YYYY-MM-DDTHH:mm" read as Mexico City time → ISO instant (UTC), or null when empty/invalid. */
export function schoolInputToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  // Two passes settle the offset even next to a historical DST change.
  let t = wall - offsetAt(wall);
  t = wall - offsetAt(t);
  return new Date(t).toISOString();
}

/** "martes 3 de diciembre de 2026, 08:00" in Mexico City time. */
export function longSchoolDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-MX', {
    timeZone: SCHOOL_TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
