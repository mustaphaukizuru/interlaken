import { type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { contentApi } from '@/services/api';
import { Seo } from '@/components/seo/Seo';
import { BlockRenderer, type CmsPagePayload } from './CmsPage';

/**
 * Wraps a hard-coded public page (BACKLOG P3-5). If a *published* CMS page
 * exists for this path, it replaces the TSX; otherwise the TSX renders as
 * before. Lets the school take over pages one by one without a deploy, and
 * lets us delete the TSX once each port is validated.
 */
export function CmsOverride({ slug, children }: { slug?: string; children: ReactNode }) {
  const { pathname } = useLocation();
  const key = slug ?? pathname.replace(/^\//, '').replace(/\/$/, '');
  const { data, isLoading } = useQuery({
    queryKey: ['cms-page', key, null],
    queryFn: async () => { try { return (await contentApi.getPage(key)).data as CmsPagePayload; } catch { return null; } },
    enabled: !!key,
    retry: false,
    staleTime: 300_000,
  });
  if (!key || isLoading || !data) return isLoading ? null : <>{children}</>;
  return (
    <div>
      <Seo title={data.seo?.title || data.title} description={data.seo?.description || ''} />
      <BlockRenderer blocks={data.blocks} />
    </div>
  );
}

export default CmsOverride;
