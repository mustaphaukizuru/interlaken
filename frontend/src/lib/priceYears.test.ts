import { describe, expect, it } from 'vitest';
import { cleanYears, estimatorPriceNote, missingGroups, namesPriceYear, priceCycleStart, priceStatus, reminderYear } from './priceYears';
import { announcedCycleStart, expandYearTokens } from './siteMeta';

const d = (y: number, m: number, day = 1) => new Date(y, m - 1, day);

describe('announced cycle (Ajustes: «El sitio anuncia el siguiente ciclo desde»)', () => {
  it('January rule by default, earlier with the chosen month', () => {
    expect(announcedCycleStart(d(2026, 11, 22))).toBe(2026);
    expect(announcedCycleStart(d(2027, 1, 1))).toBe(2027);
    expect(announcedCycleStart(d(2026, 10, 31), 11)).toBe(2026);
    expect(announcedCycleStart(d(2026, 11, 1), 11)).toBe(2027);
    expect(announcedCycleStart(d(2027, 3, 1), 11)).toBe(2027);
  });
  it('expands the route tokens with today\'s values', () => {
    expect(expandYearTokens('Admisiones {{ciclo}}', 1, undefined, d(2027, 2, 1))).toBe('Admisiones 2027–2028');
    expect(expandYearTokens('{{anios}} años', 1, undefined, d(2027, 2, 1))).toBe('46 años');
    // Costos: the cycle of its published prices when newer.
    expect(expandYearTokens('Costos {{ciclo}}', 1, { fees: 2027 }, d(2026, 11, 22))).toBe('Costos 2027–2028');
  });
});

describe('Costos follows its published prices', () => {
  const sheet = { fees: 2027, tuition: 2027, insurance: 2026, extras: 2026, daycare: 2026 } as const;

  it('shows the newest cycle the school priced; older groups are pending', () => {
    const target = priceCycleStart(sheet, d(2026, 11, 22));
    expect(target).toBe(2027);
    expect(priceStatus('fees', sheet, target)).toEqual({ year: 2027, pending: false });
    expect(priceStatus('insurance', sheet, target)).toEqual({ year: 2026, pending: true });
  });

  it('a new year with nothing published: everything pending, nothing relabelled', () => {
    const target = priceCycleStart(sheet, d(2028, 1, 2));
    expect(target).toBe(2028);
    expect(missingGroups(sheet, target)).toEqual(['fees', 'tuition', 'insurance', 'extras', 'daycare']);
    expect(priceStatus('fees', sheet, target)).toEqual({ year: 2027, pending: true });
  });

  it('an unknown group has no label and is not pending', () => {
    expect(priceStatus('extras', {}, 2027)).toEqual({ year: undefined, pending: false });
  });

  it('keeps only known groups and plausible years', () => {
    expect(cleanYears({ fees: '2027', tuition: 1999, bogus: 2027, daycare: 2026.5 })).toEqual({ fees: 2027 });
    expect(cleanYears(null)).toEqual({});
  });
});

describe('console reminder', () => {
  it('starts a month before the site moves to the next cycle', () => {
    const all2027 = { fees: 2027, tuition: 2027, insurance: 2027, extras: 2027, daycare: 2027 };
    expect(reminderYear(all2027, d(2027, 11, 30))).toBe(2027);
    expect(reminderYear(all2027, d(2027, 12, 1))).toBe(2028);
    expect(missingGroups(all2027, reminderYear(all2027, d(2027, 12, 1)))).toHaveLength(5);
    // With «desde el 1 de noviembre», from 1 October.
    expect(reminderYear(all2027, d(2027, 10, 1), 11)).toBe(2028);
    expect(reminderYear(all2027, d(2027, 9, 15), 11)).toBe(2027);
  });
});

describe('estimator note', () => {
  it('reads like the school wrote it', () => {
    expect(estimatorPriceNote({ fees: 2027, tuition: 2027, insurance: 2026 }, 2027)).toEqual({
      text: 'Inscripción y colegiatura con precios 2027; seguros y credenciales con precios 2026 (los de 2027 están pendientes).',
      pending: true,
    });
    expect(estimatorPriceNote({ fees: 2027, tuition: 2027, insurance: 2027 }, 2027)).toEqual({
      text: 'Inscripción, colegiatura y seguros y credenciales con precios 2027.',
      pending: false,
    });
    expect(estimatorPriceNote({}, 2027)).toBeNull();
  });
  it('spots notes typed by hand with a year', () => {
    expect(namesPriceYear('Inscripción con precios 2027; seguros...')).toBe(true);
    expect(namesPriceYear('Recargo del 5% a partir del día 17.')).toBe(false);
  });
});
