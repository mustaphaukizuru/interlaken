/**
 * siteMeta.ts: single source of truth for the public site's SEO metadata.
 *
 * Site-wide constants and the business facts. The per-route table (titles,
 * descriptions, breadcrumbs) lives in ./routeMeta.ts, out of the entry chunk.
 * Keep ORG equal to the JSON-LD in index.html (siteMeta.test.ts fails when
 * they drift).
 */

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
 * Ciclo escolar mexicano (agosto–junio) que anuncia el sitio. Las admisiones
 * de un año natural corresponden al ciclo que inicia en agosto de ese año: en
 * 2026 → «2026–2027», y rueda solo. `fromMonth` (Ajustes, SiteSettings.
 * admissions_next_from_month) adelanta el cambio: con 11, desde el 1 de
 * noviembre de 2026 el sitio ya anuncia «2027–2028». 1 = cada 1 de enero.
 */
export function announcedCycleStart(now = new Date(), fromMonth = 1): number {
  const y = now.getFullYear();
  return fromMonth > 1 && now.getMonth() + 1 >= fromMonth ? y + 1 : y;
}
export const cycleLabel = (start: number) => `${start}–${start + 1}`;
/** The school year in progress (it turns in August): what the console and the student card show. */
export function runningCycleStart(now = new Date()): number {
  return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}
/** The announced cycle with the January rule (where the settings are not at hand). */
export const CURRENT_CYCLE = cycleLabel(announcedCycleStart());

/** Costos' cycle: the announced one, or a newer one the school already published prices for (lib/priceYears). */
export function priceCycleStartOf(fromMonth = 1, priceYears?: Partial<Record<string, number>>, now = new Date()): number {
  let start = announcedCycleStart(now, fromMonth);
  for (const y of Object.values(priceYears ?? {})) if (typeof y === 'number' && y > start && y <= 2100) start = y;
  return start;
}

/**
 * {{ciclo}} and {{anios}} in the route titles (lib/routeMeta keeps tokens so the
 * server fills them per request too). `priceYears` (Costos): the cycle is the
 * newest of the announced one and the published price years. Mirror of
 * backend/apps/content/site_years.py expand_tokens.
 */
export function expandYearTokens(text: string | undefined, fromMonth = 1, priceYears?: Partial<Record<string, number>>, now = new Date()): string | undefined {
  if (!text || !text.includes('{{')) return text;
  const start = priceYears ? priceCycleStartOf(fromMonth, priceYears, now) : announcedCycleStart(now, fromMonth);
  return text
    .replace(/\{\{\s*ciclo\s*\}\}/g, cycleLabel(start))
    .replace(/\{\{\s*anios\s*\}\}/g, String(now.getFullYear() - FOUNDED_YEAR));
}

/** Appended to every page title except the home page's. */
export const TITLE_SUFFIX = ` · ${SITE_NAME}`;
export const DEFAULT_TITLE = `${SITE_NAME} | Escuela bilingüe en Tlalnepantla`;
export const DEFAULT_DESCRIPTION =
  `Colegio bilingüe en Tlalnepantla, Estado de México: preescolar, primaria y secundaria con ${SCHOOL_YEARS} años de trayectoria. Agende su visita.`;
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

/** Canonical URL of a pathname: no query, no trailing slash, home keeps "/". */
export function canonicalFor(pathname: string): string {
  const clean = pathname.split(/[?#]/)[0].replace(/\/+$/, '');
  return clean ? `${SITE_URL}${clean}` : `${SITE_URL}/`;
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
