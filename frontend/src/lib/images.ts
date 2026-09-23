/**
 * Responsive variants of the static site images (BACKLOG P2-20 / P1-B12).
 * Every image in public/assets ships with a -480 and a -960 variant
 * (generated once with Pillow; regenerate when adding images). Phones then
 * download ~45 KB instead of ~300 KB per card.
 */
/** Originals narrower than 960px were never upscaled, so they have no -960 file. */
const NO_960 = new Set(['/assets/hopscotch', '/assets/primaria-gate', '/assets/secundaria']);

export function assetSrcSet(src: string | undefined, opts: { full?: boolean } = {}): string | undefined {
  if (!src || !/^\/assets\/[^/]+\.webp$/.test(src) || /-(480|960)\.webp$/.test(src)) return undefined;
  const base = src.slice(0, -'.webp'.length);
  // Cards stop at 960w: on a DPR-3 phone a 340px card would otherwise select
  // the full-size file. Heroes pass { full: true } to keep the 1600w candidate.
  const mid = NO_960.has(base) ? `${src} 960w` : `${base}-960.webp 960w`;
  return `${base}-480.webp 480w, ${mid}${opts.full && !NO_960.has(base) ? `, ${src} 1600w` : ''}`;
}

/** Default sizes for card/grid images; hero images pass "100vw". */
export const CARD_SIZES = '(min-width: 1024px) 420px, (min-width: 640px) 50vw, 100vw';
