import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { FunnelHero } from './FunnelHero';

const photo = (c: HTMLElement) => c.querySelector('section > img')!;

describe('FunnelHero photo (QA 2026-11-24)', () => {
  it('a site photo offers its smaller files, so phones skip the full-size one', () => {
    const { container } = renderWithProviders(<FunnelHero step="agendar-visita" title="Agendar Visita" imageSrc="/assets/facade.webp" />);
    expect(photo(container).getAttribute('srcset')).toBe(
      '/assets/facade-480.webp 480w, /assets/facade-960.webp 960w, /assets/facade.webp 1600w',
    );
    expect(photo(container).getAttribute('sizes')).toBe('100vw');
  });

  it('the default photo has one too; a library photo uses the set it is given', () => {
    const { container, unmount } = renderWithProviders(<FunnelHero step="pre-registro" title="Pre-registro" />);
    expect(photo(container).getAttribute('srcset')).toBe('/assets/hopscotch-480.webp 480w, /assets/hopscotch.webp 960w');
    unmount();
    const lib = renderWithProviders(
      <FunnelHero step="pre-registro" title="Pre-registro" imageSrc="/media/7/lg.webp" imageSrcSet="/media/7/md.webp 960w, /media/7/lg.webp 1600w" />,
    );
    expect(photo(lib.container).getAttribute('srcset')).toBe('/media/7/md.webp 960w, /media/7/lg.webp 1600w');
  });
});
