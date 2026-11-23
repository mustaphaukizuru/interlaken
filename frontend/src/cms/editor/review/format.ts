import { isSeoField } from './applyFix';
import type { ReviewIssue } from './types';

/** A draft left unpublished longer than this gets a reminder in the editor. */
export const STALE_DRAFT_DAYS = 3;

/** Days since `iso` (0 when missing or in the future). */
export function daysSince(iso: string | null | undefined, now = Date.now()): number {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : 0;
}

/** «Sección 2 · Costos · Tablas de precios › Estancia: subtítulo», «SEO › Título SEO», or «Toda la página». */
export function issuePlace(i: Pick<ReviewIssue, 'block_index' | 'block_label' | 'field_label' | 'field'>): string {
  if (typeof i.block_index === 'number') return `Sección ${i.block_index + 1} · ${i.block_label}${i.field_label ? ` › ${i.field_label}` : ''}`;
  if (isSeoField(i.field)) return i.field_label || 'SEO';
  return 'Toda la página';
}
