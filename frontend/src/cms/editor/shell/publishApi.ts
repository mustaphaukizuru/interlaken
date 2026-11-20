import { api, type CmsPageAdmin } from '@/services/api';

/**
 * Publish or withdraw from the editor. `confirmLegacy` (contract C1) publishes
 * an old generic seed on purpose; without it the backend answers 409
 * `legacy_seed_draft`. Lives here, not in services/api.ts, so the public
 * pages' shared bundle does not change.
 */
export function publishPage(id: number, action: 'publish' | 'unpublish', confirmLegacy = false) {
  return api.post<CmsPageAdmin & { version?: number }>(
    `/content/admin/pages/${id}/publish/`,
    confirmLegacy ? { action, confirm_legacy: true } : { action },
  );
}
