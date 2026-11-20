/**
 * CMS block registry (CMS-PLAN phase 2, BACKLOG P3-3). Mirrors
 * backend/apps/content/pages.py BLOCK_SCHEMAS: the editor form is generated
 * from `fields`, the backend validates `required`. Adding a block = one entry
 * here + one component in blocks/*.tsx.
 */
import { registeredSection } from './specs';

export type FieldKind =
  | 'text' | 'textarea' | 'richtext' | 'image' | 'images' | 'link' | 'items' | 'url' | 'number'
  | 'select' | 'toggle' | 'icon' | 'color';

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  /** For kind 'items': the sub-fields of each item. */
  item?: FieldSpec[];
  /** For kind 'select'. */
  options?: { value: string; label: string }[];
  hint?: string;
  /**
   * Editor grouping: fields with the same Spanish title show together under
   * one collapsible heading (sections with many texts, e.g. a form's labels
   * and messages). Purely presentational; the stored props are flat.
   */
  group?: string;
}

export interface BlockSpec {
  type: string;
  label: string;
  description: string;
  fields: FieldSpec[];
  /** Designed sections (cms/sections): the page group they come from. Generic blocks have none. */
  group?: string;
  /** Carries application logic (a form, the booking widget): can move, cannot be hidden or deleted. */
  locked?: boolean;
  /** Values a fresh block starts with; missing props fall back to them when rendering. */
  defaults?: Record<string, unknown>;
}

export interface Block {
  id: string;
  type: string;
  props: Record<string, unknown>;
  /** Kept in the draft and versions, never rendered on the site. */
  hidden?: boolean;
}

/** An image prop: a media-library id, or a path under /assets (the site's built-in photos). */
export type ImageRef = number | string;

export const BLOCKS: BlockSpec[] = [
  { type: 'hero', label: 'Portada (hero)', description: 'Título grande sobre imagen o video con botón.', fields: [
    { key: 'title', label: 'Título', kind: 'text', required: true },
    { key: 'subtitle', label: 'Subtítulo', kind: 'textarea' },
    { key: 'image', label: 'Imagen de fondo', kind: 'image' },
    { key: 'cta', label: 'Botón', kind: 'link' },
  ] },
  { type: 'rich_text', label: 'Texto', description: 'Párrafos, listas y enlaces.', fields: [
    { key: 'html', label: 'Contenido', kind: 'richtext', required: true },
  ] },
  { type: 'image', label: 'Imagen', description: 'Una imagen con pie de foto.', fields: [
    { key: 'image', label: 'Imagen', kind: 'image', required: true },
    { key: 'caption', label: 'Pie de foto', kind: 'text' },
  ] },
  { type: 'gallery', label: 'Galería', description: 'Cuadrícula de imágenes con pie.', fields: [
    { key: 'images', label: 'Imágenes', kind: 'images', required: true },
  ] },
  { type: 'feature_grid', label: 'Características', description: 'Tarjetas con ícono, título y texto.', fields: [
    { key: 'title', label: 'Título de sección', kind: 'text' },
    { key: 'items', label: 'Tarjetas', kind: 'items', required: true, item: [
      { key: 'title', label: 'Título', kind: 'text', required: true },
      { key: 'text', label: 'Texto', kind: 'textarea' },
    ] },
  ] },
  { type: 'stats', label: 'Cifras', description: 'Banda de números (alumnos, maestros, años).', fields: [
    { key: 'items', label: 'Cifras', kind: 'items', required: true, item: [
      { key: 'value', label: 'Valor', kind: 'text', required: true },
      { key: 'label', label: 'Etiqueta', kind: 'text', required: true },
    ] },
  ] },
  { type: 'cta_band', label: 'Llamado a la acción', description: 'Franja de color con título y botón.', fields: [
    { key: 'title', label: 'Título', kind: 'text', required: true },
    { key: 'text', label: 'Texto', kind: 'textarea' },
    { key: 'cta', label: 'Botón', kind: 'link', required: true },
  ] },
  { type: 'faq', label: 'Preguntas frecuentes', description: 'Acordeón de preguntas y respuestas.', fields: [
    { key: 'items', label: 'Preguntas', kind: 'items', required: true, item: [
      { key: 'q', label: 'Pregunta', kind: 'text', required: true },
      { key: 'a', label: 'Respuesta', kind: 'textarea', required: true },
    ] },
  ] },
  { type: 'video', label: 'Video', description: 'YouTube o Vimeo.', fields: [
    { key: 'url', label: 'URL del video', kind: 'url', required: true },
  ] },
  { type: 'form', label: 'Formulario', description: 'Un formulario de Formularios, o uno del sitio (pre-registro, contacto, facturación, agendar visita).', fields: [
    { key: 'form', label: 'Formulario (slug)', kind: 'text', required: true, hint: 'El slug que aparece en Formularios, o pre-registro / contacto / facturacion / agendar-visita.' },
  ] },
  { type: 'timeline', label: 'Línea de tiempo', description: 'Hitos por año.', fields: [
    { key: 'items', label: 'Hitos', kind: 'items', required: true, item: [
      { key: 'year', label: 'Año', kind: 'text', required: true },
      { key: 'title', label: 'Título', kind: 'text', required: true },
      { key: 'text', label: 'Texto', kind: 'textarea' },
    ] },
  ] },
  { type: 'levels_cards', label: 'Niveles educativos', description: 'Tarjetas de Preescolar, Primaria y Secundaria (automático).', fields: [] },
  { type: 'testimonials', label: 'Testimonios', description: 'Muestra los testimonios publicados (automático).', fields: [] },
  { type: 'map_contact', label: 'Mapa y contacto', description: 'Dirección, teléfono y Cómo llegar (automático).', fields: [] },
  { type: 'pricing_table', label: 'Costos', description: 'Tabla de costos del ciclo (automático).', fields: [] },
  { type: 'open_school_events', label: 'Clases abiertas', description: 'Próximas clases abiertas con lugares disponibles (automático).', fields: [] },
  { type: 'calendar', label: 'Calendario', description: 'Próximas fechas del calendario escolar (automático).', fields: [] },
  { type: 'sep_incorporation', label: 'Incorporación SEP', description: 'Registros oficiales (automático).', fields: [] },
];

const GENERIC = new Map(BLOCKS.map((b) => [b.type, b]));

/** Editor and checks: the spec of a generic block or of a registered designed section. */
export const blockSpec = (type: string): BlockSpec | undefined => GENERIC.get(type) ?? registeredSection(type);

// The public site needs only these two (./specs), not the generic block catalogue above.
export { registerBlockSpecs, withDefaults } from './specs';
