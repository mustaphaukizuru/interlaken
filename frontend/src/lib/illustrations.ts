/**
 * The site's 3D spot illustrations (public/assets/illustrations, Freepik /
 * Magnific, 3D clay style chosen by the owner 2026-11-22). Each one exists at
 * 640 px and 320 px as transparent WebP. Objects only: no people.
 *
 * This module ships with public pages, so it holds only the names. The title
 * matcher lives in ./illustrationTopics (only pages that need it load it) and
 * the editor's Spanish labels in ./illustrationLabels. CMS sections declare
 * the field with `f.illustration(...)`.
 */

export const ILLUSTRATION_NAMES = [
  'informes', 'visita', 'examen', 'inscripcion', 'bilingue', 'academico', 'valores', 'tecnologia',
  'ecologia', 'actividades', 'ciencia', 'teatro', 'lectura', 'oral', 'matematicas', 'tareas',
  'finanzas', 'campamento', 'brujula', 'mundo', 'experimentar', 'crear', 'convivir', 'ritmo',
  'logro', 'ideas', 'proposito', 'comunidad', 'documentos', 'agenda', 'costos', 'pagos',
  'perdido', 'sin-conexion', 'acceso', 'cafeteria', 'mensaje', 'ubicacion', 'arte', 'mochila',
] as const;

export type IllustrationName = (typeof ILLUSTRATION_NAMES)[number];

const KNOWN = new Set<string>(ILLUSTRATION_NAMES);

export const isIllustration = (v: unknown): v is IllustrationName => typeof v === 'string' && KNOWN.has(v);

export const illustrationSrc = (name: IllustrationName, small = false) => `/assets/illustrations/${name}${small ? '-320' : ''}.webp`;
