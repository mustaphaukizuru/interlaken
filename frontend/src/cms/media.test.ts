import { describe, expect, it } from 'vitest';
import { absoluteImageUrl, imageSrc, imageSrcSet, rememberMedia } from './media';

const u = (id: number, v: string) => `/api/v1/content/media/${id}/${v}/`;

describe('library image sizes', () => {
  rememberMedia({
    800: { width: 800, height: 400, variants: ['thumb'] },
    1600: { width: 1600, height: 900, variants: ['thumb', 'md'] },
    3000: { width: 3000, height: 2000, variants: ['thumb', 'md', 'lg'] },
    7: { width: 500, height: 500, variants: [] },            // a GIF: no variants at all
  });

  it('requests only sizes that exist (next larger, else the original)', () => {
    expect(imageSrc(800, 'lg')).toBe(u(800, 'original'));
    expect(imageSrc(800, 'md')).toBe(u(800, 'original'));
    expect(imageSrc(800, 'thumb')).toBe(u(800, 'thumb'));
    expect(imageSrc(1600)).toBe(u(1600, 'original'));
    expect(imageSrc(1600, 'md')).toBe(u(1600, 'md'));
    expect(imageSrc(3000)).toBe(u(3000, 'lg'));
    expect(imageSrc(7, 'thumb')).toBe(u(7, 'original'));
    expect(absoluteImageUrl(800, 'https://x.mx')).toBe(`https://x.mx${u(800, 'original')}`);
  });

  it('srcset lists real files with their real widths', () => {
    expect(imageSrcSet(800, { full: true })).toBe(`${u(800, 'thumb')} 320w, ${u(800, 'original')} 800w`);
    expect(imageSrcSet(800)).toBe(`${u(800, 'thumb')} 320w, ${u(800, 'original')} 800w`);
    expect(imageSrcSet(1600, { full: true })).toBe(`${u(1600, 'thumb')} 320w, ${u(1600, 'md')} 960w, ${u(1600, 'original')} 1600w`);
    expect(imageSrcSet(1600)).toBe(`${u(1600, 'thumb')} 320w, ${u(1600, 'md')} 960w`);
    expect(imageSrcSet(3000, { full: true })).toBe(`${u(3000, 'thumb')} 320w, ${u(3000, 'md')} 960w, ${u(3000, 'lg')} 1600w`);
    expect(imageSrcSet(7)).toBe(`${u(7, 'original')} 500w`);
  });

  it('unknown images keep the full set (the server falls back) and site photos are untouched', () => {
    expect(imageSrc(42)).toBe(u(42, 'lg'));
    expect(imageSrcSet(42, { full: true })).toBe(`${u(42, 'thumb')} 320w, ${u(42, 'md')} 960w, ${u(42, 'lg')} 1600w`);
    expect(imageSrc('/assets/facade.webp')).toBe('/assets/facade.webp');
    expect(imageSrcSet('/assets/facade.webp', { full: true })).toContain('/assets/facade-480.webp 480w');
  });
});
