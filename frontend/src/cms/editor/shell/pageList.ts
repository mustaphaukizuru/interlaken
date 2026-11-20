import type { CmsPageAdmin } from '@/services/api';
import type { PageTemplate } from '../../sections/types';
import { cmsPagePath } from '../../slugPaths';
import { STATE_LABELS, editorName, isLegacySeed, pageState, type PageState, type PageStateKey } from './status';

/** One line of «Contenido»: a public page (customised or not) or a page the school created. */
export interface PageRow {
  key: string;
  kind: 'site' | 'custom';
  title: string;
  slug: string;
  /** Public address; null for the 404 page (no address of its own). */
  path: string | null;
  page?: CmsPageAdmin;
  template?: PageTemplate;
  state: PageState;
  /** The site shows this page today (designed pages always do, custom ones once published). */
  live: boolean;
  editedBy: string;
  editedAt: string | null;
}

/** Status filter of the list (`?estado=`): a page state, or pages waiting for approval. */
export type StatusFilter = PageStateKey | 'aprobacion';
export const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  ...(Object.entries(STATE_LABELS) as [PageStateKey, string][]).map(([value, label]) => ({ value, label })),
  { value: 'aprobacion', label: 'Pendiente de aprobación' },
];

function rowFor(kind: PageRow['kind'], page: CmsPageAdmin | undefined, template: PageTemplate | undefined, now: number): PageRow {
  const slug = template?.slug ?? page?.slug ?? '';
  const state = pageState(page, { now, legacy: page ? isLegacySeed(page) && !!template : false });
  const path = slug === 'no-encontrada' ? null : template?.path ?? cmsPagePath(slug);
  return {
    key: page ? `page-${page.id}` : `tpl-${slug}`,
    kind,
    title: template?.title ?? page?.title ?? slug,
    slug,
    path,
    page,
    template,
    state,
    live: !!path && (kind === 'site' || page?.status === 'published'),
    editedBy: editorName(page?.draft_updated_by),
    editedAt: page ? page.draft_updated_at ?? page.updated_at ?? null : null,
  };
}

/**
 * Every public page once (from the design templates, merged with its CMS page
 * when someone customised it) plus the custom pages, each group sorted.
 */
export function buildRows(templates: PageTemplate[], pages: CmsPageAdmin[], now = Date.now()): { site: PageRow[]; custom: PageRow[] } {
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const templateSlugs = new Set(templates.map((t) => t.slug));
  // Inicio first, the 404 page last, the rest by address.
  const rank = (t: PageTemplate) => (t.path === '/' ? 0 : t.slug === 'no-encontrada' ? 2 : 1);
  const site = [...templates]
    .sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path))
    .map((t) => rowFor('site', bySlug.get(t.slug), t, now));
  const custom = pages
    .filter((p) => !templateSlugs.has(p.slug))
    .map((p) => rowFor('custom', p, undefined, now))
    .sort((a, b) => (b.editedAt ?? '').localeCompare(a.editedAt ?? '') || a.title.localeCompare(b.title, 'es'));
  return { site, custom };
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function filterRows(rows: PageRow[], q: string, status: string): PageRow[] {
  const needle = fold(q.trim());
  return rows.filter((r) => {
    if (needle && !fold(`${r.title} ${r.path ?? ''} ${r.slug}`).includes(needle)) return false;
    if (!status) return true;
    if (status === 'aprobacion') return r.state.review;
    return r.state.key === status;
  });
}
