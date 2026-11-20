import type { Block } from '../../blocks/registry';
import type { CmsPageAdmin } from '@/services/api';
import { isLegacyDraft, originalBlocks } from '../helpers';

/**
 * One vocabulary for the state of a public page, shared by the «Contenido»
 * list and the editor's status chip. Every state has a label and an icon, so
 * it never depends on colour alone.
 */
export type PageStateKey = 'original' | 'draft' | 'changes' | 'published' | 'scheduled' | 'legacy';

export interface PageState {
  key: PageStateKey;
  label: string;
  tone: 'success' | 'warning' | 'neutral' | 'info' | 'error';
  /** Second line: when a schedule runs, why a page is a draft again… */
  detail?: string;
  /** Dirección was asked to approve the draft. */
  review: boolean;
}

export const STATE_LABELS: Record<PageStateKey, string> = {
  original: 'Diseño original',
  draft: 'Borrador',
  changes: 'Cambios sin publicar',
  published: 'Publicada',
  scheduled: 'Programada',
  legacy: 'Borrador antiguo',
};

const sameBlocks = (a: Block[], b: Block[]) => JSON.stringify(a) === JSON.stringify(b);

/** Contract C1: the backend flag when it exists, else the old client-side guess. */
export function isLegacySeed(page: Pick<CmsPageAdmin, 'slug' | 'draft_blocks' | 'published_version_number' | 'legacy_seed'>): boolean {
  if (typeof page.legacy_seed === 'boolean') return page.legacy_seed;
  return isLegacyDraft(page.slug, page.draft_blocks ?? [], !!page.published_version_number);
}

/** "3 dic, 08:00" in Mexico City time. */
export function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-MX', { timeZone: 'America/Mexico_City', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

interface StateOptions {
  /** Local draft (the editor's blocks, which may be ahead of the server). */
  blocks?: Block[];
  /** Unsaved or unpublished local edits. */
  dirty?: boolean;
  legacy?: boolean;
  now?: number;
}

/**
 * State of a page: `page` undefined means a public page nobody customised yet
 * (the site shows its original design).
 */
export function pageState(page: CmsPageAdmin | undefined, opts: StateOptions = {}): PageState {
  if (!page) return { key: 'original', label: STATE_LABELS.original, tone: 'neutral', review: false };
  const now = opts.now ?? Date.now();
  const review = !!page.review_requested_at;
  const blocks = opts.blocks ?? page.draft_blocks ?? [];
  const everPublished = !!page.published_version_number;
  const publishAt = page.publish_at ? new Date(page.publish_at).getTime() : NaN;
  const unpublishAt = page.unpublish_at ? new Date(page.unpublish_at).getTime() : NaN;
  const withdrawNote = Number.isFinite(unpublishAt) && page.status === 'published' ? `Se retira el ${shortDateTime(page.unpublish_at)}` : undefined;

  if (opts.legacy ?? isLegacySeed(page)) {
    return { key: 'legacy', label: STATE_LABELS.legacy, tone: 'warning', review, detail: 'Formato anterior al diseño actual' };
  }
  if (Number.isFinite(publishAt)) {
    const overdue = publishAt <= now;
    return {
      key: 'scheduled', label: STATE_LABELS.scheduled, tone: overdue ? 'error' : 'info', review,
      detail: overdue
        ? `Atrasada: debía publicarse el ${shortDateTime(page.publish_at)}. Use «Revisar».`
        : `Se publica el ${shortDateTime(page.publish_at)}`,
    };
  }
  if (page.status === 'published') {
    if (page.has_unpublished_changes || opts.dirty) return { key: 'changes', label: STATE_LABELS.changes, tone: 'warning', review, detail: withdrawNote };
    return { key: 'published', label: STATE_LABELS.published, tone: 'success', review, detail: withdrawNote };
  }
  const original = !everPublished ? originalBlocks(page.slug) : null;
  if (original && sameBlocks(blocks, original)) {
    return { key: 'original', label: STATE_LABELS.original, tone: 'neutral', review, detail: 'Sin cambios todavía' };
  }
  return {
    key: 'draft', label: STATE_LABELS.draft, tone: 'neutral', review,
    detail: everPublished ? 'Retirada del sitio' : 'Sin publicar',
  };
}

/** "hace unos segundos", "hace 3 min", "hace 2 h", "ayer, 17:40", "12 nov, 10:30". */
export function timeAgo(iso: string | number | null | undefined, now: number = Date.now()): string {
  if (iso === null || iso === undefined || iso === '') return '';
  const t = typeof iso === 'number' ? iso : new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'hace unos segundos';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const fmt = (opts: Intl.DateTimeFormatOptions) => new Date(t).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', ...opts });
  if (h < 48) return `ayer, ${fmt({ hour: '2-digit', minute: '2-digit' })}`;
  return fmt({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Contract C2 name of the last editor, tolerant of a nested user object. */
export function editorName(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const o = v as { full_name?: string; name?: string; email?: string };
    return o.full_name || o.name || '';
  }
  return '';
}
