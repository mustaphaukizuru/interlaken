import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Pause, Play, Volume2 } from 'lucide-react';
import { parseVideoUrl, playerCommand } from '@/lib/videoEmbed';

type Mode = 'poster' | 'preview' | 'full';

/**
 * No preview for visitors who asked us not to spend their data or move things
 * (Save-Data, 2g/3g, reduced motion). Same rule as HeroVideo and BackgroundVideo,
 * kept local on purpose: a shared module becomes its own chunk, listed on the
 * home page's critical path (JS budget).
 */
function skipPreview(): boolean {
  if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (!c) return false;
  return c.saveData === true || /^(slow-)?2g$/.test(c.effectiveType ?? '') || c.effectiveType === '3g';
}

/** YouTube shows its title and buttons for a few seconds after (re)starting. */
const CHROME_SECONDS = 5;
/** Reveal anyway if the player never reports its progress. */
const REVEAL_FALLBACK_MS = 8000;

interface Props {
  url: string;
  /**
   * Start a silent, looping preview when the card scrolls into view. One click
   * («Ver con sonido») restarts it from the beginning with sound and the
   * player's controls. Off by default: the card waits for a click.
   */
  autoplay?: boolean;
  /** Cover photo for the card; default the YouTube thumbnail (or a brand gradient). */
  poster?: { src: string; srcSet?: string };
}

/**
 * The institutional video (SiteSettings.video_url or a CMS block).
 *
 * Without `autoplay` nothing from YouTube/Vimeo loads until the visitor presses
 * play: the card shows its cover photo and a play button.
 *
 * With `autoplay`, the cover shows first; when the card nears the screen a
 * muted, looping, control-less preview mounts underneath it and fades in once
 * YouTube has hidden its own title and buttons (the cover covers them again
 * whenever the preview restarts after leaving the screen or a hidden tab).
 * It has its own pause button (WCAG 2.2.2) and is skipped for Save-Data,
 * 2g/3g and reduced motion (those visitors keep the click-to-play card). The
 * preview is inert: a full-size button over it opens the real player with sound.
 *
 * Unrecognized URLs degrade to a plain external link.
 */
