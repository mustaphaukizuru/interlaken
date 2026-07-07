/**
 * Seo — declarative per-page <head> tags via react-helmet-async.
 *
 * <RouteSeo /> is dropped once into the public layout and derives title,
 * description and canonical from the current pathname (see ROUTE_META). Pages
 * that need something bespoke (e.g. JSON-LD) can render <Seo /> directly.
 */
import { Helmet } from 'react-helmet-async';
import { useLocation } from 'react-router-dom';
import {
  ROUTE_META,
  SITE_URL,
  SITE_NAME,
  DEFAULT_TITLE,
  DEFAULT_DESCRIPTION,
  OG_IMAGE,
  LOCALE,
} from '@/lib/siteMeta';

export interface SeoProps {
  title?: string;
  description?: string;
  canonical?: string;
  image?: string;
  /** Suppress appending "· Colegio Interlaken" to the title. */
  bareTitle?: boolean;
  /** Optional JSON-LD object(s) rendered as <script type="application/ld+json">. */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  children?: React.ReactNode;
}

export function Seo({
  title,
  description = DEFAULT_DESCRIPTION,
  canonical,
  image = OG_IMAGE,
  bareTitle = false,
  jsonLd,
  children,
}: SeoProps) {
  const fullTitle = !title
    ? DEFAULT_TITLE
    : bareTitle
      ? title
      : `${title} · ${SITE_NAME}`;
  const url = canonical ?? SITE_URL;
  const blocks = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />

      {/* Open Graph */}
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={image} />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:locale" content={LOCALE} />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />

      {blocks.map((block, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(block)}
        </script>
      ))}
      {children}
    </Helmet>
  );
}

/**
 * RouteSeo — resolves metadata for the active public route. Placed once in the
 * PublicLayout so every marketing page gets a correct <title>, description and
 * canonical without per-page boilerplate.
 */
export function RouteSeo() {
  const { pathname } = useLocation();
  const meta = ROUTE_META[pathname];
  const canonical = `${SITE_URL}${pathname === '/' ? '' : pathname}`;

  return (
    <Seo
      title={meta?.title}
      description={meta?.description}
      canonical={canonical}
      bareTitle={pathname === '/'}
    />
  );
}
