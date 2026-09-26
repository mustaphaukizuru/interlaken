import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { nextSort, type SortState } from '@/components/ui/SortableTh';

export interface SortOption {
  /** Ordering key sent to the API (`?ordering=`); must be whitelisted server-side. */
  key: string;
  label: string;
}

interface Props {
  options: SortOption[];
  sort: SortState;
  onSort: (next: SortState) => void;
  className?: string;
}

const DIR_LABEL = { asc: 'ascendente', desc: 'descendente' } as const;

/**
 * Sort control for the family portal lists (Data Ops Phase 9).
 *
 * The portal histories are card lists, not tables, so there is no header to
 * carry `aria-sort`; each key is a toggle button instead (`aria-pressed`, and
 * the direction spelled out in the accessible name). Same cycle as the admin
 * `SortableTh`: a fresh key starts descending, the active key flips, a third
 * press clears back to the server default (newest first). Sorting is
 * server-side, so it orders the whole history, not just the visible page.
 */
export function SortChips({ options, sort, onSort, className = '' }: Props) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`} role="group" aria-label="Ordenar por">
      <span className="mr-0.5 text-[11px] font-semibold uppercase tracking-wide text-subtle" aria-hidden="true">
        Ordenar
      </span>
      {options.map((o) => {
        const active = sort.key === o.key;
        const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={active}
            aria-label={active ? `Ordenar por ${o.label}, ${DIR_LABEL[sort.dir]}` : `Ordenar por ${o.label}`}
            onClick={() => onSort(nextSort(sort, o.key))}
            className={`inline-flex min-h-[44px] items-center gap-1 rounded-full px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 sm:min-h-[36px] ${
              active ? 'bg-purple text-white' : 'bg-cream-2 text-muted hover:text-ink'
            }`}
          >
            {o.label}
            <Icon size={13} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

export default SortChips;
