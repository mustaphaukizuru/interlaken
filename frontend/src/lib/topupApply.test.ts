import { describe, it, expect } from 'vitest';
import {
  applyNotice, applyPhrase, applyPhraseShort, formatClock, formatWhatsapp, pendingCoversLowBalance, projectBalance,
  projectionStepLine, projectionSummary, sentence, whatsappHref,
} from './topupApply';

// 2030-01-07 is a Monday; 13:30Z is 7:30 in Mexico City (UTC-6).
const MONDAY_0730 = '2030-01-07T13:30:00Z';

describe('topupApply', () => {
  it('says the load time in the school time zone, relative when close', () => {
    expect(applyPhrase(MONDAY_0730, new Date('2030-01-03T18:00:00Z'))).toBe('el lunes 7 de enero a las 7:30 a.m.');
    expect(applyPhrase(MONDAY_0730, new Date('2030-01-06T20:00:00Z'))).toBe('mañana lunes 7 de enero a las 7:30 a.m.');
    expect(applyPhrase(MONDAY_0730, new Date('2030-01-07T12:00:00Z'))).toBe('hoy a las 7:30 a.m.');
  });

  it('never promises a time already gone', () => {
    expect(applyPhrase(MONDAY_0730, new Date('2030-01-07T16:00:00Z'))).toBe('en la próxima carga del colegio');
    expect(applyPhrase(null)).toBe('el siguiente día hábil a las 7:30 a.m.');
  });

  it('formats clocks and sentences without a double period', () => {
    expect(formatClock('07:30')).toBe('7:30 a.m.');
    expect(formatClock('13:05')).toBe('1:05 p.m.');
    expect(sentence('a las 7:30 a.m.')).toBe('a las 7:30 a.m.');
    expect(sentence('Listo')).toBe('Listo.');
    expect(applyNotice({ apply_time: '07:30', whatsapp: '5553791188' })).not.toContain('..');
  });

  it('builds the WhatsApp link with only the folio and the amount', () => {
    const href = whatsappHref('55 5379 1188', { folio: 41, amount: '200' });
    expect(href.startsWith('https://wa.me/525553791188?text=')).toBe(true);
    const text = decodeURIComponent(href.split('text=')[1]);
    expect(text).toContain('Folio: 41');
    expect(text).toContain('Monto: $200.00');
    expect(formatWhatsapp('5553791188')).toBe('55 5379 1188');
  });

  it('says top-ups reach the cafetería in seconds when the app loads them itself', () => {
    const text = applyNotice({ apply_time: '07:30', whatsapp: '5553791188', auto_load: 'instant', auto_load_max: '500.00' });
    expect(text).toContain('el saldo se carga en la cafetería en unos segundos');
    expect(text).toContain('hasta $500.00');
    expect(text).toContain('a más tardar el siguiente día hábil a las 7:30 a.m.');
    expect(text).not.toContain('WhatsApp');
    // Verified-only or off: the school's own wording, unchanged.
    for (const auto_load of ['verified', 'off'] as const) {
      expect(applyNotice({ apply_time: '07:30', whatsapp: '', auto_load, auto_load_max: '500.00' })).toBe(
        'Después de realizar el pago, el saldo se actualizará al siguiente día hábil a las 7:30 a.m.');
    }
  });

  it('drops the WhatsApp sentence when the school has none configured', () => {
    expect(applyNotice({ apply_time: '07:30', whatsapp: '' })).toBe(
      'Después de realizar el pago, el saldo se actualizará al siguiente día hábil a las 7:30 a.m.');
  });

  it('counts paid top-ups on their way against the low-balance level, like the alert e-mail', () => {
    const t = (amount: string) => ({ amount });
    // Nothing pending: the balance alone decides (the page keeps «Saldo bajo»).
    expect(pendingCoversLowBalance('5.00', '20.00', [])).toBe(false);
    expect(pendingCoversLowBalance('5.00', '20.00')).toBe(false);
    // Covers it exactly or more: no badge.
    expect(pendingCoversLowBalance('5.00', '20.00', [t('15.00')])).toBe(true);
    expect(pendingCoversLowBalance('-40.00', '20.00', [t('50.00'), t('10.00')])).toBe(true);
    // Not enough yet: still low.
    expect(pendingCoversLowBalance('5.00', '20.00', [t('14.99')])).toBe(false);
    // Cents never drift (0.1 + 0.2 style sums).
    expect(pendingCoversLowBalance('0.10', '0.30', [t('0.20')])).toBe(true);
    // Missing threshold falls back to the $20 default.
    expect(pendingCoversLowBalance('0.00', null, [t('20.00')])).toBe(true);
  });
});

describe('projectBalance (where a wallet is heading while paid top-ups wait)', () => {
  const now = new Date('2030-01-04T18:00:00Z'); // Friday noon at the school
  const due = (amount: string, apply_due_at: string | null) => ({ amount, apply_due_at });

  it('is null with nothing to add', () => {
    expect(projectBalance('150.00', [], now)).toBeNull();
    expect(projectBalance('150.00', undefined, now)).toBeNull();
    expect(projectBalance('150.00', [due('0.00', MONDAY_0730)], now)).toBeNull();
  });

  it('adds in cents and groups by load time, in load order', () => {
    const p = projectBalance('150.10', [due('0.20', null), due('100.00', MONDAY_0730), due('0.10', MONDAY_0730)], now)!;
    expect(p).toMatchObject({ balance: 15010, pending: 10030, total: 25040, count: 3 });
    expect(p.steps.map((s) => [s.amount, s.count, s.total])).toEqual([[10010, 2, 25020], [20, 1, 25040]]);
    expect(p.steps.map((s) => s.short)).toEqual(['el lunes 7 de enero a las 7:30 a.m.', 'el siguiente día hábil a las 7:30 a.m.']);
    expect(projectionSummary(p)).toBe('3 recargas pagadas por $100.30 · todo disponible el siguiente día hábil a las 7:30 a.m.');
    expect(projectionStepLine(p.steps[0])).toBe('El lunes 7 de enero a las 7:30 a.m.: $250.20 · 2 recargas pagadas por $100.10');
  });

  it('short phrase drops the date for today and tomorrow only', () => {
    expect(applyPhraseShort(MONDAY_0730, new Date('2030-01-06T20:00:00Z'))).toBe('mañana a las 7:30 a.m.');
    expect(applyPhraseShort(MONDAY_0730, new Date('2030-01-07T12:00:00Z'))).toBe('hoy a las 7:30 a.m.');
    expect(applyPhraseShort(MONDAY_0730, now)).toBe('el lunes 7 de enero a las 7:30 a.m.');
    expect(applyPhraseShort(null, now)).toBe('el siguiente día hábil a las 7:30 a.m.');
  });
});
