import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ORG, canonicalFor } from './siteMeta';
import { ROUTE_META, breadcrumbLd, routeHead } from './routeMeta';

const root = join(__dirname, '..', '..', '..');
const indexable = Object.entries(ROUTE_META).filter(([, m]) => !m.noindex).map(([p]) => p);

describe('ROUTE_META', () => {
  it('lists exactly the routes of the backend sitemap fallback', () => {
    const nav = readFileSync(join(root, 'backend', 'apps', 'content', 'navigation.py'), 'utf8');
    const block = nav.slice(nav.indexOf('STATIC_ROUTES = ['), nav.indexOf(']\n', nav.indexOf('STATIC_ROUTES = [')));
    const backend = [...block.matchAll(/\('(\/[^']*)'/g)].map((m) => m[1]);
    expect([...backend].sort()).toEqual([...indexable].sort());
  });

  it.each(Object.keys(ROUTE_META))('%s has a search-friendly title and description', (path) => {
    const head = routeHead(path)!;
    expect(head.title.length).toBeLessThanOrEqual(65);
    expect(head.description.length).toBeGreaterThanOrEqual(60);
    expect(head.description.length).toBeLessThanOrEqual(165);
    expect(head.canonical).toBe(canonicalFor(path));
  });

  it('never repeats a title or a description', () => {
    const titles = Object.keys(ROUTE_META).map((p) => routeHead(p)!.title);
    const descs = Object.keys(ROUTE_META).map((p) => routeHead(p)!.description);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descs).size).toBe(descs.length);
  });

  it('builds canonical URLs without trailing slash or query', () => {
    expect(canonicalFor('/')).toBe('https://interlaken.edu.mx/');
    expect(canonicalFor('/contacto/')).toBe('https://interlaken.edu.mx/contacto');
    expect(canonicalFor('/admisiones?utm_source=fb')).toBe('https://interlaken.edu.mx/admisiones');
  });

  it('nests breadcrumbs under their parent', () => {
    const ld = breadcrumbLd('/admisiones/costos') as { itemListElement: { name: string; item: string }[] };
    expect(ld.itemListElement.map((i) => i.name)).toEqual(['Inicio', 'Admisiones', 'Costos']);
    expect(ld.itemListElement[2].item).toBe('https://interlaken.edu.mx/admisiones/costos');
    expect(breadcrumbLd('/')).toBeNull();
    expect(routeHead('/inscripcion')!.robots).toBe('noindex');
    expect(routeHead('/inscripcion')!.jsonLd).toEqual([]);
  });
});

describe('index.html structured data', () => {
  const html = readFileSync(join(root, 'frontend', 'index.html'), 'utf8');
  const json = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1];
  const graph = JSON.parse(json)['@graph'] as Record<string, unknown>[];
  const org = graph.find((n) => (n['@id'] as string).endsWith('#organization')) as Record<string, any>;

  it('uses the same name, address, phone and pin as ORG (NAP consistency with the Business Profile)', () => {
    expect(org.name).toBe(ORG.legalName);
    expect(org.telephone).toBe(ORG.telephone);
    expect(org.email).toBe(ORG.email);
    expect(org.address).toMatchObject({
      streetAddress: ORG.streetAddress,
      addressLocality: ORG.addressLocality,
      addressRegion: ORG.addressRegion,
      postalCode: ORG.postalCode,
      addressCountry: ORG.addressCountry,
    });
    expect(org.geo).toMatchObject({ latitude: ORG.latitude, longitude: ORG.longitude });
    expect(org.hasMap).toBe(ORG.hasMap);
    expect(org.sameAs).toEqual(ORG.sameAs);
  });

  it('declares the WebSite name Google shows in results', () => {
    const site = graph.find((n) => n['@type'] === 'WebSite')!;
    expect(site.name).toBe('Colegio Interlaken');
    expect(site.url).toBe('https://interlaken.edu.mx/');
  });

  it('has exactly one of each per-page tag for spa.py to rewrite', () => {
    for (const re of [/<title>/g, /name="description"/g, /rel="canonical"/g, /property="og:url"/g, /<!--HEAD-->/g]) {
      expect(html.match(re)?.length, String(re)).toBe(1);
    }
  });
});
