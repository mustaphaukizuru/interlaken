/**
 * routeMeta.ts: one entry per public URL (title, description, breadcrumb,
 * noindex). The same table feeds
 *   1. the server: the Vite build writes seo-routes.json (seoRoutesPlugin in
 *      vite.config.ts) and backend/apps/core/spa.py writes each URL's <title>,
 *      description, canonical and share tags into its raw HTML, because
 *      WhatsApp, Facebook and most crawlers never run the app;
 *   2. the browser: <RouteSeo/> (components/seo/Seo.tsx) loads this module
 *      after first paint (the server already wrote the first URL's head) and
 *      updates <head> on every client-side navigation;
 *   3. the sitemap and the CMS editor's SEO placeholders.
 * A page that is not in this table is not in the sitemap and is not indexable.
 * Keep backend/apps/content/navigation.py STATIC_ROUTES in step with it
 * (siteMeta.test.ts fails when they drift).
 */
import {
  CURRENT_CYCLE,
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  OG_IMAGE,
  SCHOOL_YEARS,
  SITE_NAME,
  TITLE_SUFFIX,
  canonicalFor,
  type HeadData,
} from './siteMeta';

export interface RouteMeta {
  /** Short title; TITLE_SUFFIX is appended (except on "/"). */
  title: string;
  /** 70-160 characters: what the page answers, with the place name. */
  description: string;
  /** Breadcrumb label; defaults to `title`. */
  crumb?: string;
  /** Path of the breadcrumb parent; defaults to "/". */
  parent?: string;
  /** Share image (absolute URL); defaults to OG_IMAGE. */
  image?: string;
  /** Keep out of the index and the sitemap (forms with personal data). */
  noindex?: boolean;
}

/**
 * Per-route metadata for the public pages, keyed by pathname (no trailing
 * slash). Titles stay under ~60 characters with the suffix and lead with the
 * search phrase families actually type ("primaria bilingüe en Tlalnepantla").
 */
