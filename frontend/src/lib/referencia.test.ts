import { describe, it, expect } from 'vitest';
import { cleanReferencia, referenciaProblem } from './referencia';

describe('referenciaProblem', () => {
  it('catches the número de control typed into the box (2026-11-21)', () => {
    expect(referenciaProblem('IK38J3ELRBWVL8', 'IK38J3ELRBWVL8')).toMatch(/número de control/);
    expect(referenciaProblem(' ik38j3elrbwvl8 ', 'IK38J3ELRBWVL8')).toMatch(/número de control/);
  });

  it('catches «Referencia 1» and anything with letters', () => {
    expect(referenciaProblem('PAGO38', 'IK38J3ELRBWVL8')).toMatch(/Referencia 1/);
    expect(referenciaProblem('pago 38')).toMatch(/Referencia 1/);
    expect(referenciaProblem('12AB34')).toMatch(/solo dígitos/);
  });

  it('accepts the bank referencia, with or without spaces, and an empty box', () => {
    expect(referenciaProblem('912345678901', 'IK38J3ELRBWVL8')).toBe('');
    expect(referenciaProblem('9123 4567 8901')).toBe('');
    expect(referenciaProblem('')).toBe('');
    expect(cleanReferencia(' 9123 4567 8901 ')).toBe('912345678901');
  });
});
