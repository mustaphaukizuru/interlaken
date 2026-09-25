import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { MoreHorizontal } from 'lucide-react';
import { SortableTh, type SortState } from '@/components/ui/SortableTh';
import { TableSkeleton } from '@/components/ui/TableSkeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pagination } from '@/components/ui/Pagination';
import { Dropdown } from '@/components/ui/Dropdown';
import { ColumnControls } from '@/components/admin/ColumnControls';
import { ADMIN_PAGE_SIZE } from '@/lib/pagination';
import { useTablePrefs } from '@/hooks/useTablePrefs';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { DataTableSelection, RowKey } from '@/hooks/useRowSelection';

export type { DataTableSelection, RowKey } from '@/hooks/useRowSelection';

export interface Column<Row> {
  /** Stable key for prefs (visibility, widths). Falls back to `header`. */
  id?: string;
  /** Header text and the `data-label` phones show next to each value. */
  header: string;
  /** Text for the columns popover when `header` is an abbreviation or icon. */
  label?: string;
  cell: (row: Row) => ReactNode;
  /** Present = sortable; the key the API whitelists for `?ordering=`. */
  sortKey?: string;
  align?: 'left' | 'right';
  /** Extra classes for the td (e.g. "whitespace-nowrap text-muted"). */
  className?: string;
  /** Extra classes for the th. */
  headerClassName?: string;
  /** Can be hidden from the columns popover (default true). */
  hideable?: boolean;
  /** Hidden until the person shows it. */
  defaultHidden?: boolean;
  /** Initial width in px (resizable tables); persisted widths win. */
  width?: number;
  minWidth?: number;
}

interface Props<Row> {
  columns: Column<Row>[];
  rows: Row[] | undefined;
  rowKey: (row: Row) => RowKey;
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
  /** Extra classes on the scroll wrapper: `hidden md:block` for a desktop-only
   *  table that sits next to a phone card list, or `border-0` inside a card. */
  wrapClassName?: string;

  // ── v2 (Data Ops round, C6) ─────────────────────────────────────────────
  /** Persisted prefs key (`interlaken:table:<id>`); required for column controls to persist. */
  tableId?: string;
  /** Row selection; pass the result of `useRowSelection` directly. */
  selection?: DataTableSelection;
  /** Search + filters + export live here, above the table; stays visible in every state. */
  toolbar?: ReactNode;
  /** Rendered between the toolbar and the table (BulkActionBar). */
  bulkBar?: ReactNode;
  /** Column visibility popover + density toggle + reset. */
  columnControls?: boolean;
  /** First data column stays visible while scrolling sideways (≥ md). */
  pinFirstColumn?: boolean;
  /** Pointer-drag column widths, persisted per table (≥ md). */
  resizable?: boolean;
  onRowClick?: (row: Row) => void;
  stickyHeader?: boolean;
  /** Per-row actions in a last column; collapses to an overflow menu below lg. */
  rowActions?: (row: Row) => ReactNode;
  /** Accessible name of a row, used by the selection checkbox and the actions menu. */
  rowLabel?: (row: Row) => string;
  /** Screen-reader caption for the table. */
  caption?: string;
}

const MIN_WIDTH = 56;

/**
 * The admin data table, once.
 *
 * Eight console pages each hand-rolled the same shape: `.admin-table-wrap` +
 * `.admin-table`, a thead, a tbody with `data-label` on every td (that is what
 * the <768px card layout in index.css reads), and around it the same
 * loading / error / empty / pagination branches in a slightly different order.
 *
 * v2 adds, all optional and off by default: selection with "select all
 * matching", a toolbar slot that survives the loading/empty/error states,
 * column visibility + density persisted per `tableId`, a pinned first column,
 * pointer-resizable widths, row click and a row-actions column. Sorting and
 * paging stay server-side (the props are the URL state the page already keeps).
 */
