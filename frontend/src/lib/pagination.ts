/**
 * DRF PageNumberPagination helpers. The API is configured with a global
 * `PAGE_SIZE` of 20; list endpoints return `{ count, next, previous, results }`.
 * Older/unpaginated endpoints may return a bare array — `toPaged` normalizes both
 * so admin tables can page consistently without a silent truncation to page 1.
 */
export const ADMIN_PAGE_SIZE = 20;

export interface Paged<T> {
  results: T[];
  count: number;
}

export function toPaged<T>(data: unknown): Paged<T> {
  if (Array.isArray(data)) return { results: data as T[], count: (data as T[]).length };
  const d = (data ?? {}) as { results?: T[]; count?: number };
  const results = d.results ?? [];
  return { results, count: d.count ?? results.length };
}
