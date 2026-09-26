/**
 * AdminContentApi.ts — Data Ops endpoints of Comunicados + Contenido (Phase 8):
 * paged lists (C1), exports (C3), imports (C4) and bulk actions (C5) for
 * comunicados, páginas, medios, formularios/envíos, redirecciones,
 * testimonios y calendario.
 *
 * Admin-only by import graph (only admin pages and `hooks/queries/AdminContentQueries`
 * import it), and named `Admin*` so its chunk stays out of the SW precache
 * (`globIgnores: **\/assets/Admin*.js`). The public CMS renderer keeps using
 * `contentApi` from `./api`.
 */
import type { AxiosResponse } from 'axios';
import { api } from './api';
import type { BulkRequest, BulkResult, ExportParams, ImportApi, ImportFormat, ImportReport, ImportUploadOptions, ListParams, MediaAsset } from './api';
import { importFormData } from './dataOps';

export type ContentListParams = ListParams;

/** list + export + bulk of one admin list, bound to its base URL. */
export interface EntityApi {
  list: (params: ContentListParams) => Promise<AxiosResponse<unknown>>;
  export: (params: ExportParams) => Promise<AxiosResponse<Blob>>;
  bulk: (body: BulkRequest) => Promise<AxiosResponse<BulkResult>>;
}

function entityApi(base: string): EntityApi {
  return {
    list: (params) => api.get(base, { params }),
    export: (params) => api.get<Blob>(`${base}export/`, { params, responseType: 'blob' }),
    bulk: (body) => api.post<BulkResult>(`${base}bulk/`, body),
  };
}

function importApi(base: string): ImportApi {
  return {
    template: (fmt: ImportFormat) => api.get<Blob>(`${base}import/template/`, { params: { fmt }, responseType: 'blob' }),
    upload: (file: File, opts: ImportUploadOptions) =>
      api.post(`${base}import/`, importFormData(file, opts), { responseType: opts.report ? 'blob' : 'json' }) as Promise<
        AxiosResponse<ImportReport | Blob>
      >,
  };
}

export const announcementsAdminApi = {
  ...entityApi('/portal/admin/announcements/'),
  /** One row per recipient: read, enterado, email/push status (CSV or Excel). */
  deliveryExport: (id: number, fmt: 'csv' | 'xlsx') =>
    api.get<Blob>(`/portal/admin/announcements/${id}/delivery/export/`, { params: { fmt }, responseType: 'blob' }),
};

export const pagesAdminApi = entityApi('/content/admin/pages/');
export const formsAdminApi = entityApi('/content/admin/forms/');
export const testimonialsAdminApi = entityApi('/content/admin/testimonials/');
export const redirectsAdminApi = { ...entityApi('/content/admin/redirects/'), import: importApi('/content/admin/redirects/') };
export const calendarAdminApi = { ...entityApi('/content/admin/calendar/'), import: importApi('/content/admin/calendar/') };
export const mediaAdminApi = {
  ...entityApi('/content/admin/media/'),
  /** One file per request so every file gets its own result (409 = duplicate by sha256). */
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<MediaAsset>('/content/admin/media/', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};

export const submissionsAdminApi = {
  list: (formId: number, params: ContentListParams) => api.get(`/content/admin/forms/${formId}/submissions/`, { params }),
  export: (formId: number, params: ExportParams) =>
    api.get<Blob>(`/content/admin/forms/${formId}/submissions/export/`, { params, responseType: 'blob' }),
  bulk: (body: BulkRequest) => api.post<BulkResult>('/content/admin/form-submissions/bulk/', body),
};

/** Public iCalendar feed of the published school calendar (families subscribe once). */
export function calendarIcsUrl(origin = window.location.origin): string {
  return `${origin}/api/v1/content/calendar.ics`;
}
