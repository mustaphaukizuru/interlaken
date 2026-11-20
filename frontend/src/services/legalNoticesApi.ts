/**
 * Console «Aviso de privacidad» (backend apps/legal/notices.py). Kept out of
 * services/api.ts so the shared API module every page loads does not grow.
 */
import { api } from './api';

export type NoticeStatus = 'vigente' | 'borrador' | 'anterior';

export interface NoticeVersion {
  id: number;
  version: string;
  title: string;
  /** Only in the detail (the list leaves the text out). */
  body?: string;
  integral_notice_url: string;
  effective_date: string;
  is_active: boolean;
  status: NoticeStatus;
  created_at: string;
  published_at: string | null;
  /** Consent records captured under this version (they never move). */
  consent_count: number;
  /** Registrations that accepted this version. */
  registration_count: number;
}

export type NoticeDraftPatch = Partial<Pick<NoticeVersion, 'version' | 'title' | 'body' | 'integral_notice_url' | 'effective_date'>>;

export const legalNoticesApi = {
  list: () => api.get<{ results: NoticeVersion[]; current_id: number | null }>('/legal/admin/notices/'),
  get: (id: number) => api.get<NoticeVersion>(`/legal/admin/notices/${id}/`),
  /** «Nueva versión»: a draft copied from the current version. */
  createDraft: () => api.post<NoticeVersion>('/legal/admin/notices/', {}),
  update: (id: number, patch: NoticeDraftPatch) => api.patch<NoticeVersion>(`/legal/admin/notices/${id}/`, patch),
  discard: (id: number) => api.delete(`/legal/admin/notices/${id}/`),
  publish: (id: number) => api.post<NoticeVersion>(`/legal/admin/notices/${id}/publish/`, {}),
};
