import type { ReactNode } from 'react';
import { SortableTh, type SortState } from '@/components/ui/SortableTh';
import { TableSkeleton } from '@/components/ui/TableSkeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pagination } from '@/components/ui/Pagination';
import { ADMIN_PAGE_SIZE } from '@/lib/pagination';
import type { LucideIcon } from 'lucide-react';

export interface Column<Row> {
  /** Header text and the `data-label` phones show next to each value. */
  header: string;
  cell: (row: Row) => ReactNode;
  /** Present = sortable; the key the API whitelists for `?ordering=`. */
  sortKey?: string;
  align?: 'left' | 'right';
  /** Extra classes for the td (e.g. "whitespace-nowrap text-muted"). */
  className?: string;
  /** Extra classes for the th. */
  headerClassName?: string;
}

interface Props<Row> {
  columns: Column<Row>[];
  rows: Row[] | undefined;
  rowKey: (row: Row) => string | number;
  /** Server-side sort state; omit both to render plain headers. */
  sort?: SortState;
  onSort?: (next: SortState) => void;
  /** Server-side paging; omit to render no pager. */
  page?: number;
  count?: number;
  onPage?: (page: number) => void;
  pageSize?: number;
  itemLabel?: string;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  empty?: { icon: LucideIcon; title: string; description?: string; action?: ReactNode };
  /** Row-level className, e.g. to dim cancelled rows. */
  rowClassName?: (row: Row) => string;
}

/**
 * The admin data table, once.
 *
 * Eight console pages each hand-rolled the same shape: `.admin-table-wrap` +
 * `.admin-table`, a thead, a tbody with `data-label` on every td (that is what
 * the <768px card layout in index.css reads), and around it the same
 * loading / error / empty / pagination branches in a slightly different order.
 * The differences were accidents, not decisions: one page forgot data-label
 * on a column and its phone cards showed a bare value with no caption.
 *
 * Sorting and paging stay server-side (the props are the URL state the page
 * already keeps); this component only renders them.
 */
export function DataTable<Row>({
  columns, rows, rowKey, sort, onSort, page, count = 0, onPage, pageSize = ADMIN_PAGE_SIZE, itemLabel = 'resultados',
  isLoading, isError, onRetry, empty, rowClassName,
}: Props<Row>) {
  if (isError) return <ErrorState onRetry={onRetry} />;
  if (isLoading) return <TableSkeleton />;
  if (!rows || rows.length === 0) {
    return empty ? <EmptyState icon={empty.icon} title={empty.title} description={empty.description} action={empty.action} /> : null;
  }
  const sortable = sort && onSort;
  return (
    <>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              {columns.map((c) => (
                sortable && c.sortKey ? (
                  <SortableTh key={c.header} columnKey={c.sortKey} sort={sort} onSort={onSort} align={c.align} className={c.headerClassName}>
                    {c.header}
                  </SortableTh>
                ) : (
                  <th key={c.header} scope="col" className={`${c.align === 'right' ? 'text-right' : ''} ${c.headerClassName ?? ''}`.trim()}>
                    {c.header}
                  </th>
                )
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className={rowClassName?.(row)}>
                {columns.map((c) => (
                  <td key={c.header} data-label={c.header} className={`${c.align === 'right' ? 'num' : ''} ${c.className ?? ''}`.trim()}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {page !== undefined && onPage && (
        <Pagination page={page} pageSize={pageSize} count={count} onChange={onPage} itemLabel={itemLabel} />
      )}
    </>
  );
}

export default DataTable;
