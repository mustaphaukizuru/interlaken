import { describe, it, expect } from 'vitest';
import { parseVideoUrl } from './videoEmbed';

describe('parseVideoUrl (video institucional)', () => {
  it('parses youtube watch?v= URLs into a nocookie embed + thumbnail', () => {
    const v = parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(v).toMatchObject({
      provider: 'youtube',
      id: 'dQw4w9WgXcQ',
      embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0',
      thumbnailUrl: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    });
  });

  it('parses youtu.be and shorts URLs', () => {
    expect(parseVideoUrl('https://youtu.be/dQw4w9WgXcQ')?.id).toBe('dQw4w9WgXcQ');
    expect(parseVideoUrl('https://youtu.be/dQw4w9WgXcQ?t=10')?.id).toBe('dQw4w9WgXcQ');
    expect(parseVideoUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')?.id).toBe('dQw4w9WgXcQ');
    expect(parseVideoUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')?.id).toBe('dQw4w9WgXcQ');
  });

  it('parses Vimeo URLs into the dnt player (no thumbnail derivable)', () => {
    const v = parseVideoUrl('https://vimeo.com/76979871');
    expect(v).toMatchObject({
      provider: 'vimeo',
      id: '76979871',
      embedUrl: 'https://player.vimeo.com/video/76979871?autoplay=1&dnt=1',
      thumbnailUrl: null,
    });
    expect(parseVideoUrl('https://player.vimeo.com/video/76979871')?.id).toBe('76979871');
  });

  it('returns null for unknown or malformed URLs', () => {
    expect(parseVideoUrl('')).toBeNull();
    expect(parseVideoUrl('no-es-una-url')).toBeNull();
    expect(parseVideoUrl('https://example.com/video.mp4')).toBeNull();
    expect(parseVideoUrl('https://www.youtube.com/@colegiointerlaken')).toBeNull();
    expect(parseVideoUrl('ftp://youtu.be/dQw4w9WgXcQ')).toBeNull();
  });
});
