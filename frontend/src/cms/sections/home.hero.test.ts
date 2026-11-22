import { describe, expect, it } from 'vitest';
import { sections } from './home';
import { CHROME_DEFAULTS } from '@/lib/siteChrome';

describe('home hero (school, 2026-11-22: Cafetería / Colegiaturas / Agendar visita)', () => {
  const defaults = () => sections.find((s) => s.type === 'home.hero')?.defaults as {
    primary?: { label: string; href: string };
    secondary?: { label: string; href: string };
    tertiary?: { label: string; href: string };
  };

  it('offers the same three destinations as the header buttons, with the same labels', () => {
    const d = defaults();
    expect(d.secondary).toEqual({ label: 'Cafetería', href: '/login' });
    expect(d.tertiary).toEqual({ label: 'Colegiaturas', href: '/pagos' });
    const header = CHROME_DEFAULTS.header_buttons;
    for (const link of [d.primary, d.secondary, d.tertiary]) {
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
