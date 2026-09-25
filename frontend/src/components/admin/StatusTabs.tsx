import { useRef, type KeyboardEvent } from 'react';
import { useUrlFilters } from '@/hooks/useUrlFilters';

export interface StatusTabOption {
  value: string;
  label: string;
  count?: number;
}

export interface StatusTabsProps {
  /** URL param the active tab writes to (`estado`, `accion`, `tipo`, …). */
  paramKey?: string;
  options: StatusTabOption[];
  /** Label of the "no filter" tab; `null` hides it (one option is always active). */
  allLabel?: string | null;
  allCount?: number;
  /** Accessible name of the tab list. */
  label?: string;
  className?: string;
}

/**
 * Chip/tab filter over one URL param (Data Ops round, C6): "Todos · Pendientes (3)
 * · Confirmadas …". Selecting a tab resets the page. Arrow keys move between
 * tabs (roving focus), matching the WAI tabs pattern the console already uses.
 */
export function StatusTabs({ paramKey = 'estado', options, allLabel = 'Todos', allCount, label = 'Filtrar por estado', className = '' }: StatusTabsProps) {
  const { get, set } = useUrlFilters();
  const active = get(paramKey);
  const listRef = useRef<HTMLDivElement>(null);
  const tabs: StatusTabOption[] = allLabel === null ? options : [{ value: '', label: allLabel, count: allCount }, ...options];

  const select = (value: string) => set({ [paramKey]: value || null, page: null });

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (i === -1) return;
    e.preventDefault();
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length;
    items[next]?.focus();
  };

  return (
    <div ref={listRef} role="tablist" aria-label={label} className={`flex flex-wrap gap-2 ${className}`.trim()}>
      {tabs.map((t) => {
        const selected = active === t.value;
        return (
          <button
            key={t.value || '__all'}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => select(t.value)}
            onKeyDown={onKeyDown}
            className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 sm:min-h-[36px] ${
              selected ? 'bg-purple text-white' : 'bg-cream-2 text-muted hover:text-ink'
            }`}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={`rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${selected ? 'bg-white/20' : 'bg-white text-subtle'}`}>
                {t.count.toLocaleString('es-MX')}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default StatusTabs;
