import { Link, useSearchParams, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Seo } from '@/components/seo/Seo';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { contentApi } from '@/services/api';
import { BlockRenderer } from './BlockRenderer';
import { CmsMediaProvider } from './runtime';
import { CmsPreviewProvider } from './preview';
import { absoluteImageUrl } from './media';
import { SITE_URL } from '@/lib/siteMeta';
import { isPagePayload } from './published';

export { BlockRenderer } from './BlockRenderer';
export type { CmsPagePayload } from './published';

/** Route element: renders a published CMS page by slug, or the draft when ?preview=<token>. */
export default function CmsPage({ slug: slugProp }: { slug?: string }) {
  const [params] = useSearchParams();
  const { slug: routeSlug } = useParams<{ slug: string }>();
  const preview = params.get('preview');
  const slug = slugProp ?? routeSlug ?? window.location.pathname.replace(/^\//, '').replace(/\/$/, '');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['cms-page', slug, preview],
    queryFn: async () => {
      const { data: body } = preview ? await contentApi.getPagePreviewBySlug(slug, preview) : await contentApi.getPage(slug);
      // A 204 (a page of the site with nothing published) has no body: null, as published.ts answers.
      return isPagePayload(body) ? body : null;
    },
    retry: false,
    staleTime: 60_000,
  });
  if (isLoading) return <div className="flex min-h-[50vh] items-center justify-center"><LoadingSpinner /></div>;
  // An unknown /p/<slug> says so (a blank page looked broken); kept inline, this
  // module ships with the home page and the full 404 page would weigh on it.
  if (isError || !data) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center px-5 text-center">
        <Seo noindex title="Página no encontrada" />
        <h1 className="font-head text-fluid-2xl font-bold text-ink">Página no encontrada</h1>
        <p className="mt-2 text-muted">La página que busca no existe o ya no está publicada.</p>
        <Link to="/" className="btn-outline mt-6 min-h-[44px]">Ir al inicio</Link>
      </div>
    );
  }
  return (
    <div>
      <Seo priority={2} title={data.seo?.title || data.title} description={data.seo?.description || undefined}
        image={absoluteImageUrl(data.seo?.og_image, SITE_URL) || undefined} noindex={data.seo?.noindex || !!preview || undefined} />
      {preview && <div className="sticky top-0 z-sticky bg-amber px-4 py-2 text-center text-xs font-bold text-white">Vista previa del borrador: lo que ve aquí aún no está publicado.</div>}
      {/* One h1 per page: a page built without a hero block still gets its title as the h1. */}
      {!data.blocks?.some((b) => b.type === 'hero' || String(b.type).endsWith('.hero')) && (
        <h1 className="sr-only">{data.title}</h1>
      )}
      <CmsMediaProvider media={data.media}>
        {/* A draft preview shows the app screens (sign-in, invitation links) in their sample state. */}
        {preview ? <CmsPreviewProvider><BlockRenderer blocks={data.blocks} /></CmsPreviewProvider> : <BlockRenderer blocks={data.blocks} />}
      </CmsMediaProvider>
    </div>
  );
}
