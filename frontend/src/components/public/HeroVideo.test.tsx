import { describe, expect, it, afterEach } from 'vitest';
import { videoForScreen } from './HeroVideo';

const realMatchMedia = window.matchMedia;
const screen = (portraitPhone: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: portraitPhone && q.includes('portrait'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
};

describe('hero video per screen', () => {
  afterEach(() => { window.matchMedia = realMatchMedia; });

  it('a portrait phone plays the light centre cut of the home loop', () => {
    screen(true);
    expect(videoForScreen('/assets/video/hero-home.mp4')).toBe('/assets/video/hero-home-portrait.mp4');
  });

  it('tablets, desktops and landscape phones keep the full clip', () => {
    screen(false);
    expect(videoForScreen('/assets/video/hero-home.mp4')).toBe('/assets/video/hero-home.mp4');
  });

  it('a video from Ajustes has no cut and plays as it is', () => {
    screen(true);
    expect(videoForScreen('https://example.test/escuela.mp4')).toBe('https://example.test/escuela.mp4');
  });
});
