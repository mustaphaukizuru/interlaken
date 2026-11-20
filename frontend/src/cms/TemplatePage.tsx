import { useMemo } from 'react';
import { Seo } from '@/components/seo/Seo';
import { BlockRenderer } from './BlockRenderer';
import { CmsMediaProvider } from './runtime';
import { absoluteImageUrl } from './media';
import { SITE_URL } from '@/lib/siteMeta';
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
  // default copy never flashes before the school's edits. The placeholder
  // fills the screen so the footer stays below the fold meanwhile (the same
  // rule as `.route-enter:empty` in index.css; e2e/layout-shift.spec.ts).
  // App screens (template.paintAtOnce) paint the built-in copy at once instead.
  if (isLoading && !template.paintAtOnce) return <div className="min-h-screen" aria-busy="true" />;
  const seo = data?.seo ?? {};
  // Per-route defaults come from ROUTE_META via RouteSeo (PublicLayout); the
  // template adds only what the table cannot know (JSON-LD, the 404 page's own
  // title and noindex), and the school's published SEO wins over both.
  return (
    <>
      <Seo {...template.seo} />
      <Seo
        priority={2}
        title={seo.title || undefined}
        description={seo.description || undefined}
        image={absoluteImageUrl(seo.og_image, SITE_URL) || undefined}
        noindex={seo.noindex || undefined}
      />
      <CmsMediaProvider media={data?.media}>
        <BlockRenderer blocks={data?.blocks ?? fallback} />
      </CmsMediaProvider>
    </>
  );
}

export default TemplatePage;
