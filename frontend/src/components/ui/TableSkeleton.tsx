/**
 * Content-shaped loading placeholder for admin data tables. A short stack of
 * full-width shimmer rows reads as "this table is loading" and holds the height
 * so the page doesn't jump when rows arrive — a step up from a centered spinner.
 */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2.5" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-11 w-full rounded-lg" />
      ))}
    </div>
  );
}

export default TableSkeleton;