export function VideoEmbed({ url, autoplay = false, poster }: Props) {
  const video = parseVideoUrl(url);
  const provider = video?.provider;
  const origin = video?.origin;
  const boxRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const fullRef = useRef<HTMLIFrameElement>(null);
  const inView = useRef(false);
  const pausedRef = useRef(false);
  const frameLoaded = useRef(false);
  const lastTime = useRef(0);
  const revealAt = useRef<number | null>(CHROME_SECONDS);
  const timers = useRef<number[]>([]);
  const [mode, setMode] = useState<Mode>('poster');
  const [revealed, setRevealed] = useState(false);
  const [paused, setPaused] = useState(false);
  // Decided once per visit: a silent preview only for visitors who did not opt out.
  const [preview] = useState(() => autoplay && !skipPreview());

  const clearTimers = () => {
    timers.current.forEach((id) => window.clearInterval(id));
    timers.current = [];
  };

  const send = useCallback((action: 'play' | 'pause') => {
    const w = previewRef.current?.contentWindow;
    if (w && provider && origin) w.postMessage(playerCommand(provider, action), origin);
  }, [provider, origin]);

  /** (Re)start the preview behind the cover; reveal once YouTube's chrome is gone. */
  const armReveal = useCallback(() => {
    if (provider !== 'youtube') { setRevealed(true); return; }
    revealAt.current = lastTime.current + CHROME_SECONDS;
    if (frameLoaded.current) timers.current.push(window.setTimeout(() => setRevealed(true), REVEAL_FALLBACK_MS));
  }, [provider]);

  const resume = useCallback(() => {
    if (pausedRef.current) return;
    send('play');
    armReveal();
  }, [send, armReveal]);

  // A preview the visitor paused stays as it is (a still frame, no chrome).
  const hold = useCallback(() => {
    send('pause');
    if (provider === 'youtube' && !pausedRef.current) setRevealed(false);
  }, [send, provider]);

  // Mount the preview when the card nears the screen; hold it while away.
  useEffect(() => {
    const el = boxRef.current;
    if (!preview || !provider || mode === 'full' || !el) return;
    const io = new IntersectionObserver(([e]) => {
      inView.current = e.isIntersecting;
      if (e.isIntersecting) { setMode((m) => (m === 'poster' ? 'preview' : m)); resume(); } else hold();
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [preview, provider, mode, resume, hold]);

  // Battery: never keep a preview running in a background tab.
  useEffect(() => {
    if (mode !== 'preview') return;
    const onVis = () => { if (document.hidden) hold(); else if (inView.current) resume(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [mode, resume, hold]);

  // The player's progress reports (YouTube iframe API, see onPreviewLoad).
  useEffect(() => {
    if (mode !== 'preview' || provider !== 'youtube') return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || e.source !== previewRef.current?.contentWindow) return;
      let data: { info?: { currentTime?: unknown } } | null;
      try { data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
      const t = data?.info?.currentTime;
      if (typeof t !== 'number') return;
      const target = revealAt.current;
      // Past the chrome, or the loop wrapped to the start: show the preview.
      if (target !== null && (t >= target || t < target - CHROME_SECONDS - 1)) {
        revealAt.current = null;
        clearTimers();
        setRevealed(true);
      }
      lastTime.current = t;
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [mode, provider, origin]);

  const onPreviewLoad = () => {
    frameLoaded.current = true;
    if (provider !== 'youtube') { setRevealed(true); return; }
    // Ask the player to report its progress (the iframe API handshake), a few
    // times until it listens; reveal after a while even if it never answers.
    const w = previewRef.current?.contentWindow;
    let tries = 0;
    const hello = window.setInterval(() => {
      w?.postMessage(JSON.stringify({ event: 'listening', id: 'interlaken-video', channel: 'widget' }), origin ?? '*');
      if (++tries >= 12) window.clearInterval(hello);
    }, 500);
    timers.current.push(hello, window.setTimeout(() => setRevealed(true), REVEAL_FALLBACK_MS));
  };

  // Stop the handshake and the fallbacks once the preview is gone or the card unmounts.
  useEffect(() => {
    if (mode !== 'preview') clearTimers();
  }, [mode]);
  useEffect(() => clearTimers, []);

  // The click that opened the player moves keyboard focus into it.
  useEffect(() => {
    if (mode === 'full') fullRef.current?.focus();
  }, [mode]);

  if (!video) {
    return (
      <div className="text-center">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-outline focus-visible:ring-2 focus-visible:ring-purple focus-visible:ring-offset-2"
        >
          Ver video institucional <ExternalLink size={16} aria-hidden="true" />
        </a>
      </div>
    );
  }

  // The visitor's own pause/resume acts on the visible preview directly.
  const togglePause = () => {
    pausedRef.current = !paused;
    send(paused ? 'play' : 'pause');
    setPaused(!paused);
  };

  const cover = poster?.src || video.thumbnailUrl;

  return (
    <div className="mx-auto max-w-[880px] overflow-hidden rounded-md bg-cream shadow-card">
      <div ref={boxRef} className="relative aspect-video w-full bg-dark">
        {mode === 'full' ? (
          <iframe
            ref={fullRef}
            src={video.embedUrl}
            title="Video institucional del Colegio Interlaken"
            className="absolute inset-0 h-full w-full border-0"
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : (
          <>
            {mode === 'preview' && (
              // inert: the silent preview is decoration; the button above it is the control.
              <div {...{ inert: '' }} className="absolute inset-0">
                <iframe
                  ref={previewRef}
                  src={video.previewUrl}
                  title="Vista previa sin sonido del video institucional"
                  tabIndex={-1}
                  className="pointer-events-none absolute inset-0 h-full w-full border-0"
                  allow="autoplay; encrypted-media; picture-in-picture"
                  referrerPolicy="strict-origin-when-cross-origin"
                  onLoad={onPreviewLoad}
                />
              </div>
            )}

            {/* The cover sits over the preview and fades away once the preview is clean. */}
            {cover ? (
              <img
                src={cover}
                srcSet={poster?.src ? poster.srcSet : undefined}
                sizes="(min-width: 1024px) 560px, 100vw"
                alt=""
                loading="lazy"
                decoding="async"
                className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${revealed ? 'opacity-0' : ''}`}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <span
                aria-hidden="true"
                className={`absolute inset-0 transition-opacity duration-700 ${revealed ? 'opacity-0' : ''}`}
                style={{ background: 'linear-gradient(135deg, var(--purple) 0%, var(--pink) 100%)' }}
              />
            )}

            <button
              type="button"
              onClick={() => setMode('full')}
              aria-label={mode === 'preview' ? 'Ver el video institucional con sonido' : 'Reproducir el video institucional'}
              className="group absolute inset-0 flex h-full w-full cursor-pointer items-center justify-center focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pink/70 focus-visible:ring-inset"
            >
              {mode === 'preview' ? (
                <>
                  {/* Scrim only under the label, so the preview itself stays bright. */}
                  <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-dark/70 to-transparent" />
                  <span className="absolute bottom-3 left-3 inline-flex min-h-[44px] items-center gap-2 rounded-sm bg-pink px-4 text-sm font-bold text-white shadow-[0_14px_30px_-12px_rgba(0,0,0,0.6)] transition-transform group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100 sm:bottom-4 sm:left-4">
                    <Volume2 size={18} aria-hidden="true" /> Ver con sonido
                  </span>
                </>
              ) : (
                <>
                  {/* Scrim so the play button reads on any cover. */}
                  <span aria-hidden="true" className="absolute inset-0 bg-dark/30 transition-colors group-hover:bg-dark/40" />
                  <span className="relative flex h-[72px] w-[72px] items-center justify-center rounded-md bg-pink text-white shadow-[0_18px_38px_-12px_rgba(0,0,0,0.55)] transition-transform group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100">
                    <Play size={30} fill="currentColor" className="ml-1" aria-hidden="true" />
                  </span>
                </>
              )}
            </button>

            {mode === 'preview' && revealed && (
              <button
                type="button"
                onClick={togglePause}
                aria-label={paused ? 'Reanudar la vista previa' : 'Pausar la vista previa'}
                className="absolute bottom-3 right-3 z-10 flex h-11 w-11 items-center justify-center rounded-sm border border-white/25 bg-black/35 text-white backdrop-blur-md transition-colors hover:bg-black/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:bottom-4 sm:right-4"
              >
                {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default VideoEmbed;
