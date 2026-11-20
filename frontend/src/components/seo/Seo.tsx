/**
 * Seo: declarative per-page <head> for the public site.
 *
 * <RouteSeo/> sits once in PublicLayout and resolves the route's entry in
 * ROUTE_META (lib/routeMeta.ts). A page only renders <Seo/> when it needs
 * something the table cannot know: CMS pages (their own title/description),
 * the 404 page (noindex), or extra JSON-LD such as the admissions FAQ.
 *
 * Every mounted <Seo/> registers a partial head; the merged result (higher
 * `priority` wins field by field, JSON-LD blocks add up) is written into the
 * existing tags by applyHead. Registration lives in a layout effect, so when
 * React hides and re-shows a suspended subtree the entry is removed and added
 * back: the failure mode that made react-helmet-async drop the route's tags.
 *
 * The route table is loaded after first paint, out of the entry chunk: the
 * server (backend/apps/core/spa.py) already wrote the first URL's head into
 * the HTML, so until the table arrives that head is the baseline.
 */
import { useEffect, useLayoutEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  OG_IMAGE,
  SITE_NAME,
  TITLE_SUFFIX,
  canonicalFor,
  type HeadData,
} from '@/lib/siteMeta';
import { PAGE_LD_ATTR, applyHead } from './applyHead';

type RouteMetaModule = typeof import('@/lib/routeMeta');

export interface SeoProps {
  title?: string;
  description?: string;
  canonical?: string;
  image?: string;
  /** Suppress appending "· Colegio Interlaken" to the title (a title that already names the school never gets it twice). */
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

/** «Costos · Colegio Interlaken» already carries the site name: appending it again doubled it. */
const namesSite = (title: string) => title.toLowerCase().includes(SITE_NAME.toLowerCase());

const entries: Entry[] = [];
let nextId = 0;
/** The head the server wrote for the first URL of this visit (read once). */
let initial: { path: string; head: HeadData } | null = null;

function readServerHead(): HeadData {
  const meta = (sel: string) => document.head.querySelector<HTMLMetaElement>(sel)?.getAttribute('content') ?? undefined;
  const ld: Record<string, unknown>[] = [];
  document.head.querySelectorAll(`script[${PAGE_LD_ATTR}]`).forEach((s) => {
    try { ld.push(JSON.parse(s.textContent || '{}')); } catch { /* ignore a malformed block */ }
  });
  return {
    title: document.title || DEFAULT_TITLE,
    description: meta('meta[name="description"]') ?? DEFAULT_DESCRIPTION,
    canonical: document.head.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? canonicalFor(window.location.pathname),
    image: meta('meta[property="og:image"]') ?? OG_IMAGE,
    robots: meta('meta[name="robots"]'),
    jsonLd: ld,
  };
}

function flush() {
  const path = window.location.pathname;
  if (!initial) initial = { path, head: readServerHead() };
  const ordered = [...entries].sort((a, b) => a.priority - b.priority || a.id - b.id);
  // Before the route table has registered, the first URL keeps what the server wrote.
  const base = !ordered.some((e) => e.priority === 0) && path === initial.path ? initial.head : null;
  const merged: HeadData = base
    ? { ...base, jsonLd: [...base.jsonLd] }
    : { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION, canonical: canonicalFor(path), image: OG_IMAGE, robots: undefined, jsonLd: [] };
  for (const { head } of ordered) {
    if (head.title) merged.title = head.title;
    if (head.description) merged.description = head.description;
    if (head.canonical) merged.canonical = head.canonical;
    if (head.image) merged.image = head.image;
    if (head.noindex !== undefined) merged.robots = head.noindex ? 'noindex' : undefined;
    merged.jsonLd.push(...head.jsonLd);
  }
  if (base) {
    // Page-level JSON-LD replaces the server's copy of the same blocks instead of doubling it.
    const seen = new Set<string>();
    merged.jsonLd = merged.jsonLd.filter((b) => { const k = JSON.stringify(b); return !seen.has(k) && !!seen.add(k); });
  }
  applyHead(merged);
}

/** Test hook: forget every registration and the captured server head. */
export function resetSeoForTests() {
  entries.length = 0;
  initial = null;
}

export function Seo({ title, description, canonical, image, bareTitle = false, noindex, jsonLd, priority = 1 }: SeoProps) {
  const [id] = useState(() => nextId++);
  const blocks = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];
  const full = title ? (bareTitle || namesSite(title) ? title : `${title}${TITLE_SUFFIX}`) : undefined;
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

let routeMeta: RouteMetaModule | null = null;
let loading: Promise<RouteMetaModule> | null = null;

/** Load the route table (RouteSeo does it on mount; tests can await it). */
export function loadRouteMeta(): Promise<RouteMetaModule> {
  loading ??= import('@/lib/routeMeta').then((m) => (routeMeta = m));
  return loading;
}

/**
 * RouteSeo: the route's ROUTE_META entry, at the lowest priority so a page or
 * CMS <Seo/> can refine it. Unlisted paths fall back to the site defaults with
 * a self-referencing canonical.
 */
export function RouteSeo() {
  const { pathname } = useLocation();
  const [table, setTable] = useState(routeMeta);
  useEffect(() => {
    if (!table) void loadRouteMeta().then(setTable);
  }, [table]);
  if (!table) return null;
  const head = table.routeHead(pathname);
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
