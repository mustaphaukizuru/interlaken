import { describe, it, expect } from 'vitest';
import { applyNotice, applyPhrase, formatClock, formatWhatsapp, sentence, whatsappHref } from './topupApply';

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

  it('drops the WhatsApp sentence when the school has none configured', () => {
    expect(applyNotice({ apply_time: '07:30', whatsapp: '' })).toBe(
      'Después de realizar el pago, el saldo se actualizará al siguiente día hábil a las 7:30 a.m.');
  });
});
