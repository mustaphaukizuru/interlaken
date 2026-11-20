/** Image refs of CMS props: a media-library id, or a path under /assets (the site's built-in photos). */
import { assetSrcSet } from '@/lib/images';

export const isImageRef = (v: unknown): v is number | string =>
  (typeof v === 'number' && v > 0) || (typeof v === 'string' && v.startsWith('/'));

type Variant = 'thumb' | 'md' | 'lg';
/** Library sizes, smallest first, with their max widths (backend media.VARIANTS). */
const ORDER: Variant[] = ['thumb', 'md', 'lg'];
const WIDTH: Record<Variant, number> = { thumb: 320, md: 960, lg: 1600 };

export interface MediaInfo { width?: number | null; height?: number | null; variants?: string[] }

/**
 * What a published page says about its library images (payload `media`). A
 * photo gets only the sizes it is big enough for (1600 px wide or less has no
 * `lg`), so URLs and srcset are built from what exists. Filled by
 * CmsMediaProvider; without it (editor picker, older payloads) the full set is
 * requested and the server answers a missing size with the next larger one.
 */
const known = new Map<number, MediaInfo>();

export function rememberMedia(media: Record<string, MediaInfo> | undefined): void {
  for (const id in media) if (media[id]?.variants) known.set(Number(id), media[id]);
}

const url = (ref: number, v: string) => `/api/v1/content/media/${ref}/${v}/`;

/** The size actually served for `want`: it, the next larger existing one, or the original. */
function pick(ref: number, want: Variant): string {
  const have = known.get(ref)?.variants;
  return !have ? want : ORDER.slice(ORDER.indexOf(want)).find((v) => have.includes(v)) ?? 'original';
}

export function imageSrc(ref: unknown, variant: Variant = 'lg'): string {
  if (typeof ref === 'number' && ref > 0) return url(ref, pick(ref, variant));
  if (typeof ref === 'string') return ref;
  return '';
}

/** Library images: thumb/md/lg (320/960/1600 w) that exist. Site photos: the -480/-960 files (lib/images). */
export function imageSrcSet(ref: unknown, opts: { full?: boolean } = {}): string | undefined {
  if (typeof ref === 'number' && ref > 0) {
    const max = opts.full ? 1600 : 960;
    const info = known.get(ref);
    const have = info?.variants;
    const w = info?.width || 0;
    // Unknown: the full set (the server falls back). Known: real files, never wider than the photo.
    const sizes = ORDER.filter((v) => WIDTH[v] <= max && (!have || have.includes(v))).map((v) => [url(ref, v), have && w ? Math.min(WIDTH[v], w) : WIDTH[v]] as const);
    // A photo smaller than the largest size wanted is its own top candidate.
    if (have && w <= max && w > (sizes[sizes.length - 1]?.[1] ?? 0)) sizes.push([url(ref, 'original'), w]);
    return sizes.length ? sizes.map(([u, px]) => `${u} ${px}w`).join(', ') : undefined;
  }
  if (typeof ref === 'string') return assetSrcSet(ref, opts);
  return undefined;
}

/** Absolute URL for social previews (og:image): crawlers need the full origin. */
export function absoluteImageUrl(ref: unknown, origin: string): string | undefined {
  if (typeof ref === 'number' && ref > 0) return `${origin}${url(ref, pick(ref, 'lg'))}`;
  if (typeof ref === 'string' && ref.startsWith('/')) return `${origin}${ref}`;
  if (typeof ref === 'string' && ref.startsWith('https://')) return ref;
  return undefined;
}
