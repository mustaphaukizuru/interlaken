import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import NotFoundPage from '@/pages/public/NotFoundPage';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { contentApi } from '@/services/api';
import { BlockRenderer, type CmsPagePayload } from './CmsPage';
import { Seo } from '@/components/seo/Seo';

/**
 * Catch-all: if a published CMS page exists for this path, render it; else 404.
 * Lets the school create new landing pages (e.g. /verano) without a deploy.
 */
export default function CmsOrNotFound() {
  const { pathname } = useLocation();
  const slug = pathname.replace(/^\//, '').replace(/\/$/, '');
  const { data, isLoading } = useQuery({
    queryKey: ['cms-page', slug, null],
    queryFn: async () => (await contentApi.getPage(slug)).data as CmsPagePayload,
    enabled: !!slug && !slug.includes('/'),
    retry: false,
    staleTime: 60_000,
  });
  if (isLoading) return <div className="flex min-h-[50vh] items-center justify-center"><LoadingSpinner /></div>;
  if (!data) return <NotFoundPage />;
  return (
    <div>
      <Seo title={data.seo?.title || data.title} description={data.seo?.description || ''} />
      <BlockRenderer blocks={data.blocks} />
    </div>
  );
}
