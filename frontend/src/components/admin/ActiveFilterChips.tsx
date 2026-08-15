import { X } from 'lucide-react';

export interface FilterChip {
  key: string;
  label: string;
  onClear: () => void;
}

/**
 * Compact "filtros activos" row for admin lists: one chip per active filter
 * (tap to clear it) plus a one-tap "Limpiar todo" when 2+ filters are active.
 */
export function ActiveFilterChips({ chips, onClearAll }: {
  chips: FilterChip[];
  onClearAll: () => void;
}) {
  if (!chips.length) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" aria-label="Filtros activos">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-subtle">
        Filtros activos:
      </span>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.onClear}
          aria-label={`Quitar filtro: ${chip.label}`}
          className="inline-flex min-h-[32px] items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {chip.label}
          <X size={12} aria-hidden="true" />
        </button>
      ))}
      {chips.length >= 2 && (
        <button
          type="button"
          onClick={onClearAll}
          className="text-xs font-semibold text-muted underline-offset-2 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
        >
          Limpiar todo
        </button>
      )}
    </div>
  );
}
