/**
 * Seo: declarative per-page <head> for the public site.
 *
 * <RouteSeo/> sits once in PublicLayout and resolves the route's entry in
 * ROUTE_META (lib/siteMeta.ts). A page only renders <Seo/> when it needs
 * something the table cannot know: CMS pages (their own title/description),
 * the 404 page (noindex), or extra JSON-LD such as the admissions FAQ.
 *
 * Every mounted <Seo/> registers a partial head; the merged result (higher
 * `priority` wins field by field, JSON-LD blocks add up) is written into the
 * existing tags by applyHead. Registration lives in a layout effect, so when
 * React hides and re-shows a suspended subtree the entry is removed and added
 * back: the failure mode that made react-helmet-async drop the route's tags.
 */
import { useLayoutEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  OG_IMAGE,
  TITLE_SUFFIX,
  canonicalFor,
  routeHead,
  type HeadData,
} from '@/lib/siteMeta';
import { applyHead } from './applyHead';

export interface SeoProps {
  title?: string;
  description?: string;
  canonical?: string;
  image?: string;
  /** Suppress appending "· Colegio Interlaken" to the title. */
  bareTitle?: boolean;
  /** Keep this page out of search results. */
  noindex?: boolean;
  /** Extra JSON-LD object(s) for this page. */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  /**
   * Who wins when two <Seo/> are mounted: RouteSeo uses 0, pages default to 1,
   * a published CMS version uses 2.
   */
  priority?: number;
}

type PartialHead = Omit<SeoProps, 'priority' | 'jsonLd' | 'bareTitle'> & { jsonLd: Record<string, unknown>[] };
interface Entry { id: number; priority: number; head: PartialHead }

const entries: Entry[] = [];
let nextId = 0;

function flush() {
  const ordered = [...entries].sort((a, b) => a.priority - b.priority || a.id - b.id);
  const merged: HeadData = {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    canonical: canonicalFor(window.location.pathname),
    image: OG_IMAGE,
    robots: undefined,
    jsonLd: [],
  };
  for (const { head } of ordered) {
    if (head.title) merged.title = head.title;
    if (head.description) merged.description = head.description;
    if (head.canonical) merged.canonical = head.canonical;
    if (head.image) merged.image = head.image;
    if (head.noindex !== undefined) merged.robots = head.noindex ? 'noindex' : undefined;
    merged.jsonLd.push(...head.jsonLd);
  }
  applyHead(merged);
}

/** Test hook: forget every registration. */
export function resetSeoForTests() {
  entries.length = 0;
}

export function Seo({ title, description, canonical, image, bareTitle = false, noindex, jsonLd, priority = 1 }: SeoProps) {
  const [id] = useState(() => nextId++);
  const blocks = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];
  const full = title ? (bareTitle ? title : `${title}${TITLE_SUFFIX}`) : undefined;
  const key = JSON.stringify([full, description, canonical, image, noindex, blocks, priority]);

  useLayoutEffect(() => {
    const entry: Entry = {
      id,
      priority,
      head: { title: full, description, canonical, image, noindex, jsonLd: blocks },
    };
    entries.push(entry);
    flush();
    return () => {
      const i = entries.indexOf(entry);
      if (i >= 0) entries.splice(i, 1);
      flush();
    };
    // `key` captures every input; the values themselves are read from this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return null;
}

/**
 * RouteSeo: the route's ROUTE_META entry, at the lowest priority so a page or
 * CMS <Seo/> can refine it. Unlisted paths fall back to the site defaults with
 * a self-referencing canonical.
 */
export function RouteSeo() {
  const { pathname } = useLocation();
  const head = routeHead(pathname);
  return (
    <Seo
      priority={0}
      bareTitle
      title={head?.title}
      description={head?.description}
      canonical={head?.canonical ?? canonicalFor(pathname)}
      image={head?.image}
      noindex={head ? head.robots === 'noindex' : undefined}
      jsonLd={head?.jsonLd}
    />
  );
}
