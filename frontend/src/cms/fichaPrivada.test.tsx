/**
 * The ficha de inscripción is private (2026-11-21): the school sends each
 * admitted family its personal link after the exam. No public default links
 * to /pre-registro or asks families to fill the ficha themselves; the first
 * step is «Agendar visita» or «Solicitar informes» (WhatsApp). The backend
 * migration 0033 brings stored CMS pages to these same defaults, so this
 * test also keeps the two in step.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

vi.mock('@/services/api', () => ({ contentApi: { getSettings: vi.fn() } }));

import { contentApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { allSections, sectionSpec } from './sections';
import { loadAllGroups } from './sections/loaders';
import { CmsAnchor, INFORMES_CTA, VISIT_CTA } from './sections/kit';
import { PERSONAL_LINK_PATHS, SITE_PAGES } from './editor/fields/links';
import { SITE_FORMS } from './editor/fields/FormSelect';
import { DEFAULT_MENU } from '@/components/layout/PublicLayout';
import { FUNNEL_DEFAULTS } from '@/components/admissions/FunnelHero';
import { PRICING_COPY } from '@/components/public/PricingSections';
import { CHROME_DEFAULTS } from '@/lib/siteChrome';
import { ROUTE_META } from '@/lib/routeMeta';

const MIGRATION = readFileSync(resolve(process.cwd(), '../backend/apps/content/migrations/0033_ficha_privada_links.py'), 'utf8');
/** Copy that sends a family to fill the ficha on its own («Llene la ficha», «pre-registro»). */
const ASKS_TO_FILL = /\b(llene|llenar)\s+(en línea\s+)?la ficha|pre-?registro/i;

const defaultsOf = (type: string) => sectionSpec(type)?.defaults as Record<string, unknown>;

describe('the private ficha: public defaults', () => {
  it('no public section links to /pre-registro or asks families to fill the ficha', async () => {
    await loadAllGroups();
    const offenders = allSections()
      .filter((s) => s.group !== 'preregistro') // the ficha's own page
      .flatMap((s) => {
        const json = JSON.stringify(s.defaults ?? {});
        return [
          json.includes('/pre-registro') ? `${s.type}: enlace a /pre-registro` : '',
          ASKS_TO_FILL.test(json) ? `${s.type}: ${json.match(ASKS_TO_FILL)![0]}` : '',
        ].filter(Boolean);
      });
    expect(offenders).toEqual([]);
  }, 30_000);

  it('the calls to action are «Agendar visita» and «Solicitar informes» (WhatsApp)', async () => {
    await loadAllGroups();
    expect(defaultsOf('home.hero').primary).toEqual(VISIT_CTA);
    expect(defaultsOf('home.cta')).toMatchObject({ primary: VISIT_CTA, secondary: INFORMES_CTA });
    expect(defaultsOf('about.cta')).toMatchObject({ primary: VISIT_CTA, secondary: INFORMES_CTA });
    expect(defaultsOf('admisiones.docs_cta')).toMatchObject({ primary: VISIT_CTA, secondary: INFORMES_CTA });
    expect(defaultsOf('documentacion.list').cta).toEqual(VISIT_CTA);
    expect(defaultsOf('costos.prices')).toMatchObject({ ctaPrimary: VISIT_CTA, ctaSecondary: INFORMES_CTA });
    for (const nivel of allSections().filter((s) => s.type === 'nivel.hero')) {
      expect(nivel.defaults).toMatchObject({ primary: VISIT_CTA, secondary: INFORMES_CTA });
    }
    expect(defaultsOf('acceso.screen')).toMatchObject({
      signupText: '¿No tiene cuenta? Su cuenta se crea al inscribirse.',
      signupLink: { label: 'Conozca el proceso de admisión', href: '/admisiones' },
    });
    // The «Inscripción» step says the school sends the ficha after admission.
    const steps = defaultsOf('admisiones.steps').items as { key: string; text: string; link: { href: string } }[];
    expect(steps.map((s) => s.key)).toEqual(['informes', 'visita_guiada', 'examen', 'inscripcion']);
    expect(steps[3].text).toMatch(/^Si su hijo\/a es admitido, le enviamos por correo o WhatsApp su ficha de inscripción/);
  });

  it('menus, header, mobile bar, prices and the funnel steps never point at the ficha', () => {
    const menu = DEFAULT_MENU.flatMap((g) => g.items.map((i) => i.to));
    expect(menu).not.toContain('/pre-registro');
    expect(menu).toContain('/agendar-visita');
    expect(CHROME_DEFAULTS.header_buttons.map((b) => b.href)).not.toContain('/pre-registro');
    expect(CHROME_DEFAULTS.sticky_href).toBe('/agendar-visita');
    expect([PRICING_COPY.ctaPrimary.href, PRICING_COPY.ctaSecondary.href]).not.toContain('/pre-registro');
    // The process as families walk it: visit, exam, inscripción, welcome.
    expect([FUNNEL_DEFAULTS.funnel_1, FUNNEL_DEFAULTS.funnel_2, FUNNEL_DEFAULTS.funnel_3, FUNNEL_DEFAULTS.funnel_4])
      .toEqual(['Visita', 'Examen', 'Inscripción', 'Bienvenida']);
  });

  it('/pre-registro is noindex (and so out of the sitemap)', () => {
    expect(ROUTE_META['/pre-registro'].noindex).toBe(true);
    expect(ROUTE_META['/pre-registro'].description).not.toMatch(ASKS_TO_FILL);
  });

  it('the CMS editor never offers the ficha as a destination or a form', () => {
    expect(SITE_PAGES.map((p) => p.path)).not.toContain('/pre-registro');
    expect(PERSONAL_LINK_PATHS).toContain('/pre-registro');
    expect(SITE_FORMS.map((f) => f.value)).not.toContain('pre-registro');
  });
});

