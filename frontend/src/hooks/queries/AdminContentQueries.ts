import type { CmsPageAdmin, FormDefinitionAdmin, FormSubmission, MediaAsset, SchoolEvent, SiteRedirect, Testimonial } from '@/services/api';
import {
  announcementsAdminApi,
  calendarAdminApi,
  formsAdminApi,
  mediaAdminApi,
  pagesAdminApi,
  redirectsAdminApi,
  submissionsAdminApi,
  testimonialsAdminApi,
  type ContentListParams,
} from '@/services/AdminContentApi';
import type { AdminAnnouncement } from '@/lib/status/AdminAnnouncementStatus';
import { createListHook, useAdminList, useBulk, useExport } from './dataOpsHooks';

/**
 * Fetchers are wrapped in arrows so the API objects are read at call time
 * (tests mock `@/services/AdminContentApi` per page).
 *
 * Admin hooks for Comunicados + Contenido (Data Ops Phase 8). Entity names
 * double as query-key prefixes; a bulk action or an import refreshes the
 * entity and the related public caches the console also shows.
 *
 * Ordering keys mirror the backend whitelists (docs/API-LISTING.md).
 */
export const ANNOUNCEMENTS_ENTITY = 'announcements';
export const PAGES_ENTITY = 'pages';
export const MEDIA_ENTITY = 'media';
export const FORMS_ENTITY = 'forms';
export const SUBMISSIONS_ENTITY = 'form-submissions';
export const REDIRECTS_ENTITY = 'redirects';
export const TESTIMONIALS_ENTITY = 'testimonials';
export const CALENDAR_ENTITY = 'calendar';

export const ANNOUNCEMENT_ORDERING_KEYS = ['created', 'publish_at', 'title', 'audience', 'reads', 'active'] as const;
export const PAGE_ORDERING_KEYS = ['title', 'slug', 'status', 'template', 'updated', 'published', 'created'] as const;
export const MEDIA_ORDERING_KEYS = ['created', 'filename', 'size', 'type', 'alt'] as const;
export const FORM_ORDERING_KEYS = ['title', 'slug', 'updated', 'submissions', 'pending', 'published'] as const;
export const SUBMISSION_ORDERING_KEYS = ['date', 'handled', 'page'] as const;
export const REDIRECT_ORDERING_KEYS = ['from', 'to', 'permanent', 'hits', 'created'] as const;
export const TESTIMONIAL_ORDERING_KEYS = ['order', 'author', 'level', 'published', 'created'] as const;
export const CALENDAR_ORDERING_KEYS = ['start', 'end', 'title', 'kind', 'level', 'published', 'updated'] as const;

// ── Comunicados ──
export const useAnnouncementsList = createListHook<AdminAnnouncement, ContentListParams>(ANNOUNCEMENTS_ENTITY, (p) => announcementsAdminApi.list(p));
export const useAnnouncementsExport = () => useExport(ANNOUNCEMENTS_ENTITY, (p) => announcementsAdminApi.export(p));
export const useAnnouncementsBulk = () => useBulk(ANNOUNCEMENTS_ENTITY, (p) => announcementsAdminApi.bulk(p));

// ── Páginas ──
export const usePagesList = createListHook<CmsPageAdmin, ContentListParams>(PAGES_ENTITY, (p) => pagesAdminApi.list(p));
export const usePagesExport = () => useExport(PAGES_ENTITY, (p) => pagesAdminApi.export(p));
export const usePagesBulk = () => useBulk(PAGES_ENTITY, (p) => pagesAdminApi.bulk(p));

// ── Medios ──
export const useMediaList = createListHook<MediaAsset, ContentListParams>(MEDIA_ENTITY, (p) => mediaAdminApi.list(p));
export const useMediaExport = () => useExport(MEDIA_ENTITY, (p) => mediaAdminApi.export(p));
export const useMediaBulk = () => useBulk(MEDIA_ENTITY, (p) => mediaAdminApi.bulk(p));

// ── Formularios y envíos ──
export const useFormsList = createListHook<FormDefinitionAdmin, ContentListParams>(FORMS_ENTITY, (p) => formsAdminApi.list(p));
export const useFormsExport = () => useExport(FORMS_ENTITY, (p) => formsAdminApi.export(p));
export const useFormsBulk = () => useBulk(FORMS_ENTITY, (p) => formsAdminApi.bulk(p));

/** Inbox of one form; keyed with the form id so two open inboxes never share a page. */
export const useSubmissionsList = (formId: number, params: ContentListParams) =>
  useAdminList<FormSubmission, ContentListParams & { form: number }>(
    SUBMISSIONS_ENTITY,
    ({ form, ...rest }) => submissionsAdminApi.list(form, rest),
    { ...params, form: formId },
  );
export const useSubmissionsExport = (formId: number) =>
  useExport(SUBMISSIONS_ENTITY, (params) => submissionsAdminApi.export(formId, params));
export const useSubmissionsBulk = () => useBulk(SUBMISSIONS_ENTITY, submissionsAdminApi.bulk, [FORMS_ENTITY]);

// ── Redirecciones ──
export const useRedirectsList = createListHook<SiteRedirect, ContentListParams>(REDIRECTS_ENTITY, (p) => redirectsAdminApi.list(p));
export const useRedirectsExport = () => useExport(REDIRECTS_ENTITY, (p) => redirectsAdminApi.export(p));
export const useRedirectsBulk = () => useBulk(REDIRECTS_ENTITY, (p) => redirectsAdminApi.bulk(p));

// ── Testimonios ──
export const useTestimonialsList = createListHook<Testimonial, ContentListParams>(TESTIMONIALS_ENTITY, (p) => testimonialsAdminApi.list(p));
export const useTestimonialsExport = () => useExport(TESTIMONIALS_ENTITY, (p) => testimonialsAdminApi.export(p));
export const useTestimonialsBulk = () => useBulk(TESTIMONIALS_ENTITY, (p) => testimonialsAdminApi.bulk(p));

// ── Calendario ──
export const useCalendarList = createListHook<SchoolEvent, ContentListParams>(CALENDAR_ENTITY, (p) => calendarAdminApi.list(p));
export const useCalendarExport = () => useExport(CALENDAR_ENTITY, (p) => calendarAdminApi.export(p));
export const useCalendarBulk = () => useBulk(CALENDAR_ENTITY, (p) => calendarAdminApi.bulk(p));
