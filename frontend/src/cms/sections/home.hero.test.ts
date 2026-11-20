import { describe, expect, it } from 'vitest';
import { sections } from './home';
import { CHROME_DEFAULTS } from '@/lib/siteChrome';

describe('home hero (menu «Opción 3», 2026-11-20)', () => {
  it('the second hero button reads «Portal Cafetería», like the header button, and goes to /login', () => {
    const hero = sections.find((s) => s.type === 'home.hero');
    const secondary = (hero?.defaults as { secondary?: { label: string; href: string } }).secondary;
    expect(secondary).toEqual({ label: 'Portal Cafetería', href: '/login' });
    const headerButton = CHROME_DEFAULTS.header_buttons.find((b) => b.href === '/login');
    expect(secondary?.label).toBe(headerButton?.label);
  });
});
