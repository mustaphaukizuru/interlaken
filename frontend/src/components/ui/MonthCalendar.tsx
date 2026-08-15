import { useMemo, useState } from 'react';
import {
  addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth,
  isToday, parseISO, startOfDay, startOfMonth, startOfWeek, subMonths,
} from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface CalendarDay {
  /** ISO yyyy-MM-dd. */
  date: string;
  /** Optional count shown as a badge (e.g. nº de horarios). */
  count?: number;
}

interface MonthCalendarProps {
  /** Selectable days (with optional counts). Everything else is inert. */
  days: CalendarDay[];
  selectedDate: string | null;
  onSelect: (isoDate: string) => void;
  /** Screen-reader unit for the count badge, e.g. "horarios" / "eventos". */
  countLabel?: string;
}

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/**
 * Modern month calendar (IK-UI): a Calendly-style grid that replaces the flat
 * date list on the visita / puertas-abiertas pages. Available days are
 * brand-tinted with a count badge; prev/next step through months (never before
 * the current month). Token-driven, keyboard-accessible, reduced-motion aware.
 */
export function MonthCalendar({ days, selectedDate, onSelect, countLabel = 'horarios' }: MonthCalendarProps) {
  const today = startOfDay(new Date());
  const byDate = useMemo(() => {
    const m = new Map<string, number>();
    days.forEach((d) => m.set(d.date, d.count ?? 0));
    return m;
  }, [days]);

  // Derived, not synced: until the user pages with prev/next, the calendar
  // opens on the first month that has availability (the current month while
  // loading); after manual navigation the user's choice wins.
  const [navMonth, setNavMonth] = useState<Date | null>(null);
  const firstAvailableMonth = useMemo(() => {
    const first = [...byDate.keys()].sort()[0];
    return first ? startOfMonth(parseISO(first)) : null;
  }, [byDate]);
  const viewMonth = navMonth ?? firstAvailableMonth ?? startOfMonth(today);

  // ~42 cells; cheap enough to compute inline (a manual useMemo keyed on the
  // derived Date can't be preserved by the React Compiler).
  const gridStart = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
  const grid = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const canGoPrev = startOfMonth(viewMonth) > startOfMonth(today);

  return (
    <div className="rounded-xl2 border border-line bg-white p-4 shadow-card sm:p-5">
      {/* Header: month + prev/next */}
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => canGoPrev && setNavMonth(subMonths(viewMonth, 1))}
          disabled={!canGoPrev}
          aria-label="Mes anterior"
          className="flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-cream hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <h3 className="font-head text-base font-bold capitalize text-ink" aria-live="polite">
          {format(viewMonth, 'LLLL yyyy', { locale: es })}
        </h3>
        <button
          type="button"
          onClick={() => setNavMonth(addMonths(viewMonth, 1))}
          aria-label="Mes siguiente"
          className="flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-cream hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
        >
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {/* Weekday labels */}
      <div className="mb-1 grid grid-cols-7 gap-1">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-subtle">
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
        {grid.map((day) => {
          const iso = format(day, 'yyyy-MM-dd');
          const inMonth = isSameMonth(day, viewMonth);
          const available = byDate.has(iso);
          const selected = iso === selectedDate;
          const count = byDate.get(iso) ?? 0;
          const dayNum = format(day, 'd');

          if (!inMonth) {
            return <div key={iso} aria-hidden="true" className="aspect-square" />;
          }
          if (!available) {
            return (
              <div
                key={iso}
                aria-hidden="true"
                className={`flex aspect-square items-center justify-center rounded-xl text-sm ${
                  isToday(day) ? 'font-bold text-ink ring-1 ring-inset ring-line' : 'text-subtle/50'
                }`}
              >
                {dayNum}
              </div>
            );
          }
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelect(iso)}
              aria-pressed={selected}
              aria-label={`${format(day, "d 'de' MMMM", { locale: es })}${
                count
                  ? `, ${count} ${count === 1 ? countLabel.replace(/s$/, '') : countLabel} disponible${count === 1 ? '' : 's'}`
                  : ''
              }`}
              // aspect-square yields ~40px cells at 360px wide (under the 44px touch
              // minimum), so phones get min-h instead; squares return from sm: up.
              className={`group relative flex min-h-[44px] sm:aspect-square sm:min-h-0 flex-col items-center justify-center rounded-xl text-sm font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-1 motion-reduce:transition-none ${
                selected
                  ? 'bg-purple text-white shadow-purple'
                  : 'bg-brand-50 text-brand-700 hover:-translate-y-0.5 hover:bg-brand-100 hover:shadow-sm motion-reduce:hover:translate-y-0'
              } ${isToday(day) && !selected ? 'ring-1 ring-inset ring-brand-300' : ''}`}
            >
              <span className="leading-none">{dayNum}</span>
              {count > 0 && (
                <span
                  className={`mt-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none ${
                    selected ? 'bg-white/25 text-white' : 'bg-purple/15 text-purple'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center gap-4 border-t border-line pt-3 text-[11px] text-subtle">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-[5px] bg-brand-50 ring-1 ring-inset ring-brand-200" /> Disponible
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-[5px] bg-purple" /> Seleccionado
        </span>
      </div>
    </div>
  );
}

export default MonthCalendar;
