/**
 * videoEmbed.ts — pure parsing for the admin-editable institutional video
 * (SiteSettings.video_url). Recognizes the URL shapes the school is likely to
 * paste; anything else falls back to a plain external link in the UI.
 */

export interface ParsedVideo {
  provider: 'youtube' | 'vimeo';
  id: string;
  /** Privacy-friendly embed: youtube-nocookie / Vimeo player with dnt. */
  embedUrl: string;
  /** Poster for the click-to-load placeholder; null when not derivable (Vimeo). */
  thumbnailUrl: string | null;
}

/** YouTube IDs are 11 chars today; accept a small range to be future-safe. */
const YT_ID = /^[A-Za-z0-9_-]{6,20}$/;

/**
 * Parse a YouTube (watch?v=, youtu.be, shorts, embed, live) or Vimeo URL.
 * Returns null for anything unrecognized — the caller renders a plain link.
 */
export function parseVideoUrl(raw: string): ParsedVideo | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.replace(/^www\./i, '').toLowerCase();

  let ytId: string | null = null;
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') {
      ytId = url.searchParams.get('v');
    } else {
      const match = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/);
      if (match) ytId = match[1];
    }
  } else if (host === 'youtu.be') {
    ytId = url.pathname.split('/')[1] || null;
  }
  if (ytId && YT_ID.test(ytId)) {
    return {
      provider: 'youtube',
      id: ytId,
      embedUrl: `https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&rel=0`,
      thumbnailUrl: `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`,
    };
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const match = url.pathname.match(/^\/(?:video\/)?(\d{6,12})(?:$|\/)/);
    if (match) {
      return {
        provider: 'vimeo',
        id: match[1],
        embedUrl: `https://player.vimeo.com/video/${match[1]}?autoplay=1&dnt=1`,
        thumbnailUrl: null,
      };
    }
  }

  return null;
}
