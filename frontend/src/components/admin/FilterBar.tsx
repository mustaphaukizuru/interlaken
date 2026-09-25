import type { ReactNode } from 'react';
import { useUrlFilters } from '@/hooks/useUrlFilters';
import { DateRangeFilter } from '@/components/ui/DateRangeFilter';
import { ActiveFilterChips, type FilterChip } from '@/components/admin/ActiveFilterChips';
import { SearchInput } from '@/components/admin/SearchInput';
import { StatusTabs, type StatusTabsProps } from '@/components/admin/StatusTabs';

export interface FilterSelect {
  /** URL param. */
  key: string;
  /** Accessible name and chip prefix. */
  label: string;
  options: { value: string; label: string }[];
  allLabel?: string;
}

export interface FilterBarProps {
  search?: { paramKey?: string; placeholder: string; label?: string; /** Chip prefix, default "Búsqueda". */ chipLabel?: string };
  tabs?: Omit<StatusTabsProps, 'className'>;
  selects?: FilterSelect[];
  dateRange?: { idPrefix: string; fromKey?: string; toKey?: string; label?: string };
  /** Chips for filters the page owns (e.g. `alumno` set from a link). */
  extraChips?: FilterChip[];
  /** Extra controls rendered in the first row, after the selects. */
  children?: ReactNode;
  className?: string;
}

/**
 * The toolbar of an admin list (Data Ops round, C6): search, status tabs,
 * selects, date range and the active-filter chips, every piece URL-synced
 * through `useUrlFilters`, so a page declares its filters instead of wiring
 * each one. "Limpiar todo" clears every param the bar knows about.
 */
export function FilterBar({ search, tabs, selects = [], dateRange, extraChips = [], children, className = '' }: FilterBarProps) {
  const { get, set } = useUrlFilters();
  const searchKey = search?.paramKey ?? 'q';
  const fromKey = dateRange?.fromKey ?? 'desde';
  const toKey = dateRange?.toKey ?? 'hasta';
  const tabsKey = tabs?.paramKey ?? 'estado';

  const chips: FilterChip[] = [];
  const q = search ? get(searchKey) : '';
  if (q) chips.push({ key: searchKey, label: `${search?.chipLabel ?? 'Búsqueda'}: “${q}”`, onClear: () => set({ [searchKey]: null, page: null }) });
  if (tabs) {
    const v = get(tabsKey);
    const opt = tabs.options.find((o) => o.value === v);
    // "Filtrar por acción" → "Acción: Modificación".
    const noun = (tabs.label ?? 'Estado').replace(/^Filtrar por /i, '');
    const prefix = noun.charAt(0).toUpperCase() + noun.slice(1);
    if (v) chips.push({ key: tabsKey, label: `${prefix}: ${opt?.label ?? v}`, onClear: () => set({ [tabsKey]: null, page: null }) });
  }
  for (const s of selects) {
    const v = get(s.key);
    if (v) chips.push({ key: s.key, label: `${s.label}: ${s.options.find((o) => o.value === v)?.label ?? v}`, onClear: () => set({ [s.key]: null, page: null }) });
  }
  const from = dateRange ? get(fromKey) : '';
  const to = dateRange ? get(toKey) : '';
  if (from || to) chips.push({ key: 'fechas', label: `Fechas: ${from || '…'} a ${to || '…'}`, onClear: () => set({ [fromKey]: null, [toKey]: null, page: null }) });
  chips.push(...extraChips);

  const clearAll = () => {
    const updates: Record<string, null> = { page: null };
    if (search) updates[searchKey] = null;
    if (tabs) updates[tabsKey] = null;
    for (const s of selects) updates[s.key] = null;
    if (dateRange) {
      updates[fromKey] = null;
      updates[toKey] = null;
    }
    set(updates);
    extraChips.forEach((c) => c.onClear());
  };

  return (
    <div className={`space-y-3 ${className}`.trim()}>
      {(search || selects.length > 0 || children) && (
        <div className="flex flex-wrap items-center gap-3">
          {search && <SearchInput paramKey={searchKey} placeholder={search.placeholder} label={search.label} className="min-w-[200px] flex-1 sm:max-w-md" />}
          {selects.map((s) => (
            <select
              key={s.key}
              className="input-field w-auto min-w-[160px]"
              aria-label={s.label}
              value={get(s.key)}
              onChange={(e) => set({ [s.key]: e.target.value || null, page: null })}
            >
              <option value="">{s.allLabel ?? `${s.label}: todos`}</option>
              {s.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          ))}
          {children}
        </div>
      )}
      {tabs && <StatusTabs {...tabs} />}
      {dateRange && (
        <DateRangeFilter
          idPrefix={dateRange.idPrefix}
          value={{ from, to }}
          onChange={(r) => set({ [fromKey]: r.from || null, [toKey]: r.to || null, page: null })}
        />
      )}
      <ActiveFilterChips chips={chips} onClearAll={clearAll} />
    </div>
  );
}

export default FilterBar;
