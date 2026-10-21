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
  seo: { title?: string; description?: string; og_image?: string; noindex?: boolean };
  published_at: string | null;
  /** Alt text and sizes of the library images the blocks use. */
  media?: Record<string, { alt?: string; width?: number | null; height?: number | null }>;
}

async function request(slug: string): Promise<CmsPagePayload | null> {
  try {
    return (await contentApi.getPage(slug)).data as CmsPagePayload;
  } catch {
    // 404 = never published (the template renders); a network error degrades the same way.
    return null;
  }
}

const prefetched = new Map<string, Promise<CmsPagePayload | null>>();

export function prefetchPublishedPage(slug: string): void {
  if (!prefetched.has(slug)) prefetched.set(slug, request(slug));
}

export const publishedPageKey = (slug: string) => ['cms-page', slug, null] as const;

export function usePublishedPage(slug: string | undefined) {
  return useQuery({
    queryKey: publishedPageKey(slug ?? ''),
    queryFn: () => {
      const p = prefetched.get(slug!);
      if (p) { prefetched.delete(slug!); return p; }
      return request(slug!);
    },
    enabled: !!slug,
    retry: false,
    staleTime: 300_000,
  });
}