export function DataTable<Row>({
  columns, rows, rowKey, sort, onSort, page, count = 0, onPage, pageSize = ADMIN_PAGE_SIZE, itemLabel = 'resultados',
  isLoading, isError, onRetry, empty, rowClassName, wrapClassName = '',
  tableId, selection, toolbar, bulkBar, columnControls = false, pinFirstColumn = false, resizable = false,
  onRowClick, stickyHeader = true, rowActions, rowLabel, caption,
}: Props<Row>) {
  const cols = useMemo(
    () => columns.map((c) => ({ ...c, id: c.id ?? c.header, hideable: c.hideable ?? true })),
    [columns],
  );
  const defaultHidden = useMemo(() => cols.filter((c) => c.defaultHidden).map((c) => c.id), [cols]);
  const prefs = useTablePrefs(tableId, { defaultHidden });
  const visible = useMemo(() => cols.filter((c) => !c.hideable || !prefs.isHidden(c.id)), [cols, prefs]);
  const isMd = useMediaQuery('(min-width: 768px)');
  const isLg = useMediaQuery('(min-width: 1024px)');
  const canResize = resizable && isMd;

  // Live widths while dragging (persisted on pointer-up through prefs).
  const [dragWidths, setDragWidths] = useState<Record<string, number>>({});
  const widthOf = (id: string, fallback?: number) => dragWidths[id] ?? prefs.widths[id] ?? fallback;
  const anyWidth = canResize && visible.some((c) => widthOf(c.id, c.width) !== undefined);

  const startResize = (e: PointerEvent<HTMLSpanElement>, id: string, minWidth: number) => {
    const th = e.currentTarget.parentElement as HTMLElement | null;
    if (!th) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width;
    const handle = e.currentTarget;
    handle.setPointerCapture?.(e.pointerId);
    handle.classList.add('admin-table__resizer--active');
    let last = startW;
    const onMove = (ev: globalThis.PointerEvent) => {
      last = Math.max(minWidth, Math.round(startW + ev.clientX - startX));
      setDragWidths((w) => ({ ...w, [id]: last }));
    };
    const onUp = () => {
      handle.classList.remove('admin-table__resizer--active');
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      prefs.setWidth(id, last);
      setDragWidths((w) => {
        const next = { ...w };
        delete next[id];
        return next;
      });
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  };

  // ── selection ──
  const pageKeys = useMemo(() => (rows ?? []).map(rowKey), [rows, rowKey]);
  const selectedOnPage = selection ? pageKeys.filter((k) => selection.selected.has(k)).length : 0;
  const allOnPage = !!selection && pageKeys.length > 0 && (selection.allMatching || selectedOnPage === pageKeys.length);
  const someOnPage = !!selection && !allOnPage && selectedOnPage > 0;
  const headRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headRef.current) headRef.current.indeterminate = someOnPage;
  }, [someOnPage]);
  const togglePage = () => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (allOnPage) pageKeys.forEach((k) => next.delete(k));
    else pageKeys.forEach((k) => next.add(k));
    selection.onChange(next);
  };
  const toggleRow = (key: RowKey) => {
    if (!selection) return;
    const next = new Set(selection.allMatching ? pageKeys : selection.selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selection.onChange(next);
  };
  const matching = selection?.allMatchingCount ?? count;
  const showSelectAllMatching =
    !!selection?.onSelectAllMatching && allOnPage && !selection.allMatching && matching > selection.selected.size;

  // ── row click ──
  const rowClick = (row: Row) => (e: MouseEvent<HTMLTableRowElement>) => {
    if (!onRowClick) return;
    // Interactive children keep their own behaviour (links, buttons, inputs, labels).
    if ((e.target as HTMLElement).closest('a,button,input,select,textarea,label,[role="menu"]')) return;
    onRowClick(row);
  };
  const rowKeyDown = (row: Row) => (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (!onRowClick || e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRowClick(row);
    }
  };

  const labelOf = (row: Row) => rowLabel?.(row) ?? `fila ${String(rowKey(row))}`;
  const pinLeft = selection ? 44 : 0;
  const hasToolbar = Boolean(toolbar) || columnControls;

  let body: ReactNode;
  if (isError) body = <ErrorState onRetry={onRetry} />;
  else if (isLoading && !rows) body = <TableSkeleton />;
  else if (!rows || rows.length === 0) {
    body = empty ? <EmptyState icon={empty.icon} title={empty.title} description={empty.description} action={empty.action} /> : null;
  } else {
    const sortable = sort && onSort;
    body = (
      <div
        className={`admin-table-wrap ${wrapClassName}`.trim()}
        data-layout={isMd ? 'table' : 'cards'}
        aria-busy={isLoading || undefined}
      >
        <table
          className={[
            'admin-table',
            prefs.density === 'dense' ? 'admin-table--dense' : '',
            pinFirstColumn ? 'admin-table--pin-first' : '',
            stickyHeader ? '' : 'admin-table--static',
            onRowClick ? 'admin-table--clickable' : '',
          ].filter(Boolean).join(' ')}
          style={{
            tableLayout: anyWidth ? 'fixed' : undefined,
            ['--pin-left' as string]: `${pinLeft}px`,
          }}
        >
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {selection && (
                <th scope="col" className="admin-table__select" style={{ width: 44 }}>
                  <input
                    ref={headRef}
                    type="checkbox"
                    className="h-4 w-4 rounded border-line text-purple focus:ring-purple/40"
                    aria-label={allOnPage ? 'Quitar la selección de esta página' : 'Seleccionar todas las filas de esta página'}
                    checked={allOnPage}
                    onChange={togglePage}
                  />
                </th>
              )}
              {visible.map((c, i) => {
                const width = canResize ? widthOf(c.id, c.width) : undefined;
                const pin = pinFirstColumn && i === 0 ? 'admin-table__pin' : '';
                const style = width ? { width, minWidth: c.minWidth ?? MIN_WIDTH } : c.minWidth ? { minWidth: c.minWidth } : undefined;
                const resizer = canResize ? (
                  <span
                    className="admin-table__resizer"
                    data-testid={`resize-${c.id}`}
                    aria-hidden="true"
                    onPointerDown={(e) => startResize(e, c.id, c.minWidth ?? MIN_WIDTH)}
                    onDoubleClick={() => prefs.setWidth(c.id, null)}
                  />
                ) : null;
                return sortable && c.sortKey ? (
                  <SortableTh
                    key={c.id}
                    columnKey={c.sortKey}
                    sort={sort}
                    onSort={onSort}
                    align={c.align}
                    className={`${pin} ${c.headerClassName ?? ''}`.trim()}
                    style={style}
                    after={resizer}
                  >
                    {c.header}
                  </SortableTh>
                ) : (
                  <th
                    key={c.id}
                    scope="col"
                    style={style}
                    className={`${c.align === 'right' ? 'text-right' : ''} ${pin} ${c.headerClassName ?? ''}`.trim()}
                  >
                    {c.header}
                    {resizer}
                  </th>
                );
              })}
              {rowActions && (
                <th scope="col" className="admin-table__actions text-right">
                  <span className="sr-only">Acciones</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = rowKey(row);
              const isSelected = !!selection && (selection.allMatching || selection.selected.has(key));
              return (
                // Row click is a pointer shortcut; the same target is always
                // reachable through a link/button in a cell, and the row itself
                // takes Enter/Space when focused.
                <tr
                  key={key}
                  className={`${rowClassName?.(row) ?? ''} ${isSelected ? 'admin-table__row--selected' : ''}`.trim() || undefined}
                  aria-selected={selection ? isSelected : undefined}
                  onClick={onRowClick ? rowClick(row) : undefined}
                  onKeyDown={onRowClick ? rowKeyDown(row) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                >
                  {selection && (
                    <td className="admin-table__select" data-label="Seleccionar">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-line text-purple focus:ring-purple/40"
                        aria-label={`Seleccionar ${labelOf(row)}`}
                        checked={isSelected}
                        onChange={() => toggleRow(key)}
                      />
                    </td>
                  )}
                  {visible.map((c, i) => (
                    <td
                      key={c.id}
                      data-label={c.header}
                      className={`${c.align === 'right' ? 'num' : ''} ${pinFirstColumn && i === 0 ? 'admin-table__pin' : ''} ${c.className ?? ''}`.trim() || undefined}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                  {rowActions && (
                    <td className="admin-table__actions" data-label="Acciones">
                      {isLg ? (
                        <div className="flex items-center justify-end gap-1">{rowActions(row)}</div>
                      ) : (
                        <Dropdown
                          width={220}
                          trigger={({ open, toggle }) => (
                            <button
                              type="button"
                              onClick={toggle}
                              aria-expanded={open}
                              aria-haspopup="true"
                              aria-label={`Acciones de ${labelOf(row)}`}
                              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-subtle hover:bg-cream hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 md:min-h-[36px] md:min-w-[36px]"
                            >
                              <MoreHorizontal size={18} aria-hidden="true" />
                            </button>
                          )}
                        >
                          {() => <div className="flex flex-col gap-1 p-2">{rowActions(row)}</div>}
                        </Dropdown>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      {hasToolbar && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">{toolbar}</div>
          {columnControls && (
            <ColumnControls
              className="ml-auto"
              prefs={prefs}
              columns={cols.map((c) => ({ id: c.id, label: c.label ?? c.header, hideable: c.hideable }))}
            />
          )}
        </div>
      )}
      {bulkBar}
      {/* The bulk bar carries the select-all-matching affordance itself; the
          inline banner is for tables that render selection without a bar. */}
      {selection && !bulkBar && (showSelectAllMatching || selection.allMatching) && (
        <p className="mb-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700" role="status">
          {selection.allMatching ? (
            <>
              Las <strong>{matching.toLocaleString('es-MX')}</strong> filas que coinciden con los filtros están seleccionadas.{' '}
              {selection.onClear && (
                <button type="button" onClick={selection.onClear} className="font-semibold underline underline-offset-2 hover:text-ink">
                  Limpiar selección
                </button>
              )}
            </>
          ) : (
            <>
              Las {pageKeys.length} filas de esta página están seleccionadas.{' '}
              <button type="button" onClick={selection.onSelectAllMatching} className="font-semibold underline underline-offset-2 hover:text-ink">
                Seleccionar las {matching.toLocaleString('es-MX')} que coinciden
              </button>
            </>
          )}
        </p>
      )}
      {body}
      {page !== undefined && onPage && rows && rows.length > 0 && (
        <Pagination page={page} pageSize={pageSize} count={count} onChange={onPage} itemLabel={itemLabel} />
      )}
    </>
  );
}

export default DataTable;
