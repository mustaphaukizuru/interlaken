import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetSrcSet } from './images';

const onDisk = (url: string) => existsSync(resolve(process.cwd(), 'public', decodeURIComponent(url).replace(/^\//, '')));

describe('assetSrcSet', () => {
  it('encodes spaces, so the browser keeps the list; every candidate is a real file (QA 2026-11-23)', () => {
    const out = assetSrcSet('/assets/interlaken-image (1).webp', { full: true })!;
    const candidates = out.split(', ').map((c) => c.split(' '));
    // Each candidate is «url width»: a raw space inside the url would split it.
    expect(candidates.every((c) => c.length === 2)).toBe(true);
    expect(candidates.map((c) => c[1])).toEqual(['480w', '960w', '1600w']);
    expect(candidates.every(([url]) => onDisk(url))).toBe(true);
  });

  it('plain names are unchanged', () => {
    expect(assetSrcSet('/assets/classroom.webp', { full: true })).toBe(
      '/assets/classroom-480.webp 480w, /assets/classroom-960.webp 960w, /assets/classroom.webp 1600w',
    );
  });

  it('every photo with a space in its name has its -480 and -960 files', () => {
    const files = [
      '/assets/interlaken-image (1)-480.webp', '/assets/interlaken-image (1)-960.webp',
      '/assets/interlaken-image (2)-480.webp', '/assets/interlaken-image (2)-960.webp',
      '/assets/interlaken-image (4)-480.webp', '/assets/interlaken-image (4)-960.webp',
      '/assets/interlaken-image (15)-480.webp', '/assets/interlaken-image (15)-960.webp',
    ];
    expect(files.filter((f) => !onDisk(f))).toEqual([]);
  });
});
