import { describe, expect, it } from 'vitest';
import {
  checkCurp, cleanCurp, curpAgreementErrors, curpBirthDate, curpBornAbroad, curpCheckDigit,
  curpSex, curpState, isValidCurp, CURP_MESSAGES,
} from './curp';

/**
 * Synthetic CURPs only (public repo): invented initials and dates, check
 * digit computed. The four fixed values were produced by the backend's own
 * `validators.curp_check_digit` (apps.admissions.factories.make_curp), so
 * both sides are proven to agree.
 */
const BACKEND = {
  girl2020: 'LOHA200501MDFRRNA5',
  man1986: 'LOPJ861102HMCRRN02',
  boy2019: 'RUMI190228HPLTRLA3',
  abroad1990: 'XEXX901231XNEXXX02',
};

/** Same recipe as the backend factory: initials + AAMMDD + sex + state + consonants + century + digit. */
function makeCurp(dob: string, sex: 'H' | 'M' | 'X', initials = 'XAXX', state = 'DF', consonants = 'RRN') {
  const [y, m, d] = dob.split('-');
  const body = `${initials}${y.slice(2)}${m}${d}${sex}${state}${consonants}${Number(y) >= 2000 ? 'A' : '0'}`;
  return body + curpCheckDigit(body);
}

describe('curp check digit', () => {
  it('matches the backend for the reference CURPs', () => {
    for (const curp of Object.values(BACKEND)) {
      expect(curpCheckDigit(curp.slice(0, 17))).toBe(Number(curp[17]));
      expect(makeCurp(curpBirthDate(curp)!, curp[10] as 'H', curp.slice(0, 4), curp.slice(11, 13), curp.slice(13, 16))).toBe(curp);
    }
  });

  it('any other last digit is rejected with the server message', () => {
    const wrong = BACKEND.girl2020.slice(0, 17) + ((Number(BACKEND.girl2020[17]) + 1) % 10);
    expect(checkCurp(wrong).error).toBe(CURP_MESSAGES.digit);
    expect(isValidCurp(wrong)).toBe(false);
  });
});

describe('checkCurp', () => {
  it('cleans what people paste (spaces, dashes, lowercase)', () => {
    expect(cleanCurp(' loha-200501 mdfrrna5 ')).toBe(BACKEND.girl2020);
    expect(checkCurp('loha 200501 mdfrrna5')).toEqual({ curp: BACKEND.girl2020, error: null });
  });

  it('blank is valid (required is another rule)', () => {
    expect(checkCurp('')).toEqual({ curp: '', error: null });
  });

  it('counts the characters', () => {
    expect(checkCurp('LOHA2005').error).toBe('La CURP debe tener 18 caracteres (escribió 8).');
  });

  it('rejects the wrong pattern, an unknown state and an impossible date', () => {
    expect(checkCurp('1OHA200501MDFRRNA5').error).toBe(CURP_MESSAGES.format);
    expect(checkCurp(makeCurp('2020-05-01', 'M', 'LOHA', 'ZZ')).error).toBe(CURP_MESSAGES.format);
    expect(checkCurp(makeCurp('2019-02-30', 'H')).error).toBe(CURP_MESSAGES.date);
  });

  it('accepts born abroad (NE) and sex X', () => {
    expect(isValidCurp(BACKEND.abroad1990)).toBe(true);
    expect(curpBornAbroad(BACKEND.abroad1990)).toBe(true);
    expect(curpState(BACKEND.abroad1990)).toBeNull();
    expect(curpSex(BACKEND.abroad1990)).toBeNull();
  });
});

describe('what a CURP encodes', () => {
  it('reads the birth date with its century', () => {
    expect(curpBirthDate(BACKEND.girl2020)).toBe('2020-05-01');
    expect(curpBirthDate(BACKEND.man1986)).toBe('1986-11-02');
    expect(curpBirthDate('LOHA')).toBeNull();
  });

  it('reads the sex and the state of birth', () => {
    expect(curpSex(BACKEND.girl2020)).toBe('femenino');
    expect(curpSex(BACKEND.boy2019)).toBe('masculino');
    expect(curpState(BACKEND.girl2020)).toBe('Ciudad de México');
    expect(curpState(BACKEND.man1986)).toBe('Estado de México');
    expect(curpState(BACKEND.boy2019)).toBe('Puebla');
  });
});

describe('curpAgreementErrors', () => {
  it('is empty when the date and the sex agree, or are not typed yet', () => {
    expect(curpAgreementErrors(BACKEND.girl2020, '2020-05-01', 'femenino')).toEqual([]);
    expect(curpAgreementErrors(BACKEND.girl2020, '', '')).toEqual([]);
  });

  it('names the date the CURP says (dd/mm/aaaa) and the sex mismatch', () => {
    expect(curpAgreementErrors(BACKEND.girl2020, '2020-06-01', 'masculino')).toEqual([
      'La CURP indica que la fecha de nacimiento es 01/05/2020. Revise la fecha de nacimiento o la CURP.',
      CURP_MESSAGES.sex,
    ]);
  });

  it('says nothing about an invalid CURP (its own error covers it)', () => {
    expect(curpAgreementErrors('LOHA2005', '2020-06-01', 'masculino')).toEqual([]);
  });
});
