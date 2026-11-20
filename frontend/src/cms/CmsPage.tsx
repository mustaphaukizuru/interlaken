import { Link, useSearchParams, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Seo } from '@/components/seo/Seo';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { contentApi } from '@/services/api';
import { BlockRenderer } from './BlockRenderer';
import { CmsMediaProvider } from './runtime';
import { absoluteImageUrl } from './media';
import { SITE_URL } from '@/lib/siteMeta';
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
  // An unknown /p/<slug> says so (a blank page looked broken); kept inline, this
  // module ships with the home page and the full 404 page would weigh on it.
  if (isError || !data) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center px-5 text-center">
        <h1 className="font-head text-fluid-2xl font-bold text-ink">Página no encontrada</h1>
        <p className="mt-2 text-muted">La página que busca no existe o ya no está publicada.</p>
        <Link to="/" className="btn-outline mt-6 min-h-[44px]">Ir al inicio</Link>
      </div>
    );
  }
  return (
    <div>
      <Seo title={data.seo?.title || data.title} description={data.seo?.description || undefined} image={absoluteImageUrl(data.seo?.og_image, SITE_URL)}>
        {data.seo?.noindex && <meta name="robots" content="noindex" />}
      </Seo>
      {preview && <div className="sticky top-0 z-40 bg-amber px-4 py-2 text-center text-xs font-bold text-white">Vista previa del borrador: lo que ve aquí aún no está publicado.</div>}
      <CmsMediaProvider media={data.media}>
        <BlockRenderer blocks={data.blocks} />
      </CmsMediaProvider>
    </div>
  );
}
