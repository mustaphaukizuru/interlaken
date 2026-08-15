import { useState } from 'react';
import { ExternalLink, Play } from 'lucide-react';
import { parseVideoUrl } from '@/lib/videoEmbed';

/**
 * Click-to-load embed for the institutional video (SiteSettings.video_url).
 * No third-party iframe is created until the user presses play — the
 * placeholder is a brand-styled cream card with the YouTube thumbnail when it
 * can be derived. Unrecognized URLs degrade to a plain external link.
 */
export function VideoEmbed({ url }: { url: string }) {
  const [playing, setPlaying] = useState(false);
  const video = parseVideoUrl(url);

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

  return (
    <div className="mx-auto max-w-[880px] overflow-hidden rounded-xl3 border border-line bg-cream shadow-card">
      <div className="relative aspect-video w-full bg-dark">
        {playing ? (
          <iframe
            src={video.embedUrl}
            title="Video institucional del Colegio Interlaken"
            className="absolute inset-0 h-full w-full border-0"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label="Reproducir el video institucional"
            className="group absolute inset-0 flex h-full w-full cursor-pointer items-center justify-center focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pink/70 focus-visible:ring-inset"
          >
            {video.thumbnailUrl ? (
              <img
                src={video.thumbnailUrl}
                alt=""
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <span
                aria-hidden="true"
                className="absolute inset-0"
                style={{ background: 'linear-gradient(135deg, var(--purple) 0%, var(--pink) 100%)' }}
              />
            )}
            {/* Scrim so the play button reads on any thumbnail. */}
            <span
              aria-hidden="true"
              className="absolute inset-0 bg-dark/30 transition-colors group-hover:bg-dark/40"
            />
            <span className="relative flex h-[72px] w-[72px] items-center justify-center rounded-full bg-pink text-white shadow-[0_18px_38px_-12px_rgba(0,0,0,0.55)] transition-transform group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100">
              <Play size={30} fill="currentColor" className="ml-1" aria-hidden="true" />
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

export default VideoEmbed;
