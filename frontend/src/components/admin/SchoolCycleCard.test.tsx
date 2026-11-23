import { describe, expect, it } from 'vitest';
import { nextCycleSentence } from './SchoolCycleCard';

const d = (y: number, m: number, day = 1) => new Date(y, m - 1, day);

describe('«Ciclo escolar del sitio» sentence', () => {
  it('January rule (as until now)', () => {
    expect(nextCycleSentence(1, d(2026, 11, 22))).toBe('Hoy el sitio anuncia el ciclo 2026–2027. A partir del 1 de enero de 2027 anunciará el 2027–2028.');
  });
  it('a month still ahead this year', () => {
    expect(nextCycleSentence(11, d(2026, 10, 1))).toBe('Hoy el sitio anuncia el ciclo 2026–2027. A partir del 1 de noviembre de 2026 anunciará el 2027–2028.');
  });
  it('a month already reached', () => {
    expect(nextCycleSentence(11, d(2026, 11, 22))).toBe('Hoy el sitio anuncia el ciclo 2027–2028. A partir del 1 de noviembre de 2027 anunciará el 2028–2029.');
  });
});
