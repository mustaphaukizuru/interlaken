import { describe, expect, it } from 'vitest';
import { copyrightWithToken, fixedCopyrightYear, withYear } from './siteChrome';

const Y = new Date().getFullYear();

describe('copyright year (owner, 2026-11-22: it changes by itself)', () => {
  it('«Año en curso» prints the current year', () => {
    expect(withYear('© {{anio}} Colegio Interlaken').join('')).toBe(`© ${Y} Colegio Interlaken`);
  });
  it('a past year typed by hand still shows the current one', () => {
    expect(withYear('© 2020 Colegio Interlaken').join('')).toBe(`© ${Y} Colegio Interlaken`);
    expect(withYear('© 1981-2024 Colegio Interlaken').join('')).toBe(`© 1981-${Y} Colegio Interlaken`);
  });
  it('leaves other numbers alone', () => {
    expect(withYear('Colegio Interlaken · Desde 1981').join('')).toBe('Colegio Interlaken · Desde 1981');
    expect(fixedCopyrightYear('Fundado en 1981')).toBeNull();
  });
  it('finds the hand-typed year and offers the token instead', () => {
    expect(fixedCopyrightYear('© 2026 Colegio Interlaken')).toBe('2026');
    expect(copyrightWithToken('© 2026 Colegio Interlaken')).toBe('© {{anio}} Colegio Interlaken');
    expect(copyrightWithToken('©1981–2026 Colegio')).toBe('©1981–{{anio}} Colegio');
  });
});
