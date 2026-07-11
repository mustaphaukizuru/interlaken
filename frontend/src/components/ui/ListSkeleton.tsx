/**
 * Content-shaped loading placeholder for row lists (payments, invoices,
 * cafeteria movements). Mirrors the real row layout — icon, two text lines and
 * a right-aligned amount — so the page doesn't jump when data arrives, and reads
 * as "loading this list" rather than a generic centered spinner.
 */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-cream" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="skeleton h-9 w-9 shrink-0 rounded-xl" />
            <div className="space-y-1.5">
              <div className="skeleton h-3 w-32 rounded" />
              <div className="skeleton h-2.5 w-24 rounded" />
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="skeleton h-3 w-16 rounded" />
            <div className="skeleton h-4 w-20 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default ListSkeleton;
