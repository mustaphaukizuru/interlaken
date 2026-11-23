/**
 * Costos never follows the calendar by itself (owner, 2026-11-22). Each price
 * group carries the year the school published it for («Precios 2027» = ciclo
 * 2027–2028), set with «Publicar precios» in «Costos y precios». The page
 * shows the newest cycle the site has (the one it announces, or a newer one
 * the school already priced) and marks every group still on an older year
 * «Precios AAAA: pendientes», until the administration publishes it.
 * Mirror of backend/apps/content/site_years.py.
 */
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { announcedCycleStart, cycleLabel, priceCycleStartOf } from './siteMeta';

export type PriceGroup = 'fees' | 'tuition' | 'insurance' | 'extras' | 'daycare';
export type PriceYears = Partial<Record<PriceGroup, number>>;

/** In the order of the Costos page. */
export const PRICE_GROUPS: { key: PriceGroup; label: string }[] = [
  { key: 'fees', label: 'Inscripción y reinscripción' },
  { key: 'tuition', label: 'Colegiaturas' },
  { key: 'insurance', label: 'Seguros y credenciales' },
  { key: 'extras', label: 'Extraescolares' },
  { key: 'daycare', label: 'Estancia' },
];

/** Known groups with a plausible year only. */
export function cleanYears(raw: unknown): PriceYears {
  const out: PriceYears = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const { key } of PRICE_GROUPS) {
    const y = Number((raw as Record<string, unknown>)[key]);
    if (Number.isInteger(y) && y >= 2000 && y <= 2100) out[key] = y;
  }
  return out;
}

/** First year of the cycle Costos shows: the announced one, or a newer one already published for some group. */
export function priceCycleStart(years: PriceYears, now = new Date(), fromMonth = 1): number {
  return priceCycleStartOf(fromMonth, years, now);
}

/** One group: its published year and whether the cycle shown still lacks its prices. Unknown year: no label, not pending. */
export function priceStatus(group: PriceGroup, years: PriceYears, target: number): { year?: number; pending: boolean } {
  const year = years[group];
  return { year, pending: year != null && year < target };
}

export const priceYearLabel = (year: number) => `Precios ${year}`;
export const pendingLabel = (year: number) => `Precios ${year}: pendientes`;

/**
 * The year the administration should have published, for the console
 * reminder. It starts a month before the site moves to the next cycle (from
 * 1 December with the January rule), so the prices are ready in time.
 */
export function reminderYear(years: PriceYears, now = new Date(), fromMonth = 1): number {
  const inAMonth = new Date(now.getFullYear(), now.getMonth() + 1, Math.min(now.getDate(), 28));
  return Math.max(priceCycleStart(years, now, fromMonth), announcedCycleStart(inAMonth, fromMonth));
}

/** Groups still on an older year than `year` (or never published). */
export function missingGroups(years: PriceYears, year: number): PriceGroup[] {
  return PRICE_GROUPS.map((g) => g.key).filter((k) => (years[k] ?? 0) < year);
}

const joinEs = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`);

/**
 * «Inscripción y colegiatura con precios 2027; seguros y credenciales con
 * precios 2026 (los de 2027 están pendientes).» for the estimator, from the
 * published years of the groups it adds up. null when no year is known.
 */
export function estimatorPriceNote(years: PriceYears, target: number): { text: string; pending: boolean } | null {
  const shown: [PriceGroup, string][] = [['fees', 'inscripción'], ['tuition', 'colegiatura'], ['insurance', 'seguros y credenciales']];
  const byYear = new Map<number, string[]>();
  let pending = false;
  for (const [group, label] of shown) {
    const { year, pending: late } = priceStatus(group, years, target);
    if (year == null) continue;
    byYear.set(year, [...(byYear.get(year) ?? []), label]);
    pending ||= late;
  }
  if (!byYear.size) return null;
  const parts = [...byYear.entries()].sort((a, b) => b[0] - a[0]).map(([y, labels]) => `${joinEs(labels)} con precios ${y}`);
  const text = parts.join('; ') + (pending ? ` (los de ${target} están pendientes)` : '') + '.';
  return { text: text.charAt(0).toUpperCase() + text.slice(1), pending };
}

/** A note typed by hand that names a price year («precios 2027»): the automatic one replaces it. */
export const namesPriceYear = (text: string) => /precios\s+20\d\d/i.test(text);

/** The price years from the site settings, the cycle Costos shows and each group's status. */
export function usePriceYears(now = new Date()) {
  const s = useSiteSettings();
  // The built-in placeholder has no pricing_years: «ready» waits for the server's.
  const ready = s.pricing_years != null;
  const years = cleanYears(s.pricing_years);
  const target = priceCycleStart(years, now, s.admissions_next_from_month ?? 1);
  return {
    ready,
    years,
    target,
    cycle: cycleLabel(target),
    status: (group: PriceGroup) => priceStatus(group, years, target),
  };
}
