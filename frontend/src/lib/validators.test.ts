import { describe, expect, it } from 'vitest';
import {
  DAILY_OVER_WEEKLY, EMAIL_MESSAGES, LOW_BALANCE_THRESHOLD_MAX, PHONE_MESSAGES,
  budgetProblem, emailProblem, phoneProblem, thresholdProblem,
} from './validators';

describe('emailProblem', () => {
  it('an empty required field asks for it instead of calling it invalid (QA 2026-11-24)', () => {
    expect(emailProblem('')).toBe(EMAIL_MESSAGES.empty);
    expect(emailProblem('   ')).toBe('Escriba su correo.');
    expect(emailProblem('', { required: false })).toBeNull();
  });

  it('a typed address is checked', () => {
    expect(emailProblem('ana@ejemplo.mx')).toBeNull();
    expect(emailProblem(' ana@ejemplo.mx ')).toBeNull();
    for (const bad of ['ana', 'ana@', 'ana@ejemplo', '@ejemplo.mx', 'ana @ejemplo.mx']) {
      expect(emailProblem(bad)).toBe(EMAIL_MESSAGES.invalid);
    }
  });

  it('takes the form’s own words', () => {
    const messages = { empty: 'Escriba el correo.', invalid: 'Revise el correo.' };
    expect(emailProblem('', { messages })).toBe('Escriba el correo.');
    expect(emailProblem('x', { messages })).toBe('Revise el correo.');
  });
});

describe('phoneProblem (same rule as backend core.phones)', () => {
  it('accepts digits with +, spaces, dashes and parentheses, 10 to 15 digits', () => {
    for (const ok of ['5512345678', '55 1234 5678', '(55) 1234-5678', '+52 55 1234 5678', '+52 1 55 1234 5678', '521551234567890']) {
      expect(phoneProblem(ok)).toBeNull();
    }
  });

  it('refuses letters and other signs, and a wrong length', () => {
    expect(phoneProblem('55 1234 abcd')).toBe(PHONE_MESSAGES.chars);
    expect(phoneProblem('55.1234.5678')).toBe(PHONE_MESSAGES.chars);
    expect(phoneProblem('5512345678 ext 2')).toBe(PHONE_MESSAGES.chars);
    expect(phoneProblem('551234567')).toBe(PHONE_MESSAGES.length);
    expect(phoneProblem('5521551234567890')).toBe(PHONE_MESSAGES.length);
    expect(PHONE_MESSAGES.length).toBe('El número debe tener de 10 a 15 dígitos.');
  });

  it('blank is the form’s business; a value saved before the rule is accepted unchanged', () => {
    expect(phoneProblem('')).toBeNull();
    expect(phoneProblem('55 ext 1', '55 ext 1')).toBeNull();
    expect(phoneProblem(' 55 ext 1 ', '55 ext 1')).toBeNull();
    expect(phoneProblem('55 ext 2', '55 ext 1')).toBe(PHONE_MESSAGES.chars);
  });
});

describe('thresholdProblem', () => {
  it('caps the low-balance alert at the largest single top-up', () => {
    expect(LOW_BALANCE_THRESHOLD_MAX).toBe(1000);
    expect(thresholdProblem('20')).toBeNull();
    expect(thresholdProblem('1000')).toBeNull();
    expect(thresholdProblem('99999')).toBe('El monto máximo de la alerta es $1,000.');
    expect(thresholdProblem('600', 500)).toBe('El monto máximo de la alerta es $500.');
    expect(thresholdProblem('-5')).toBe('Escriba un monto de $0 o más.');
    expect(thresholdProblem('')).toBe('Escriba el monto de la alerta.');
  });
});

describe('budgetProblem', () => {
  it('refuses a daily cap above the weekly one when both are set', () => {
    expect(budgetProblem('500', '100')).toBe(DAILY_OVER_WEEKLY);
    expect(budgetProblem('100', '100')).toBeNull();
    expect(budgetProblem('50', '200')).toBeNull();
    // Blank or 0 is «no cap»: never a conflict.
    expect(budgetProblem('500', '')).toBeNull();
    expect(budgetProblem('500', '0')).toBeNull();
    expect(budgetProblem('', '100')).toBeNull();
  });
});