export const ROUTE_META: Record<string, RouteMeta> = {
  '/': {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    crumb: 'Inicio',
  },
  '/nosotros': {
    title: `Nosotros: ${SCHOOL_YEARS} años educando en Tlalnepantla`,
    crumb: 'Quiénes somos',
    description:
      `Conozca al Colegio Interlaken: ${SCHOOL_YEARS} años formando líderes íntegros en Tlalnepantla con educación bilingüe, rigor académico y valores.`,
  },
  '/modelo-educativo': {
    title: 'Modelo educativo bilingüe',
    crumb: 'Modelo educativo',
    description:
      'El modelo del Colegio Interlaken: educación bilingüe, alto nivel académico, valores, tecnología en el aula y cultura ecológica, de preescolar a secundaria.',
  },
  '/galeria': {
    title: 'Galería: campus e instalaciones',
    crumb: 'Galería',
    description:
      'La vida en el Colegio Interlaken: campus, salones, deportes y actividades de preescolar, primaria y secundaria en Tlalnepantla.',
  },
  '/niveles/preescolar': {
    title: 'Kínder bilingüe en Tlalnepantla',
    crumb: 'Preescolar',
    description:
      'Kínder bilingüe en Tlalnepantla, de maternal a KIII: aprender jugando, proyectos en inglés y español, computación, música, deportes y yoga.',
  },
  '/niveles/primaria': {
    title: 'Primaria bilingüe en Tlalnepantla',
    crumb: 'Primaria',
    description:
      'Primaria bilingüe en Tlalnepantla: proyectos, tareas con propósito, Método Singapur, certificaciones de Cambridge, teatro, música y campamentos.',
  },
  '/niveles/secundaria': {
    title: 'Secundaria bilingüe en Tlalnepantla',
    crumb: 'Secundaria',
    description:
      'Secundaria bilingüe en Tlalnepantla: aprender haciendo, certificaciones de Cambridge y Microsoft, LEGO® Education, arte y viajes opcionales al extranjero.',
  },
  '/admisiones': {
    title: `Admisiones ${CURRENT_CYCLE}`,
    crumb: 'Admisiones',
    description:
      `Admisiones ${CURRENT_CYCLE} al Colegio Interlaken en Tlalnepantla: requisitos, fechas, costos y pasos para inscribir a su hijo en preescolar, primaria o secundaria.`,
  },
  '/admisiones/documentacion': {
    title: 'Documentos para la inscripción',
    crumb: 'Documentación',
    parent: '/admisiones',
    description:
      `Documentos requeridos para el examen de valoración e inscripción al Colegio Interlaken (ciclo ${CURRENT_CYCLE}), con enlaces a los trámites oficiales en gob.mx.`,
  },
  '/admisiones/costos': {
    title: `Costos y colegiaturas ${CURRENT_CYCLE}`,
    crumb: 'Costos',
    parent: '/admisiones',
    description:
      `Costos del Colegio Interlaken para el ciclo ${CURRENT_CYCLE}: inscripción, colegiaturas, seguros, extraescolares y estancia de preescolar, primaria y secundaria.`,
  },
  '/pre-registro': {
    title: 'Pre-registro en línea',
    crumb: 'Pre-registro',
    parent: '/admisiones',
    description:
      `Inicie su pre-registro en línea para el ciclo escolar ${CURRENT_CYCLE} en el Colegio Interlaken. Un asesor le contactará en 2 días hábiles.`,
  },
  '/agendar-visita': {
    title: 'Agende una visita al colegio',
    crumb: 'Agendar visita',
    parent: '/admisiones',
    description:
      'Reserve en línea un recorrido por las instalaciones del Colegio Interlaken en Residencial El Dorado, Tlalnepantla. Conozca salones, maestros y patios.',
  },
  '/contacto': {
    title: 'Contacto y ubicación',
    crumb: 'Contacto',
    description:
      'Contacte al Colegio Interlaken: Av. de los Reyes 67, Residencial El Dorado, Tlalnepantla. Teléfono (55) 5379-1188, WhatsApp, correo y mapa.',
  },
  // Menu «Familias» (2026-11-20): Pagar colegiatura (Servo Escolar), Colegiaturas
  // y cafetería, Facturación, Plataformas. Labels and titles follow the menu.
  '/pagos': {
    title: 'Colegiaturas y cafetería: pagos en línea',
    crumb: 'Colegiaturas y cafetería',
    description:
      'Familias del Colegio Interlaken: pague colegiaturas y consulte boletas en línea, y revise el saldo y las recargas de la cafetería escolar.',
  },
  '/plataformas': {
    title: 'Plataformas para familias',
    crumb: 'Plataformas',
    description:
      'Plataformas del Colegio Interlaken: Google Classroom, Gmail institucional, registro de iPad (Mosyle) y Educar es Padre.',
  },
  '/comunidad/facturacion': {
    title: 'Facturación (CFDI)',
    crumb: 'Facturación',
    description:
      'Solicite sus facturas (CFDI) del Colegio Interlaken: datos fiscales requeridos, plazos y avisos importantes.',
  },
  '/aviso-de-privacidad': {
    title: 'Aviso de privacidad',
    crumb: 'Aviso de privacidad',
    description:
      'Aviso de privacidad del Colegio Interlaken conforme a la LFPDPPP: qué datos recabamos, con qué fin los tratamos y cómo ejercer sus derechos ARCO.',
  },
  // Personal-data flows: reachable, never indexed.
  '/inscripcion': {
    title: 'Inscripción formal',
    noindex: true,
    description: 'Complete la inscripción formal en el Colegio Interlaken tras su pre-registro.',
  },
  '/inscripcion/documentos': {
    title: 'Documentos de inscripción',
    noindex: true,
    description: 'Suba los documentos de inscripción de su hijo(a) al Colegio Interlaken.',
  },
  '/login': {
    title: 'Iniciar sesión',
    noindex: true,
    description: 'Acceso al portal del Colegio Interlaken para familias y personal: cafetería y pagos en línea.',
  },
  '/confirmar-correo': {
    title: 'Confirmar correo para avisos',
    noindex: true,
    description: 'Confirme el correo en el que recibirá los avisos del Colegio Interlaken.',
  },
};

/** Full <title> for a route entry. */
export function fullTitle(path: string, meta: Pick<RouteMeta, 'title'>): string {
  return path === '/' ? meta.title : `${meta.title}${TITLE_SUFFIX}`;
}

/** BreadcrumbList JSON-LD for an inner page (null for the home page). */
export function breadcrumbLd(path: string): Record<string, unknown> | null {
  if (path === '/' || !ROUTE_META[path]) return null;
  const chain: string[] = [];
  for (let p: string | undefined = path; p && p !== '/'; p = ROUTE_META[p]?.parent) chain.unshift(p);
  chain.unshift('/');
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: chain.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: ROUTE_META[p]?.crumb ?? ROUTE_META[p]?.title ?? SITE_NAME,
      item: canonicalFor(p),
    })),
  };
}

/** Head for a pathname in ROUTE_META, or null when the route is not listed. */
export function routeHead(pathname: string): HeadData | null {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  const meta = ROUTE_META[path];
  if (!meta) return null;
  const crumbs = meta.noindex ? null : breadcrumbLd(path);
  return {
    title: fullTitle(path, meta),
    description: meta.description,
    canonical: canonicalFor(path),
    image: meta.image ?? OG_IMAGE,
    robots: meta.noindex ? 'noindex' : undefined,
    jsonLd: crumbs ? [crumbs] : [],
  };
}