describe('«Solicitar informes» (WhatsApp from Ajustes)', () => {
  it('is the informes message, encoded, with the school number as a token', () => {
    expect(INFORMES_CTA.href).toBe(
      `https://wa.me/{{whatsapp}}?text=${encodeURIComponent('Hola, me gustaría recibir informes de admisión del Colegio Interlaken.')}`,
    );
  });

  it('opens the number in Ajustes, and hides without one', async () => {
    vi.mocked(contentApi.getSettings).mockResolvedValue({ data: { whatsapp_number: '5215512345678' } } as never);
    const { unmount } = renderWithProviders(<CmsAnchor link={INFORMES_CTA} />);
    const link = await screen.findByRole('link', { name: 'Solicitar informes' });
    await waitFor(() => expect(link.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/5215512345678\?text=Hola%2C/));
    expect(link).toHaveAttribute('target', '_blank');
    unmount();

    vi.mocked(contentApi.getSettings).mockResolvedValue({ data: { whatsapp_number: '' } } as never);
    renderWithProviders(<CmsAnchor link={INFORMES_CTA} />);
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Solicitar informes' })).toBeNull());
  });
});

describe('backend migration 0033 writes the same defaults', () => {
  it('has the new buttons and texts, verbatim', async () => {
    await loadAllGroups();
    const texts = [
      VISIT_CTA.label, VISIT_CTA.href, INFORMES_CTA.label, INFORMES_CTA.href,
      defaultsOf('home.cta').text, defaultsOf('about.cta').text, defaultsOf('admisiones.docs_cta').text,
      defaultsOf('documentacion.list').ctaText, defaultsOf('documentacion.list').ctaTitle,
      defaultsOf('costos.prices').ctaText, defaultsOf('visita.hero').subtitle, defaultsOf('preregistro.hero').subtitle,
      ...(defaultsOf('visita.steps').items as { text: string }[]).map((i) => i.text),
      (defaultsOf('visita.steps').link as { label: string }).label,
      ...(defaultsOf('admisiones.steps').items as { text: string }[]).slice(2).map((i) => i.text),
      ...(defaultsOf('admisiones.faq').items as { q: string; a: string }[])
        .filter((i) => /ficha|proceso de admisión/.test(i.q)).flatMap((i) => [i.q, i.a]),
    ];
    const missing = texts.filter((t) => typeof t !== 'string' || !MIGRATION.includes(t));
    expect(missing).toEqual([]);
  }, 30_000);
});
