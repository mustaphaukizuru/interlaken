/**
 * Published CMS page fetch, shared by every public route. `prefetchPublishedPage`
 * is called from the route's lazy() factory (App.tsx) so the request runs in
 * parallel with the page chunk download instead of after it.
 */
import { useQuery } from '@tanstack/react-query';
import { contentApi } from '@/services/api';
import type { Block } from './blocks/registry';

export interface CmsPagePayload {
  slug: string;
  title: string;
  template: string;
  blocks: Block[];
  seo: { title?: string; description?: string; og_image?: number | string; noindex?: boolean };
  published_at: string | null;
  /** Alt text, sizes and existing variants (thumb/md/lg) of the library images the blocks use. */
  media?: Record<string, { alt?: string; width?: number | null; height?: number | null; variants?: string[] }>;
}

/** A CMS answer slower than this counts as «no published page»: the template renders. */
export const CMS_TIMEOUT_MS = 8000;

async function request(slug: string): Promise<CmsPagePayload | null> {
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('cms-timeout')), CMS_TIMEOUT_MS); });
    const page = (await Promise.race([contentApi.getPage(slug), late]).finally(() => clearTimeout(timer))).data as CmsPagePayload;
    // Generic blocks render from their own chunk: start it with the page data.
    if (page?.blocks?.some((b) => !b.type.includes('.'))) void import('./blocks/generic');
    return page;
  } catch {
    // 404 = never published (the template renders); a server or network error,
    // or no answer within CMS_TIMEOUT_MS, degrades the same way.
    return null;
  }
}

const prefetched = new Map<string, Promise<CmsPagePayload | null>>();
/** Prefetches that already answered: the page renders with them on its first render. */
const settled = new Map<string, CmsPagePayload | null>();

export function prefetchPublishedPage(slug: string): void {
  if (prefetched.has(slug) || settled.has(slug)) return;
  prefetched.set(slug, request(slug).then((page) => { if (prefetched.has(slug)) settled.set(slug, page); return page; }));
}

/** One-shot: the prefetch for `slug`, as data when it already answered, else as a promise. */
function takePrefetch(slug: string): { data?: CmsPagePayload | null; promise?: Promise<CmsPagePayload | null> } {
  const promise = prefetched.get(slug);
  prefetched.delete(slug);
  if (settled.has(slug)) {
    const data = settled.get(slug) ?? null;
    settled.delete(slug);
    return { data };
  }
  return { promise };
}

export const publishedPageKey = (slug: string) => ['cms-page', slug, null] as const;

export function usePublishedPage(slug: string | undefined) {
  return useQuery({
    queryKey: publishedPageKey(slug ?? ''),
    queryFn: () => {
      const t = takePrefetch(slug!);
      return t.promise ?? (t.data !== undefined ? Promise.resolve(t.data) : request(slug!));
    },
    // A prefetch that already answered renders on the first pass (no empty frame).
    initialData: () => (slug && settled.has(slug) ? takePrefetch(slug).data : undefined),
    enabled: !!slug,
    retry: false,
    staleTime: 300_000,
  });
}
