/**
 * Inicio · Portada, header version 3 (school, 2026-11-23): no logo and two
 * buttons, «Proceso de admisión» and «Ver costos». Nothing repeats the header.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { sections } from './home';
import { CHROME_DEFAULTS } from '@/lib/siteChrome';

const hero = () => sections.find((s) => s.type === 'home.hero')!;

describe('home hero (header version 3)', () => {
  it('defaults: «Proceso de admisión» → /admisiones and «Ver costos» → /admisiones/costos', () => {
    expect(hero().defaults).toMatchObject({
      primary: { label: 'Proceso de admisión', href: '/admisiones' },
      secondary: { label: 'Ver costos', href: '/admisiones/costos' },
    });
    const d = hero().defaults as Record<string, unknown>;
    expect(d.tertiary).toBeUndefined();
    expect(d.showLogo).toBeUndefined();
    // Nothing in the hero repeats a header button.
    const header = CHROME_DEFAULTS.header_buttons.map((b) => b.href);
    expect(header).not.toContain('/admisiones');
    expect(header).not.toContain('/admisiones/costos');
  });

  it('the editor has no logo switch and no third button', () => {
    const keys = hero().fields.map((f) => f.key);
    expect(keys).not.toContain('showLogo');
    expect(keys).not.toContain('tertiary');
    expect(keys).toEqual(expect.arrayContaining(['primary', 'secondary']));
  });

  it('draws two links and no logo, also for a page saved with the old logo switch and third button', () => {
    const Hero = hero().component;
    renderWithProviders(
      <Hero
        {...(hero().defaults as object)}
        showLogo
        tertiary={{ label: 'Colegiaturas', href: 'https://interlaken.servoescolar.mx' }}
        video=""
      />,
    );
    const links = screen.getAllByRole('link');
    expect(links.map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
      ['Proceso de admisión', '/admisiones'],
      ['Ver costos', '/admisiones/costos'],
    ]);
    // The only picture is the poster (the logo <img alt="Colegio Interlaken"> is gone).
    expect(screen.queryByRole('img', { name: 'Colegio Interlaken' })).toBeNull();
    expect(screen.getAllByRole('img').map((i) => i.getAttribute('alt'))).toEqual(['Campus Colegio Interlaken']);
  });
});

describe('home hero clicks', () => {
  it('each button is counted with its link (HeroCta)', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const analytics = await import('@/services/analytics');
    const seen: unknown[] = [];
    const spy = vi.spyOn(analytics, 'trackEvent').mockImplementation((name, props) => { seen.push([name, props]); });
    const Hero = hero().component;
    renderWithProviders(<Hero {...(hero().defaults as object)} video="" />);
    await userEvent.click(screen.getByRole('link', { name: /Ver costos/ }));
    expect(seen).toContainEqual(['hero_cta', { target: '/admisiones/costos' }]);
    spy.mockRestore();
  });
});
