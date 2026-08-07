import { describe, it, expect } from 'vitest';
import { SITE_DEFAULTS, socialEntries, waHref } from './siteContact';

describe('siteContact helpers (CMS Phase 1)', () => {
  it('waHref strips formatting and encodes the message', () => {
    expect(waHref('+52 1 55 1234-5678', 'Hola, ¿informes?')).toBe(
      'https://wa.me/5215512345678?text=Hola%2C%20%C2%BFinformes%3F',
    );
  });

  it('socialEntries: Facebook default (cliente) renders; unset networks never do', () => {
    // El cliente confirmó que la única red es Facebook — viaja como default.
    const defaults = socialEntries(SITE_DEFAULTS);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]).toMatchObject({
      key: 'facebook',
      href: 'https://www.facebook.com/colegiointerlaken',
    });

    // Redes sin URL (o solo espacios) jamás se renderizan.
    const entries = socialEntries({
      ...SITE_DEFAULTS,
      youtube_url: '   ',
      instagram_url: '',
    });
    expect(entries.map((e) => e.key)).toEqual(['facebook']);

    // Y si se borra el default, tampoco se muestra nada.
    expect(socialEntries({ ...SITE_DEFAULTS, facebook_url: '' })).toEqual([]);
  });
});
