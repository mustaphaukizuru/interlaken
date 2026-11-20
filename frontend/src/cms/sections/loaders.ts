/**
 * Lazy loaders of every designed-section group (cms/sections/<group>.tsx).
 * Kept out of the registry (./index) so a public page, which imports its own
 * group statically, does not ship the table of every other page's chunk.
 * Used by the editor (all groups) and by BlockRenderer when a published page
 * uses a section from another page's group.
 */
import { isGroupLoaded, registerModule } from './index';
import type { SectionModule } from './types';

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
  visita: 'Agendar visita', contacto: 'Contacto', pagos: 'Pagos',
  plataformas: 'Plataformas', facturacion: 'Facturación', aviso: 'Aviso de privacidad', notfound: 'Página no encontrada',
};

export async function loadGroup(group: string): Promise<void> {
  if (isGroupLoaded(group)) return;
  const loader = SECTION_LOADERS[group];
  if (!loader) return;
  registerModule(await loader());
}

/** Editor and manifest: every group. */
export async function loadAllGroups(): Promise<void> {
  await Promise.all(Object.keys(SECTION_LOADERS).map(loadGroup));
}

