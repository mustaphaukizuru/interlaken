import type { ComponentType } from 'react';
import type { Block, BlockSpec } from '../blocks/registry';

/** A designed section: one real section of a public page, its markup and its editable props. */
export interface SectionSpec extends BlockSpec {
  group: string;
  component: ComponentType<any>;
  defaults: Record<string, unknown>;
}

/**
 * Head extras of a template, passed to <Seo> under the school's published SEO.
 * Title and description of a ROUTED page belong in lib/routeMeta.ts ROUTE_META
 * (one table for the browser, the server-rendered HTML and the sitemap); set
 * them here only for pages that have no route of their own (the 404 page).
 */
export interface TemplateSeo {
  title?: string;
  description?: string;
  noindex?: boolean;
  /** Passed through to <Seo> when the page renders its template (canonical, JSON-LD...). */
  canonical?: string;
  image?: string;
  bareTitle?: boolean;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
}

/** The default content of a public page: today's design, editable from the CMS. */
export interface PageTemplate {
  slug: string;
  path: string;
  title: string;
  group: string;
  seo: TemplateSeo;
  /**
   * Sections in order: a type, or a type with props that override its defaults
   * on this page only (the three Nivel pages share sections, not content).
   * Block ids are `${slug}-${n}` so versions diff cleanly.
   */
  sections: (string | TemplateEntry)[];
  /**
   * App screens (sign-in, one-time links) never wait for the CMS: the
   * built-in copy paints at once and the school's edits replace it when the
   * published page arrives. Every other page holds its first paint until it
   * knows whether a published version exists (no flash of the default copy).
   */
  paintAtOnce?: boolean;
}

export interface TemplateEntry { type: string; props?: Record<string, unknown>; hidden?: boolean }

/** A section module (cms/sections/<group>.tsx) exports these. */
export interface SectionModule {
  sections: SectionSpec[];
  templates: PageTemplate[];
}

const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** Template → blocks with the section defaults materialised (what a new draft starts as). */
export function templateBlocks(t: PageTemplate, specOf: (type: string) => SectionSpec | BlockSpec | undefined): Block[] {
  return t.sections.map((entry, i) => {
    const e: TemplateEntry = typeof entry === 'string' ? { type: entry } : entry;
    const block: Block = { id: `${t.slug}-${i + 1}`, type: e.type, props: clone({ ...(specOf(e.type)?.defaults ?? {}), ...(e.props ?? {}) }) };
    if (e.hidden) block.hidden = true;
    return block;
  });
}
