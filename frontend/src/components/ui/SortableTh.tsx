import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

export interface SortState {
  /** Column key, e.g. "amount". Empty string = server default order. */
  key: string;
  dir: 'asc' | 'desc';
}

/** Read `?orden=` into a SortState. `-amount` → { key: 'amount', dir: 'desc' }. */
export function parseSort(raw: string | null | undefined): SortState {
  const value = (raw ?? '').trim();
  if (!value) return { key: '', dir: 'desc' };
  return value.startsWith('-') ? { key: value.slice(1), dir: 'desc' } : { key: value, dir: 'asc' };
}

/** Serialize back to the API/URL form; null when it is the server default. */
export function serializeSort(s: SortState): string | null {
  if (!s.key) return null;
  return s.dir === 'desc' ? `-${s.key}` : s.key;
}

/**
 * Next sort when a header is pressed: a fresh column starts descending
 * (newest/largest first is what someone means by "sort by date" or "by amount"),
 * pressing the active column flips it, and a third press clears back to the
 * server default rather than trapping the table in a sort.
 */
export function nextSort(current: SortState, key: string): SortState {
  if (current.key !== key) return { key, dir: 'desc' };
  if (current.dir === 'desc') return { key, dir: 'asc' };
  return { key: '', dir: 'desc' };
}

interface Props {
  /** Column key sent to the API (must be whitelisted server-side). */
  columnKey: string;
  sort: SortState;
  onSort: (next: SortState) => void;
  children: React.ReactNode;
  /** Right-align numeric columns, matching the cells below. */
  align?: 'left' | 'right';
  className?: string;
}

/**
 * Sortable table header cell.
 *
 * Sorting is server-side (apps/core/ordering.py): re-ordering the rows of the
 * current page in the browser would answer a different question than the one
 * the user asked once the list is paginated.
 *
 * `aria-sort` on the th is what a screen reader announces; the button carries
 * the action, so the whole header stays keyboard-reachable.
 */
export function SortableTh({ columnKey, sort, onSort, children, align = 'left', className = '' }: Props) {
  const active = sort.key === columnKey;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(nextSort(sort, columnKey))}
        // Browsers reset text-transform on form controls, so the button has to
        // restate the header typography or sortable columns render in mixed
        // case next to the uppercase static ones.
        className={`inline-flex min-h-[36px] items-center gap-1.5 rounded px-1 font-head text-[11px] font-bold uppercase tracking-wider transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 ${
          active ? 'text-ink' : ''
        } ${align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        {children}
        <Icon size={13} aria-hidden="true" className={active ? 'text-purple' : 'text-subtle'} />
      </button>
    </th>
  );
}

export default SortableTh;
