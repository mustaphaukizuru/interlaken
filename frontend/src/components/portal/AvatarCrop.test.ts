import { describe, expect, it } from 'vitest';
import { clampOffset } from './AvatarUpload';

// The crop frame is 260 px; a 1000×500 photo «covers» it at 520×260.
const BOX = 260;
const wide = { width: 1000, height: 500 };

describe('clampOffset (photo crop)', () => {
  it('keeps the photo covering the frame: no empty band after a long drag', () => {
    // At zoom 1 the photo is 520 wide and exactly 260 tall: it can slide
    // sideways by 130 px each way and not at all up or down.
    expect(clampOffset(wide, 1, { x: 999, y: 999 }, BOX)).toEqual({ x: 130, y: 0 });
    expect(clampOffset(wide, 1, { x: -999, y: -999 }, BOX)).toEqual({ x: -130, y: 0 });
  });

  it('allows more room as the photo is zoomed in', () => {
    // Zoom 2: 1040×520, so ±390 sideways and ±130 up/down.
    expect(clampOffset(wide, 2, { x: 500, y: -500 }, BOX)).toEqual({ x: 390, y: -130 });
  });

  it('leaves an offset that is already inside the limits untouched', () => {
    expect(clampOffset(wide, 2, { x: 40, y: -20 }, BOX)).toEqual({ x: 40, y: -20 });
  });

  it('re-limits when zooming out after a drag (the band would reappear otherwise)', () => {
    const dragged = clampOffset(wide, 3, { x: 0, y: 250 }, BOX);
    expect(dragged.y).toBe(250);
    expect(clampOffset(wide, 1, dragged, BOX)).toEqual({ x: 0, y: 0 });
  });
});
