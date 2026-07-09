import { describe, it, expect } from 'vitest';
import { SITE_DEFAULTS, socialEntries, waHref } from './siteContact';

describe('siteContact helpers (CMS Phase 1)', () => {
  it('waHref strips formatting and encodes the message', () => {
    expect(waHref('+52 1 55 1234-5678', 'Hola, ¿informes?')).toBe(
      'https://wa.me/5215512345678?text=Hola%2C%20%C2%BFinformes%3F',
    );
  });

  it('socialEntries hides unset networks (placeholders never render)', () => {
    expect(socialEntries(SITE_DEFAULTS)).toEqual([]);
    const entries = socialEntries({
      ...SITE_DEFAULTS,
      facebook_url: 'https://www.facebook.com/colegiointerlaken',
      youtube_url: '   ',
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      key: 'facebook',
      href: 'https://www.facebook.com/colegiointerlaken',
    });
  });
});
