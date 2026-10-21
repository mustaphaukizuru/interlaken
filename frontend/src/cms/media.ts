/** Image refs of CMS props: a media-library id, or a path under /assets (the site's built-in photos). */
import { assetSrcSet } from '@/lib/images';

export const isImageRef = (v: unknown): v is number | string =>
  (typeof v === 'number' && v > 0) || (typeof v === 'string' && v.startsWith('/'));

export function imageSrc(ref: unknown, variant: 'thumb' | 'md' | 'lg' = 'lg'): string {
  if (typeof ref === 'number' && ref > 0) return `/api/v1/content/media/${ref}/${variant}/`;
  if (typeof ref === 'string') return ref;
  return '';
}

/** Library images: thumb/md/lg (320/960/1600 w). Site photos: the -480/-960 files (lib/images). */
export function imageSrcSet(ref: unknown, opts: { full?: boolean } = {}): string | undefined {
  if (typeof ref === 'number' && ref > 0) {
    const u = (v: string) => `/api/v1/content/media/${ref}/${v}/`;
    return `${u('thumb')} 320w, ${u('md')} 960w${opts.full ? `, ${u('lg')} 1600w` : ''}`;
  }
  if (typeof ref === 'string') return assetSrcSet(ref, opts);
  return undefined;
}

/** Absolute URL for social previews (og:image): crawlers need the full origin. */
export function absoluteImageUrl(ref: unknown, origin: string): string | undefined {
  if (typeof ref === 'number' && ref > 0) return `${origin}/api/v1/content/media/${ref}/lg/`;
  if (typeof ref === 'string' && ref.startsWith('/')) return `${origin}${ref}`;
  if (typeof ref === 'string' && ref.startsWith('https://')) return ref;
  return undefined;
}
