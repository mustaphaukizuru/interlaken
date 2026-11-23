import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, Play, Pause } from 'lucide-react';
import { assetSrcSet } from '@/lib/images';

const SOUND_KEY = 'interlaken:hero-sound';

/**
 * Portrait phone cuts of the built-in hero loops (2026-11-23). On a portrait
 * phone the cover crop shows only the centre ~30% of a 16:9 clip, so the phone
 * gets just that strip (406 x 720, ~0.3 MB instead of ~1 MB): sharper, a third
 * of the data, and never a larger paint than the poster, which stays the LCP.
 * A URL from Ajustes (no cut) plays as it is.
 */
const PORTRAIT_CUTS: Record<string, string> = {
  '/assets/video/hero-home.mp4': '/assets/video/hero-home-portrait.mp4',
};

/** The file to play here: the portrait cut on a portrait phone, else the source. */
export function videoForScreen(src: string): string {
  const cut = PORTRAIT_CUTS[src];
  if (!cut || typeof window.matchMedia !== 'function') return src;
  return window.matchMedia('(orientation: portrait) and (max-width: 767px)').matches ? cut : src;
}

/**
 * True when the visitor asked us not to spend their data: Save-Data header,
 * a 2g/3g connection, or reduced motion. Those visitors keep the poster image.
 */
export function shouldSkipVideo(reducedMotion: boolean): boolean {
  if (reducedMotion) return true;
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (!c) return false;
  return c.saveData === true || /^(slow-)?2g$/.test(c.effectiveType ?? '') || c.effectiveType === '3g';
}

interface Props {
  /** Direct MP4/WebM URL from Ajustes (SiteSettings.hero_video_url). Empty = poster only. */
  src: string;
  poster: string;
  /** Defaults to the /assets responsive variants of `poster`; CMS library posters pass their own. */
  posterSrcSet?: string;
  posterAlt: string;
  reducedMotion: boolean;
  /** The video has an audio track: show the sound toggle. Silent loops pass false. Default true. */
  sound?: boolean;
  /** Rendered above the media (headline, CTAs). */
  children: React.ReactNode;
  className?: string;
}

/**
 * Hero with a muted autoplaying video over a poster image (BACKLOG P2-1, refined 2026-08).
 *
 * Behaviour, in the order a browser applies it:
 * 1. The poster <img> is always rendered and is the LCP element — it paints even
 *    if the video never loads, is blocked, or the visitor is on 2G.
 * 2. The video mounts only when the hero is on screen AND the visitor is not on
 *    Save-Data / 2g-3g / reduced motion, so phones on cellular pay nothing.
 * 3. It autoplays muted + playsInline (the only combination iOS and Chrome allow
 *    without a gesture) and fades in once it can actually paint frames.
 * 4. A sound toggle lets people hear the school; the choice is remembered for the
 *    session. Audio never starts on its own — that is a deliberate, one-tap opt-in.
 * 5. Playback pauses when the hero scrolls away or the tab is hidden (battery).
 */
export function HeroVideo({ src, poster, posterSrcSet, posterAlt, reducedMotion, sound = true, children, className = '' }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const wanted = !!src && !shouldSkipVideo(reducedMotion);

  // Mount the video only while the hero is visible (also pauses when it leaves).
  useEffect(() => {
    if (!wanted || !wrapRef.current) return;
    const el = wrapRef.current;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setMounted(true);
        const v = videoRef.current;
        if (!v) return;
        if (e.isIntersecting && !paused) void v.play().catch(() => undefined);
        else v.pause();
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [wanted, paused]);

  // Battery: never keep decoding video in a background tab.
  useEffect(() => {
    const onVis = () => {
      const v = videoRef.current;
      if (!v) return;
      if (document.hidden) v.pause();
      else if (!paused) void v.play().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [paused]);

  const toggleSound = () => {
    const v = videoRef.current;
    if (!v) return;
    const next = !muted;
    v.muted = next;
    if (!next) {
      v.volume = 0.6;
      void v.play().catch(() => undefined);
    }
    setMuted(next);
    try { sessionStorage.setItem(SOUND_KEY, next ? 'off' : 'on'); } catch { /* private mode */ }
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { void v.play().catch(() => undefined); setPaused(false); } else { v.pause(); setPaused(true); }
  };

  return (
    <section ref={wrapRef} className={`relative flex items-end overflow-hidden bg-dark text-white ${className}`}>
      {/* `sizes`: the poster covers a tall box on a portrait phone, so it renders
          about 1.65 screen heights wide, not 100vw. With 100vw the phone took the
          480/960 px file, the browser saw an upscaled (small) image and the 1920 px
          video's first frame became the larger paint: mobile LCP waited for the
          whole video (Lighthouse 12.5 s). The full poster is ~80 kB. */}
      <img
        src={poster}
        srcSet={posterSrcSet ?? assetSrcSet(poster, { full: true })}
        sizes="(orientation: portrait) 165vh, 100vw"
        alt={posterAlt}
        {...{ fetchpriority: 'high' }}
        decoding="async"
        width={1600}
        height={900}
        className="absolute inset-0 h-full w-full object-cover object-center"
      />
      {wanted && mounted && (
        <video
          ref={videoRef}
          className={`absolute inset-0 h-full w-full object-cover object-center transition-opacity duration-700 ${ready ? 'opacity-100' : 'opacity-0'}`}
          src={videoForScreen(src)}
          poster={poster}
          autoPlay
          muted
          loop
          playsInline
          preload="none"
          onCanPlay={() => setReady(true)}
          onError={() => setReady(false)}
          aria-hidden="true"
          tabIndex={-1}
        />
      )}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(180deg, rgba(8,5,22,0.35) 0%, rgba(8,5,22,0.55) 42%, rgba(8,5,22,0.92) 100%)' }}
      />

      {wanted && ready && (
        <div className="absolute bottom-4 right-4 z-10 flex gap-2 sm:bottom-6 sm:right-6">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={paused ? 'Reanudar el video' : 'Pausar el video'}
            className="flex h-11 w-11 items-center justify-center rounded-sm border border-white/25 bg-black/35 text-white backdrop-blur-md transition-colors hover:bg-black/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
          </button>
          {sound && <button
            type="button"
            onClick={toggleSound}
            aria-pressed={!muted}
            aria-label={muted ? 'Activar el sonido del video' : 'Silenciar el video'}
            className="flex h-11 items-center gap-2 rounded-sm border border-white/25 bg-black/35 px-4 text-[13px] font-semibold text-white backdrop-blur-md transition-colors hover:bg-black/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            {muted ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
            <span className="hidden xs:inline">{muted ? 'Activar sonido' : 'Sonido activado'}</span>
          </button>}
        </div>
      )}

      <div className="relative z-10 w-full">{children}</div>
    </section>
  );
}

export default HeroVideo;
