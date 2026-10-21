import { useSearchParams, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Seo } from '@/components/seo/Seo';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { contentApi } from '@/services/api';
import { BlockRenderer } from './BlockRenderer';
import { CmsMediaProvider } from './runtime';
import type { CmsPagePayload } from './published';

export { BlockRenderer, applySnippets, mediaSrcSet } from './BlockRenderer';
export type { CmsPagePayload } from './published';

/** Route element: renders a published CMS page by slug, or the draft when ?preview=<token>. */
export default function CmsPage({ slug: slugProp }: { slug?: string }) {
  const [params] = useSearchParams();
  const { slug: routeSlug } = useParams<{ slug: string }>();
  const preview = params.get('preview');
  const slug = slugProp ?? routeSlug ?? window.location.pathname.replace(/^\//, '').replace(/\/$/, '');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['cms-page', slug, preview],
    queryFn: async () => (preview
      ? (await contentApi.getPagePreviewBySlug(slug, preview)).data
      : (await contentApi.getPage(slug)).data) as CmsPagePayload,
    retry: false,
    staleTime: 60_000,
  });
  if (isLoading) return <div className="flex min-h-[50vh] items-center justify-center"><LoadingSpinner /></div>;
  if (isError || !data) return null;
  return (
    <div>
      <Seo title={data.seo?.title || data.title} description={data.seo?.description || ''} />
      {preview && <div className="sticky top-0 z-40 bg-amber px-4 py-2 text-center text-xs font-bold text-white">Vista previa del borrador: lo que ve aquí aún no está publicado.</div>}
      <CmsMediaProvider media={data.media}>
        <BlockRenderer blocks={data.blocks} />
      </CmsMediaProvider>
    </div>
  );
}
