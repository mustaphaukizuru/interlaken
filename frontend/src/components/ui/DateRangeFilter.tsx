import { CalendarRange, X } from 'lucide-react';

export interface DateRange {
  from: string;
  to: string;
}

function iso(d: Date): string {
  // Local date, not toISOString(): at 20:00 in CDMX the UTC date is already
  // tomorrow, so "Hoy" would query a day the school has not lived yet.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shift(days: number, base = new Date()): Date {
  const d = new Date(base);
  d.setDate(d.getDate() - days);
  return d;
}

/** School year runs Aug–Jul: before August the cycle started last calendar year. */
export function schoolYearStart(now = new Date()): Date {
  const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(year, 7, 1);
}

export interface Preset {
  key: string;
  label: string;
  range: (now?: Date) => DateRange;
}

/** The ranges an admin actually asks for, in the order they ask for them. */
export const DATE_PRESETS: Preset[] = [
  { key: 'hoy', label: 'Hoy', range: (now = new Date()) => ({ from: iso(now), to: iso(now) }) },
  { key: '7d', label: '7 días', range: (now = new Date()) => ({ from: iso(shift(6, now)), to: iso(now) }) },
  { key: '30d', label: '30 días', range: (now = new Date()) => ({ from: iso(shift(29, now)), to: iso(now) }) },
  {
    key: 'mes',
    label: 'Este mes',
    range: (now = new Date()) => ({ from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) }),
  },
  {
    key: 'ciclo',
    label: 'Ciclo escolar',
    range: (now = new Date()) => ({ from: iso(schoolYearStart(now)), to: iso(now) }),
  },
];

/** Which preset (if any) the current from/to pair corresponds to. */
export function activePreset(range: DateRange, now = new Date()): string | null {
  if (!range.from && !range.to) return null;
  const match = DATE_PRESETS.find((p) => {
    const r = p.range(now);
    return r.from === range.from && r.to === range.to;
  });
  return match?.key ?? null;
}

interface Props {
  value: DateRange;
  onChange: (next: DateRange) => void;
  /** Prefix for the input ids so several filters can share a page. */
  idPrefix: string;
  className?: string;
}

/**
 * Date-range filter: one-tap presets plus the exact from/to pair.
 *
 * The tables used to expose two bare date inputs, so the common questions —
 * "today", "this month", "this school year" — cost four taps on a native date
 * picker each time, on a phone. The presets are the fast path; the inputs stay
 * for the arbitrary range, and typing in them just clears the preset highlight.
 */
export function DateRangeFilter({ value, onChange, idPrefix, className = '' }: Props) {
  const active = activePreset(value);
  const dirty = Boolean(value.from || value.to);

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Rango de fechas">
        <CalendarRange size={15} className="text-subtle" aria-hidden="true" />
        {DATE_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={active === p.key}
            onClick={() => onChange(p.range())}
            className={`min-h-[32px] rounded-full px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 ${
              active === p.key ? 'bg-purple text-white' : 'bg-cream-2 text-muted hover:text-ink'
            }`}
          >
            {p.label}
          </button>
        ))}
        {dirty && (
          <button
            type="button"
            onClick={() => onChange({ from: '', to: '' })}
            className="inline-flex min-h-[32px] items-center gap-1 rounded-full px-2.5 text-[13px] text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
          >
            <X size={13} aria-hidden="true" /> Limpiar
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:max-w-md">
        <div>
          <label className="label" htmlFor={`${idPrefix}-desde`}>Desde</label>
          <input
            id={`${idPrefix}-desde`}
            type="date"
            className="input-field min-h-[44px]"
            value={value.from}
            max={value.to || undefined}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor={`${idPrefix}-hasta`}>Hasta</label>
          <input
            id={`${idPrefix}-hasta`}
            type="date"
            className="input-field min-h-[44px]"
            value={value.to}
            min={value.from || undefined}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

export default DateRangeFilter;
