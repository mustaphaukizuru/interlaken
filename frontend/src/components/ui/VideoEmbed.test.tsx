import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { VideoEmbed } from './VideoEmbed';

const URL_YT = 'https://youtu.be/z271WfIaPSE';

/** An IntersectionObserver the test can fire by hand. */
let fire: ((visible: boolean) => void) | null = null;
const RealIO = window.IntersectionObserver;
const realMatchMedia = window.matchMedia;

beforeEach(() => {
  fire = null;
  window.IntersectionObserver = class {
    constructor(cb: IntersectionObserverCallback) {
      fire = (visible) => cb([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  } as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  window.IntersectionObserver = RealIO;
  window.matchMedia = realMatchMedia;
});

const iframes = () => Array.from(document.querySelectorAll('iframe'));

describe('VideoEmbed', () => {
  it('waits for a click when autoplay is off, then loads the player with sound', () => {
    render(<VideoEmbed url={URL_YT} />);
    expect(iframes()).toHaveLength(0);
    act(() => fire?.(true));
    expect(iframes()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Reproducir el video institucional' }));
    expect(iframes()).toHaveLength(1);
    expect(iframes()[0].src).toBe('https://www.youtube-nocookie.com/embed/z271WfIaPSE?autoplay=1&rel=0');
  });

  it('autoplays a silent, inert preview on screen; «Ver con sonido» swaps in the real player', () => {
    render(<VideoEmbed url={URL_YT} autoplay poster={{ src: '/assets/facade-sign.webp' }} />);
    expect(iframes()).toHaveLength(0);
    act(() => fire?.(true));
    const [preview] = iframes();
    expect(preview.src).toContain('mute=1');
    expect(preview.src).toContain('enablejsapi=1');
    expect(preview.tabIndex).toBe(-1);
    expect(preview.parentElement?.hasAttribute('inert')).toBe(true);
    // The cover is our photo, not the YouTube thumbnail.
    expect(document.querySelector('img')?.getAttribute('src')).toBe('/assets/facade-sign.webp');
    fireEvent.click(screen.getByRole('button', { name: 'Ver el video institucional con sonido' }));
    expect(iframes()).toHaveLength(1);
    expect(iframes()[0].src).toBe('https://www.youtube-nocookie.com/embed/z271WfIaPSE?autoplay=1&rel=0');
  });

  it('pauses the preview off screen and offers a pause button once it shows', () => {
    vi.useFakeTimers();
    try {
      render(<VideoEmbed url={URL_YT} autoplay />);
      act(() => fire?.(true));
      const frame = iframes()[0];
      const post = vi.fn();
      Object.defineProperty(frame, 'contentWindow', { value: { postMessage: post } });
      fireEvent.load(frame);
      expect(screen.queryByRole('button', { name: 'Pausar la vista previa' })).toBeNull();
      act(() => { vi.advanceTimersByTime(8000); });
      expect(screen.getByRole('button', { name: 'Pausar la vista previa' })).toBeTruthy();
      post.mockClear();
      act(() => fire?.(false));
      expect(post).toHaveBeenCalledWith(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), 'https://www.youtube-nocookie.com');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the click-to-play card for visitors who prefer reduced motion', () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
    render(<VideoEmbed url={URL_YT} autoplay />);
    act(() => fire?.(true));
    expect(iframes()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Reproducir el video institucional' })).toBeTruthy();
  });

  it('falls back to a plain link for unknown URLs', () => {
    render(<VideoEmbed url="https://example.com/video.mp4" autoplay />);
    expect(screen.getByRole('link', { name: /Ver video institucional/ }).getAttribute('href')).toBe('https://example.com/video.mp4');
  });
});
