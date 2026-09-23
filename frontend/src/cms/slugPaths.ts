/**
 * CMS slug → public path. CmsOverride (App.tsx) binds these slugs to nested
 * routes; every other published page is served at /<slug> by CmsOrNotFound.
 * Twin of backend/apps/content/navigation.py SLUG_PATHS — keep in sync.
 */
export const CMS_SLUG_PATHS: Record<string, string> = {
  inicio: '/',
  documentacion: '/admisiones/documentacion',
  costos: '/admisiones/costos',
  plataformas: '/comunidad/plataformas',
};

export function cmsPagePath(slug: string): string {
  return CMS_SLUG_PATHS[slug] ?? `/${slug}`;
}
