/**
 * Designed-section registry (docs/CMS-COMPLETION-PLAN.md). Each public page's
 * sections live in their own module so the public site keeps one chunk per
 * page: a route imports its group statically and the module registers here.
 * Any other group a published page uses loads on demand (./loaders), and the
 * editor loads them all.
 *
 * Adding a page = one module exporting { sections, templates } + one line in ./loaders.
 */
import { registerBlockSpecs } from '../blocks/specs';
import type { PageTemplate, SectionModule, SectionSpec } from './types';

const sections = new Map<string, SectionSpec>();
const templates = new Map<string, PageTemplate>();
const loaded = new Set<string>();

/** Called by each section module at import time (and by loadGroup). */
export function registerModule(mod: SectionModule) {
  for (const s of mod.sections) sections.set(s.type, s);
  for (const t of mod.templates) templates.set(t.slug, t);
  if (mod.sections[0]) loaded.add(mod.sections[0].group);
  registerBlockSpecs(mod.sections);
}

export const sectionSpec = (type: string): SectionSpec | undefined => sections.get(type);
export const groupOf = (type: string): string => (type.includes('.') ? type.split('.')[0] : '');
export const isGroupLoaded = (group: string) => loaded.has(group);

export const allSections = (): SectionSpec[] => [...sections.values()];
export const allTemplates = (): PageTemplate[] => [...templates.values()];
export const templateFor = (slug: string): PageTemplate | undefined => templates.get(slug);
