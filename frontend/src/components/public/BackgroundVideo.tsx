import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

/**
 * Same rule as HeroVideo's shouldSkipVideo (Save-Data, 2g/3g, reduced motion),
 * kept local on purpose: importing it would split HeroVideo out of the home
 * page's chunk into a shared one and cost the home its JS budget.
 */
function shouldSkipVideo(reduced: boolean): boolean {
  if (reduced) return true;
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (!c) return false;
  return c.saveData === true || /^(slow-)?2g$/.test(c.effectiveType ?? '') || c.effectiveType === '3g';
}

interface Props {
  /** Silent looping MP4 (for example /assets/video/hero-primaria.mp4). Empty = nothing renders. */
  src: string;
  /** The image already painted underneath (the poster); the video fades in over it. */
  poster?: string;
  /** Classes of the <video> (opacity, object position…); it always covers its section. */
  className?: string;
}

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * A muted, looping background video for a section that already shows its
 * photo (level heroes). Same rules as HeroVideo: it mounts only when the
 * section is on screen and the visitor is not on Save-Data, a 2g/3g
 * connection or reduced motion; it pauses off screen and in a hidden tab;
 * it fades in once it can paint, so the photo underneath is the LCP and the
 * fallback. A pause button (WCAG 2.2.2) sits in the section's corner.
 * Place it inside a `relative overflow-hidden` section, after the photo.
 */
export function BackgroundVideo({ src, poster, className = '' }: Props) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [wanted] = useState(() => !!src && !shouldSkipVideo(reducedMotion()));

  useEffect(() => {
    const section = anchorRef.current?.parentElement;
    if (!wanted || !section) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) setMounted(true);
      const v = videoRef.current;
      if (!v) return;
      if (e.isIntersecting && !paused) void v.play().catch(() => undefined);
      else v.pause();
    }, { rootMargin: '200px' });
    io.observe(section);
    return () => io.disconnect();
  }, [wanted, paused]);

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

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { void v.play().catch(() => undefined); setPaused(false); } else { v.pause(); setPaused(true); }
  };

  return (
    <>
      <span ref={anchorRef} hidden />
      {wanted && mounted && (
        <video
          ref={videoRef}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${ready ? '' : '!opacity-0'} ${className}`}
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
      {wanted && ready && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label={paused ? 'Reanudar el video' : 'Pausar el video'}
          className="absolute bottom-4 right-4 z-10 flex h-11 w-11 items-center justify-center rounded-sm border border-white/25 bg-black/35 text-white backdrop-blur-md transition-colors hover:bg-black/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:bottom-6 sm:right-6"
        >
          {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
        </button>
      )}
    </>
  );
}

export default BackgroundVideo;
