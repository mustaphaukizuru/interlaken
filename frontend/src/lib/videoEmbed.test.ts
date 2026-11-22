import { describe, it, expect } from 'vitest';
import { parseVideoUrl, playerCommand } from './videoEmbed';

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

  it('builds a silent looping preview the page can pause', () => {
    const yt = parseVideoUrl('https://youtu.be/z271WfIaPSE')!;
    const q = new URL(yt.previewUrl).searchParams;
    expect(yt.previewUrl.startsWith('https://www.youtube-nocookie.com/embed/z271WfIaPSE?')).toBe(true);
    expect(Object.fromEntries(q)).toMatchObject({ autoplay: '1', mute: '1', playsinline: '1', loop: '1', playlist: 'z271WfIaPSE', controls: '0', enablejsapi: '1', rel: '0' });
    expect(yt.origin).toBe('https://www.youtube-nocookie.com');
    const vm = parseVideoUrl('https://vimeo.com/76979871')!;
    expect(vm.previewUrl).toBe('https://player.vimeo.com/video/76979871?background=1&dnt=1');
    expect(vm.origin).toBe('https://player.vimeo.com');
  });

  it('speaks each player play/pause message', () => {
    expect(JSON.parse(playerCommand('youtube', 'pause'))).toEqual({ event: 'command', func: 'pauseVideo', args: [] });
    expect(JSON.parse(playerCommand('youtube', 'play'))).toEqual({ event: 'command', func: 'playVideo', args: [] });
    expect(JSON.parse(playerCommand('vimeo', 'pause'))).toEqual({ method: 'pause' });
  });
});
