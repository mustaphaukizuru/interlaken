import { api, type CmsPageAdmin } from '@/services/api';

/**
 * Publish or withdraw from the editor. `confirmLegacy` (contract C1) publishes
 * an old generic seed on purpose; without it the backend answers 409
 * `legacy_seed_draft`. `acknowledged` («Revisión antes de publicar») lists the
 * warning keys the person accepted with «Entiendo las advertencias»; without
 * it a draft with warnings answers 409 `publish_warnings`, and any error 409
 * `publish_blocked` (review/reviewApi.publishRefusalFrom). Lives here, not in
 * services/api.ts, so the public pages' shared bundle does not change.
 */
export function publishPage(id: number, action: 'publish' | 'unpublish', confirmLegacy = false, acknowledged?: string[]) {
  return api.post<CmsPageAdmin & { version?: number }>(`/content/admin/pages/${id}/publish/`, {
    action,
    ...(confirmLegacy ? { confirm_legacy: true } : {}),
    ...(acknowledged && acknowledged.length ? { acknowledge_warnings: true, acknowledged_warnings: acknowledged } : {}),
  });
}
