import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ORG } from './siteMeta';

describe('index.html structured data', () => {
  const html = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8');
  const json = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1];
  const graph = JSON.parse(json)['@graph'] as Record<string, unknown>[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
});
