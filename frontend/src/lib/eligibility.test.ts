import { describe, it, expect } from 'vitest';
import { ageOnDec31, eligibilityHint, requiredAge } from './eligibility';

describe('eligibility', () => {
  it('maps grades to required ages', () => {
    expect(requiredAge('Maternal')).toBe(2);
    expect(requiredAge('Preescolar 3°')).toBe(5);
    expect(requiredAge('Primaria 1°')).toBe(6);
    expect(requiredAge('Secundaria 3°')).toBe(14);
    expect(requiredAge('')).toBeNull();
  });
  it('computes the age on 31 Dec and hints mismatches', () => {
    const y = new Date().getFullYear();
    expect(ageOnDec31(`${y - 6}-09-30`, y)).toBe(6);
    expect(eligibilityHint(`${y - 6}-09-30`, 'Primaria 1°')).toBeNull();
    expect(eligibilityHint(`${y - 6}-09-30`, 'Preescolar 1°')).toMatch(/3 años/);
  });
});
