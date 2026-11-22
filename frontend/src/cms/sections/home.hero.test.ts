import { describe, expect, it } from 'vitest';
import { sections } from './home';
import { CHROME_DEFAULTS } from '@/lib/siteChrome';

describe('home hero (owner, 2026-11-22: Agendar visita / Portal Cafetería)', () => {
  const defaults = () => sections.find((s) => s.type === 'home.hero')?.defaults as {
    primary?: { label: string; href: string };
    secondary?: { label: string; href: string };
    tertiary?: { label: string; href: string };
  };

  it('offers the same destinations as the header buttons, with the same labels, and no «Colegiaturas»', () => {
    const d = defaults();
    expect(d.secondary).toEqual({ label: 'Portal Cafetería', href: '/login' });
    expect(d.tertiary).toBeUndefined();
    const header = CHROME_DEFAULTS.header_buttons;
    expect(header.map((b) => b.label)).toEqual(['Portal Cafetería', 'Agendar visita']);
    for (const link of [d.primary, d.secondary]) {
      expect(header.find((b) => b.href === link?.href)?.label).toBe(link?.label);
    }
  });

  it('the third button is an optional field (pages published without it keep two)', () => {
    const hero = sections.find((s) => s.type === 'home.hero');
    const field = hero?.fields.find((f) => f.key === 'tertiary');
    expect(field?.kind).toBe('link');
    expect(field?.required).toBeFalsy();
  });
});
