import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  /** 1-based current page. */
  page: number;
  /** Rows per page (DRF PAGE_SIZE). */
  pageSize: number;
  /** Total rows across all pages (DRF `count`). */
  count: number;
  onChange: (page: number) => void;
  /** es-MX noun for the counted rows, e.g. "alumnos", "colegiaturas". */
  itemLabel?: string;
}

/**
 * Server-side pagination control for admin data tables. Presentational wiring
 * over DRF PageNumberPagination (`count`/`page`). Renders nothing when a single
 * page holds every row. Controls are ≥44px touch targets with visible focus and
 * token-driven colors; disabled at the range edges.
 */
export function Pagination({ page, pageSize, count, onChange, itemLabel = 'resultados' }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  if (count <= pageSize) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, count);

  const btn =
    'inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-lg border border-line bg-white px-3 text-sm font-medium text-ink transition-colors hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white';

  return (
    <nav
      aria-label="Paginación"
      className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4"
    >
      <p className="text-sm text-muted" aria-live="polite">
        {from}–{to} de <span className="font-semibold text-ink">{count}</span> {itemLabel}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={btn}
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          aria-label="Página anterior"
        >
          <ChevronLeft className="h-4 w-4" /> Anterior
        </button>
        <span className="px-1 text-sm text-muted whitespace-nowrap">
          Página <span className="font-semibold text-ink">{page}</span> de {totalPages}
        </span>
        <button
          type="button"
          className={btn}
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Página siguiente"
        >
          Siguiente <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}

export default Pagination;
