import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, Play, Pause } from 'lucide-react';
import { assetSrcSet } from '@/lib/images';

const SOUND_KEY = 'interlaken:hero-sound';

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
  posterAlt: string;
  reducedMotion: boolean;
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
export function HeroVideo({ src, poster, posterAlt, reducedMotion, children, className = '' }: Props) {
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
      <img
        src={poster}
        srcSet={assetSrcSet(poster, { full: true })}
        sizes="100vw"
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
          src={src}
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
        <div className="absolute bottom-4 right-4 z-20 flex gap-2 sm:bottom-6 sm:right-6">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={paused ? 'Reanudar el video' : 'Pausar el video'}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-black/35 text-white backdrop-blur-md transition-colors hover:bg-black/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
          </button>
          <button
            type="button"
            onClick={toggleSound}
            aria-pressed={!muted}
            aria-label={muted ? 'Activar el sonido del video' : 'Silenciar el video'}
            className="flex h-11 items-center gap-2 rounded-full border border-white/25 bg-black/35 px-4 text-[13px] font-semibold text-white backdrop-blur-md transition-colors hover:bg-black/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            {muted ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
            <span className="hidden xs:inline">{muted ? 'Activar sonido' : 'Sonido activado'}</span>
          </button>
        </div>
      )}

      <div className="relative z-10 w-full">{children}</div>
    </section>
  );
}

export default HeroVideo;
