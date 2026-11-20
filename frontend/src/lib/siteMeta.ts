/**
 * siteMeta.ts: single source of truth for the public site's SEO metadata.
 *
 * Every indexable public URL has one entry in ROUTE_META. The same table feeds
 *   1. the browser: <RouteSeo/> (components/seo/Seo.tsx) updates <head> on
 *      every client-side navigation;
 *   2. the server: the Vite build writes it to seo-routes.json (see
 *      seoRoutesPlugin in vite.config.ts) and backend/apps/core/spa.py writes
 *      the right <title>, description, canonical and share tags into the raw
 *      HTML of each URL, because WhatsApp, Facebook and most crawlers never
 *      run the app.
 * A page that is not in this table is not in the sitemap and is not indexable.
 * Keep backend/apps/content/navigation.py STATIC_ROUTES in step with it, and
 * ORG with the JSON-LD in index.html (siteMeta.test.ts fails when they drift).
 */
import { LEVELS } from './levels';

/** Absolute origin used for canonical URLs, OG tags and the sitemap. */
export const SITE_URL = 'https://interlaken.edu.mx';
export const SITE_NAME = 'Colegio Interlaken';

/**
 * Fundado en 1981 → "45 años" en 2026, y se actualiza solo cada año.
 * Usar SIEMPRE `SCHOOL_YEARS` en el copy, nunca un número fijo.
 */
export const FOUNDED_YEAR = 1981;
export const SCHOOL_YEARS = new Date().getFullYear() - FOUNDED_YEAR;

/**
 * Ciclo escolar mexicano (agosto–junio). Las admisiones de un año natural
 * corresponden al ciclo que inicia en agosto de ese año: en 2026 → «2026–2027»,
 * y rueda solo cada 1° de enero.
 */
const _cycleStart = new Date().getFullYear();
export const CURRENT_CYCLE = `${_cycleStart}–${_cycleStart + 1}`;

/** Appended to every page title except the home page's. */
export const TITLE_SUFFIX = ` · ${SITE_NAME}`;
export const DEFAULT_TITLE = `${SITE_NAME} | Escuela bilingüe en Tlalnepantla`;
export const DEFAULT_DESCRIPTION =
  `Colegio bilingüe en Tlalnepantla, Estado de México: preescolar, primaria y secundaria con ${SCHOOL_YEARS} años de trayectoria. Agenda tu visita.`;
export const OG_IMAGE = `${SITE_URL}/og-image.png`;
export const LOCALE = 'es_MX';

/**
 * Business facts (NAP) for the structured data. They MUST match the Google
 * Business Profile and the SEP registry word for word; change them only
 * together with the profile. Verified 2026-11-20 against the school's own
 * contact page, the SEP records (CP 54020) and the profile pin.
 */
export const ORG = {
  legalName: 'Colegio Interlaken',
  telephone: '+52-55-5379-1188',
  // The monitored mailboxes live on .com.mx; .edu.mx has no MX record.
  email: 'info@interlaken.com.mx',
  streetAddress: 'Av. de los Reyes 67, Residencial El Dorado',
  addressLocality: 'Tlalnepantla de Baz',
  addressRegion: 'Estado de México',
  postalCode: '54020',
  addressCountry: 'MX',
  // Google Business Profile pin (maps.app.goo.gl/Xd241Sht8TmrMHUe6).
  latitude: 19.5557298,
  longitude: -99.206715,
  hasMap: 'https://maps.app.goo.gl/Xd241Sht8TmrMHUe6',
  openingHours: 'Mo-Fr 07:30-15:00',
  // Confirmed social profile only (Instagram/YouTube stay empty until real URLs exist).
  sameAs: ['https://www.facebook.com/colegiointerlaken'] as string[],
} as const;

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

const level = (slug: string) => LEVELS.find((l) => l.slug === slug)!;

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
    crumb: 'Nosotros',
    description:
      `Conoce al Colegio Interlaken: ${SCHOOL_YEARS} años formando líderes íntegros en Tlalnepantla con educación bilingüe, rigor académico y valores.`,
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
    description: level('preescolar').seoDescription,
  },
  '/niveles/primaria': {
    title: 'Primaria bilingüe en Tlalnepantla',
    crumb: 'Primaria',
    description: level('primaria').seoDescription,
  },
  '/niveles/secundaria': {
    title: 'Secundaria bilingüe en Tlalnepantla',
    crumb: 'Secundaria',
    description: level('secundaria').seoDescription,
  },
  '/admisiones': {
    title: `Admisiones ${CURRENT_CYCLE}`,
    crumb: 'Admisiones',
    description:
      `Admisiones ${CURRENT_CYCLE} al Colegio Interlaken en Tlalnepantla: requisitos, fechas, costos y pasos para inscribir a tu hijo en preescolar, primaria o secundaria.`,
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
      `Inicia tu pre-registro en línea para el ciclo escolar ${CURRENT_CYCLE} en el Colegio Interlaken. Un asesor te contactará en 2 días hábiles.`,
  },
  '/agendar-visita': {
    title: 'Agenda una visita al colegio',
    crumb: 'Agendar visita',
    parent: '/admisiones',
    description:
      'Reserva en línea un recorrido por las instalaciones del Colegio Interlaken en Residencial El Dorado, Tlalnepantla. Conoce salones, maestros y patios.',
  },
  '/contacto': {
    title: 'Contacto y ubicación',
    crumb: 'Contacto',
    description:
      'Contacta al Colegio Interlaken: Av. de los Reyes 67, Residencial El Dorado, Tlalnepantla. Teléfono (55) 5379-1188, WhatsApp, correo y mapa.',
  },
  '/pagos': {
    title: 'Pagos: colegiaturas y cafetería',
    crumb: 'Pagos',
    description:
      'Pagos del Colegio Interlaken: colegiaturas y boletas en línea, y saldo y recargas de la cafetería escolar.',
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
      'Solicita tus facturas (CFDI) del Colegio Interlaken: datos fiscales requeridos, plazos y avisos importantes.',
  },
  '/aviso-de-privacidad': {
    title: 'Aviso de privacidad',
    crumb: 'Aviso de privacidad',
    description:
      'Aviso de privacidad del Colegio Interlaken conforme a la LFPDPPP: qué datos recabamos, con qué fin los tratamos y cómo ejercer tus derechos ARCO.',
  },
  // Personal-data flows: reachable, never indexed.
  '/inscripcion': {
    title: 'Inscripción formal',
    noindex: true,
    description: 'Completa la inscripción formal en el Colegio Interlaken tras tu pre-registro.',
  },
  '/inscripcion/documentos': {
    title: 'Documentos de inscripción',
    noindex: true,
    description: 'Sube los documentos de inscripción de tu hijo(a) al Colegio Interlaken.',
  },
  '/confirmar-correo': {
    title: 'Confirmar correo para avisos',
    noindex: true,
    description: 'Confirma el correo en el que recibirás los avisos del Colegio Interlaken.',
  },
};

/** Canonical URL of a pathname: no query, no trailing slash, home keeps "/". */
export function canonicalFor(pathname: string): string {
  const clean = pathname.split(/[?#]/)[0].replace(/\/+$/, '');
  return clean ? `${SITE_URL}${clean}` : `${SITE_URL}/`;
}

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

export interface HeadData {
  title: string;
  description: string;
  canonical: string;
  image: string;
  /** "noindex" for private flows and 404s; absent = indexable. */
  robots?: string;
  /** Page-level JSON-LD (the site-wide Organization/WebSite graph is static in index.html). */
  jsonLd: Record<string, unknown>[];
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
