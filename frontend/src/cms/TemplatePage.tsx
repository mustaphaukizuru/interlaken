import { useMemo } from 'react';
import { Seo } from '@/components/seo/Seo';
import { BlockRenderer } from './BlockRenderer';
import { CmsMediaProvider } from './runtime';
import { usePublishedPage } from './published';
import { sectionSpec } from './sections';
import { templateBlocks, type PageTemplate } from './sections/types';

/**
 * A public page (docs/CMS-COMPLETION-PLAN.md): the published CMS version when
 * there is one, otherwise the page's template, which is today's design built
 * from the same section components. Either way the markup is the same, so
 * publishing never changes the look, only the content.
 */
export function TemplatePage({ template }: { template: PageTemplate }) {
  const { data, isLoading } = usePublishedPage(template.slug);
  const fallback = useMemo(() => templateBlocks(template, sectionSpec), [template]);
  // Hold the paint until we know whether a published version exists, so the
  // default copy never flashes before the school's edits.
  if (isLoading) return <div className="min-h-[70svh]" aria-busy="true" />;
  const seo = data?.seo ?? {};
  // Pages that never set their own <Seo> keep the per-route defaults of
  // RouteSeo (PublicLayout); only an explicit template or CMS value overrides.
  const title = seo.title || template.seo.title;
  const description = seo.description || template.seo.description;
  const hasSeo = !!(title || description || seo.og_image || template.seo.jsonLd || template.seo.canonical);
  return (
    <>
      {hasSeo && <Seo {...template.seo} title={title} description={description} image={seo.og_image || template.seo.image} />}
      <CmsMediaProvider media={data?.media}>
        <BlockRenderer blocks={data?.blocks ?? fallback} />
      </CmsMediaProvider>
    </>
  );
}

export default TemplatePage;
