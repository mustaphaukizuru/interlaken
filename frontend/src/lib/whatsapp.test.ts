import { describe, it, expect } from 'vitest';
import { waLink, WA_MESSAGES, waSectionMessage } from './whatsapp';
import { CURRENT_CYCLE } from './siteMeta';

describe('whatsapp helpers', () => {
  it('waLink strips number formatting and URL-encodes the message', () => {
    expect(waLink('+52 1 55 1234-5678', 'Hola, ¿informes?')).toBe(
      'https://wa.me/5215512345678?text=Hola%2C%20%C2%BFinformes%3F',
    );
  });

  it('waLink encodes accented es-MX copy safely', () => {
    const href = waLink('5215553791188', 'Sección Maternal — más información');
    expect(href.startsWith('https://wa.me/5215553791188?text=')).toBe(true);
    // Decoding round-trips exactly.
    expect(decodeURIComponent(href.split('text=')[1])).toBe('Sección Maternal — más información');
  });

  it('prefilled messages carry the auto-computed school cycle', () => {
    expect(WA_MESSAGES.admissionsInfo).toContain(CURRENT_CYCLE);
    expect(WA_MESSAGES.admissionsInfo).toContain('informes de admisión');
    expect(WA_MESSAGES.visit).toBe('Hola, quiero agendar una visita al colegio.');
  });

  it('waSectionMessage interpolates the section and cycle', () => {
    const msg = waSectionMessage('Primaria');
    expect(msg).toBe(`Hola, me interesa información de Primaria para el ciclo ${CURRENT_CYCLE}.`);
  });
});
