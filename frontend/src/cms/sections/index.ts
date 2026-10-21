/**
 * Designed-section groups (docs/CMS-COMPLETION-PLAN.md). Each public page's
 * sections live in their own module so the public site keeps one chunk per
 * page: a route imports its group statically, any other group a published
 * page uses loads on demand, and the editor loads them all.
 *
 * Adding a page = one module exporting { sections, templates } + one line here.
 */
import { registerBlockSpecs } from '../blocks/registry';
import type { PageTemplate, SectionModule, SectionSpec } from './types';

export const SECTION_LOADERS: Record<string, () => Promise<SectionModule>> = {
  page: () => import('./page'),
  home: () => import('./home'),
  about: () => import('./about'),
  modelo: () => import('./modelo'),
  galeria: () => import('./galeria'),
  nivel: () => import('./nivel'),
  admisiones: () => import('./admisiones'),
  costos: () => import('./costos'),
  documentacion: () => import('./documentacion'),
  preregistro: () => import('./preregistro'),
  visita: () => import('./visita'),
  contacto: () => import('./contacto'),
  calendario: () => import('./calendario'),
  pagos: () => import('./pagos'),
  plataformas: () => import('./plataformas'),
  facturacion: () => import('./facturacion'),
  aviso: () => import('./aviso'),
  notfound: () => import('./notfound'),
};

/** Group labels shown in the editor's «Agregar bloque» dialog. */
export const GROUP_LABELS: Record<string, string> = {
  page: 'Comunes', home: 'Inicio', about: 'Quiénes somos', modelo: 'Modelo educativo', galeria: 'Galería', nivel: 'Niveles',
  admisiones: 'Admisiones', costos: 'Costos', documentacion: 'Documentación', preregistro: 'Pre-registro',
  visita: 'Agendar visita', contacto: 'Contacto', calendario: 'Calendario', pagos: 'Pagos',
  plataformas: 'Plataformas', facturacion: 'Facturación', aviso: 'Aviso de privacidad', notfound: 'Página no encontrada',
};

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

export async function loadGroup(group: string): Promise<void> {
  if (loaded.has(group)) return;
  const loader = SECTION_LOADERS[group];
  if (!loader) return;
  registerModule(await loader());
}

/** Editor and manifest: every group. */
export async function loadAllGroups(): Promise<void> {
  await Promise.all(Object.keys(SECTION_LOADERS).map(loadGroup));
}

export const allSections = (): SectionSpec[] => [...sections.values()];
export const allTemplates = (): PageTemplate[] => [...templates.values()];
export const templateFor = (slug: string): PageTemplate | undefined => templates.get(slug);
