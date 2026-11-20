import { describe, expect, it } from 'vitest';
import { withoutSeedSeo } from './seedSeo';

describe('withoutSeedSeo', () => {
  const seed = { title: 'Costos · Colegio Interlaken', description: 'Inscripción, colegiaturas, seguros, extraescolares y estancia por nivel.' };

  it('drops the fields that still hold the old seed values and keeps the rest', () => {
    expect(withoutSeedSeo({ ...seed, og_image: 5, noindex: false }, seed)).toEqual({ og_image: 5, noindex: false });
    expect(withoutSeedSeo({ title: seed.title, description: 'Nuestra descripción' }, { title: seed.title })).toEqual({ description: 'Nuestra descripción' });
  });

  it('leaves SEO the school wrote, and returns the same object when nothing changes', () => {
    const own = { title: 'Costos y becas' };
    expect(withoutSeedSeo(own, seed)).toBe(own);
    expect(withoutSeedSeo(own, undefined)).toBe(own);
    expect(withoutSeedSeo(own, {})).toBe(own);
  });
});
