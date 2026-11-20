/**
 * CMS slug → public path. CmsOverride (App.tsx) binds these slugs to nested
 * routes; every other published page is served at /<slug> by CmsOrNotFound.
 * Twin of backend/apps/content/navigation.py SLUG_PATHS — keep in sync.
 */
export const CMS_SLUG_PATHS: Record<string, string> = {
  inicio: '/',
  documentacion: '/admisiones/documentacion',
  costos: '/admisiones/costos',
  plataformas: '/plataformas',
  preescolar: '/niveles/preescolar',
  primaria: '/niveles/primaria',
  secundaria: '/niveles/secundaria',
  facturacion: '/comunidad/facturacion',
  // Copy of app screens: the routes stay in code (sign-in, invitation wizards).
  'iniciar-sesion': '/login',
  'inscripcion-documentos': '/inscripcion/documentos',
};

export function cmsPagePath(slug: string): string {
  return CMS_SLUG_PATHS[slug] ?? `/${slug}`;
}
