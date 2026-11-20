import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import NotFoundPage from '@/pages/public/NotFoundPage';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { contentApi } from '@/services/api';
import { BlockRenderer } from './BlockRenderer';
import { CmsMediaProvider } from './runtime';
import { absoluteImageUrl } from './media';
import { SITE_URL } from '@/lib/siteMeta';
import { usePublishedPage } from './published';
import { CMS_SLUG_PATHS } from './slugPaths';
import { Seo } from '@/components/seo/Seo';

/**
 * Catch-all: a CMS redirect wins first, then a published CMS page for this
 * path; otherwise 404. Lets the school create landing pages (e.g. /verano)
 * and retire old URLs without a deploy.
 */
export default function CmsOrNotFound() {
  const { pathname } = useLocation();
  const slug = pathname.replace(/^\//, '').replace(/\/$/, '');
  const key = pathname.replace(/\/$/, '') || '/';
  const { data: redirects, isLoading: loadingRedirects } = useQuery({
    queryKey: ['cms-redirects'],
    queryFn: async () => { try { return (await contentApi.getRedirects()).data; } catch { return {}; } },
    staleTime: 300_000,
  });
  const target = redirects?.[key];
  useEffect(() => { if (target) contentApi.hitRedirect(key).catch(() => undefined); }, [target, key]);
  const lookup = !!slug && !slug.includes('/') && !loadingRedirects && !target;
  const { data, isLoading } = usePublishedPage(lookup ? slug : undefined);
  if (target) {
    if (target.to.startsWith('http')) { window.location.replace(target.to); return null; }
    return <Navigate to={target.to} replace />;
  }
  const canonical = CMS_SLUG_PATHS[slug];
  if (canonical && canonical !== key) return <Navigate to={canonical} replace />;
  if (loadingRedirects || (lookup && isLoading)) return <div className="flex min-h-[50vh] items-center justify-center"><LoadingSpinner /></div>;
  if (!data) return <NotFoundPage />;
  return (
    <div>
      <Seo priority={2} title={data.seo?.title || data.title} description={data.seo?.description || undefined}
        image={absoluteImageUrl(data.seo?.og_image, SITE_URL) || undefined} noindex={data.seo?.noindex || undefined} />
      <CmsMediaProvider media={data.media}>
        <BlockRenderer blocks={data.blocks} />
      </CmsMediaProvider>
    </div>
  );
}
