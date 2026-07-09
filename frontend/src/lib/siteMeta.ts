/**
 * siteMeta.ts — single source of truth for public-site SEO metadata.
 *
 * Canonical URL, per-route <title>/description, and JSON-LD structured data all
 * derive from the constants here so the marketing site presents one consistent
 * identity to crawlers and social scrapers.
 */

/** Absolute origin used for canonical URLs, OG tags and the sitemap. */
export const SITE_URL = 'https://interlaken.edu.mx';
export const SITE_NAME = 'Colegio Interlaken';

/**
 * Fundado en 1981 → "45 años" en 2026, y se actualiza solo cada año.
 * Usar SIEMPRE `SCHOOL_YEARS` en el copy — nunca un número fijo.
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

export const DEFAULT_TITLE = 'Colegio Interlaken — Educación bilingüe en Tlalnepantla';
export const DEFAULT_DESCRIPTION =
  `Colegio Interlaken — Educación bilingüe de excelencia en Tlalnepantla, Estado de México. Preescolar, primaria y secundaria con ${SCHOOL_YEARS} años de trayectoria.`;
export const OG_IMAGE = `${SITE_URL}/og-image.png`;
export const LOCALE = 'es_MX';

/** Business/contact facts, reused by the LocalBusiness structured data. */
export const ORG = {
  legalName: 'Colegio Interlaken',
  telephone: '+52-55-5379-1188',
  email: 'colegio@interlaken.edu.mx',
  streetAddress: 'Tlalnepantla de Baz',
  addressLocality: 'Tlalnepantla de Baz',
  addressRegion: 'Estado de México',
  postalCode: '54000',
  addressCountry: 'MX',
  // Approximate campus geo (Tlalnepantla de Baz centre) — refine when surveyed.
  latitude: 19.5407,
  longitude: -99.1955,
  // Real profile URLs live in the admin-editable site settings (apps/content);
  // an empty list here keeps placeholder links out of the structured data.
  sameAs: [] as string[],
} as const;

export interface RouteMeta {
  title: string;
  description: string;
  /** Optional override; defaults to `${SITE_URL}${path}`. */
  canonical?: string;
}

/**
 * Per-route metadata for the public marketing pages. Keyed by pathname.
 * Titles are suffixed with the site name at render time (except the home page,
 * whose DEFAULT_TITLE already carries the brand).
 */
export const ROUTE_META: Record<string, RouteMeta> = {
  '/': {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
  },
  '/nosotros': {
    title: 'Nosotros',
    description:
      `Conoce el modelo educativo bilingüe de Colegio Interlaken: ${SCHOOL_YEARS} años formando líderes íntegros en Tlalnepantla con rigor académico y valores.`,
  },
  '/admisiones': {
    title: 'Admisiones',
    description:
      'Proceso de admisión a Colegio Interlaken para preescolar, primaria y secundaria. Conoce requisitos, fechas y cómo inscribir a tu hijo.',
  },
  '/pre-registro': {
    title: 'Pre-Registro en línea',
    description:
      `Inicia tu pre-registro en línea para el ciclo escolar ${CURRENT_CYCLE} en Colegio Interlaken. Un asesor te contactará en 2 días hábiles.`,
  },
  '/inscripcion': {
    title: 'Inscripción Formal',
    description:
      'Completa el proceso de inscripción formal en Colegio Interlaken tras tu pre-registro y contacto con el equipo de admisiones.',
  },
  '/puertas-abiertas': {
    title: 'Puertas Abiertas',
    description:
      'Asiste a un evento de Puertas Abiertas en Colegio Interlaken: conoce nuestras instalaciones, el modelo educativo y a la comunidad.',
  },
  '/agendar-visita': {
    title: 'Agendar Visita',
    description:
      'Reserva un recorrido personalizado por las instalaciones de Colegio Interlaken en Tlalnepantla. Agenda tu visita en línea.',
  },
  '/contacto': {
    title: 'Contacto',
    description:
      'Contacta a Colegio Interlaken en Tlalnepantla, Estado de México. Teléfono, correo y ubicación para resolver tus dudas de admisión.',
  },
  '/aviso-de-privacidad': {
    title: 'Aviso de Privacidad',
    description:
      'Aviso de Privacidad de Colegio Interlaken conforme a la LFPDPPP: qué datos recabamos, con qué fin los tratamos y cómo ejercer tus derechos ARCO.',
  },
};

/**
 * JSON-LD for the school as an EducationalOrganization + LocalBusiness.
 * Rendered once on the home page so the Rich Results test sees a stable graph.
 */
export function organizationJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': ['School', 'EducationalOrganization', 'LocalBusiness'],
    '@id': `${SITE_URL}/#organization`,
    name: SITE_NAME,
    legalName: ORG.legalName,
    url: SITE_URL,
    logo: `${SITE_URL}/assets/logo-horizontal.png`,
    image: OG_IMAGE,
    description: DEFAULT_DESCRIPTION,
    telephone: ORG.telephone,
    email: ORG.email,
    address: {
      '@type': 'PostalAddress',
      streetAddress: ORG.streetAddress,
      addressLocality: ORG.addressLocality,
      addressRegion: ORG.addressRegion,
      postalCode: ORG.postalCode,
      addressCountry: ORG.addressCountry,
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: ORG.latitude,
      longitude: ORG.longitude,
    },
    sameAs: ORG.sameAs,
    areaServed: 'Tlalnepantla de Baz, Estado de México',
  };
}
