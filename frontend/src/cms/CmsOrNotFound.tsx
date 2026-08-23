import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import NotFoundPage from '@/pages/public/NotFoundPage';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { contentApi } from '@/services/api';
import { BlockRenderer, type CmsPagePayload } from './CmsPage';
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
  const { data, isLoading } = useQuery({
    queryKey: ['cms-page', slug, null],
    queryFn: async () => (await contentApi.getPage(slug)).data as CmsPagePayload,
    enabled: !!slug && !slug.includes('/') && !loadingRedirects && !target,
    retry: false,
    staleTime: 60_000,
  });
  if (target) {
    if (target.to.startsWith('http')) { window.location.replace(target.to); return null; }
    return <Navigate to={target.to} replace />;
  }
  if (isLoading || loadingRedirects) return <div className="flex min-h-[50vh] items-center justify-center"><LoadingSpinner /></div>;
  if (!data) return <NotFoundPage />;
  return (
    <div>
      <Seo title={data.seo?.title || data.title} description={data.seo?.description || ''} />
      <BlockRenderer blocks={data.blocks} />
    </div>
  );
}
