import { api, type CmsPageAdmin } from '@/services/api';
import { apiErrorCode, apiErrorStatus } from '@/lib/apiErrors';
import type { Block } from '../../blocks/registry';
import type { ReviewReport } from './types';

/**
 * «Revisión antes de publicar» endpoints. Kept out of services/api.ts so the
 * public pages' shared bundle does not change (same reason as publishApi.ts).
 */
export const reviewApi = {
  /** The review of the draft as it is on screen (saved or not); nothing is stored. */
  check: (id: number, draft?: { draft_blocks: Block[]; seo: CmsPageAdmin['seo'] }) =>
    api.post<ReviewReport>(`/content/admin/pages/${id}/checks/`, draft ?? {}),
  /** «Descartar cambios»: the draft goes back to the published version. */
  discard: (id: number, revision?: number) =>
    api.post<CmsPageAdmin>(`/content/admin/pages/${id}/discard/`, typeof revision === 'number' ? { draft_revision: revision } : {}),
};

export type PublishRefusal = ReviewReport & { code: 'publish_blocked' | 'publish_warnings'; detail: string };

/** 409 `publish_blocked` (errors) or `publish_warnings` (unacknowledged warnings): the review that stopped a publication. */
export function publishRefusalFrom(err: unknown): PublishRefusal | null {
  if (apiErrorStatus(err) !== 409) return null;
  const code = apiErrorCode(err);
  if (code !== 'publish_blocked' && code !== 'publish_warnings') return null;
  const data = (err as { response?: { data?: Partial<PublishRefusal> } }).response?.data ?? {};
  return {
    code,
    detail: String(data.detail ?? ''),
    ok: false,
    errors: data.errors ?? [],
    warnings: data.warnings ?? [],
    suggestions: data.suggestions ?? [],
    issues: data.issues ?? [],
    changes: data.changes ?? [],
    baseline: data.baseline ?? 'published',
  };
}
