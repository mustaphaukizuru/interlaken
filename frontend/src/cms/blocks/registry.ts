/**
 * CMS block registry (CMS-PLAN phase 2, BACKLOG P3-3). Mirrors
 * backend/apps/content/pages.py BLOCK_SCHEMAS: the editor form is generated
 * from `fields`, the backend validates `required`. Adding a block = one entry
 * here + one component in blocks/*.tsx.
 */
import { registeredSection } from './specs';
import { TABLE_LIMITS, emptyTable } from './table';

/**
 * Field kinds. The stored value never depends on the editor control:
 * `href` is a plain string (a page of the site, https://, mailto:, tel:), the
 * same string a `text` field held before; `form` is a form slug; `link` is
 * `{ label, href }`; `table` is the «Tabla» value (./table). `action` stores
 * nothing: it is a button to a console screen. The editor controls live in
 * cms/editor/fields.
 */
export type FieldKind =
  | 'text' | 'textarea' | 'richtext' | 'image' | 'images' | 'link' | 'items' | 'url' | 'number'
  | 'select' | 'toggle' | 'icon' | 'color' | 'href' | 'form'
  // Editors of their own: the «Tabla» grid, and a button that opens a console
  // screen (`actionHref`), e.g. «Editar precios».
  | 'table' | 'action';

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
  /** Editor: consecutive fields with the same group title render as one collapsible group. */
  group?: string;
  /** Editor (list items): the field sits under «Avanzado», closed by default. */
  advanced?: boolean;
  /** Editor: a key derived from a sibling field (a slug of its text) while it is empty or still derived; `keep` values never change. */
  slugFrom?: { field: string; keep?: string[] };
  /** Editor (select): options read from a list of the same block, e.g. a photo's category from the gallery filters. */
  optionsFrom?: { list: string; value: string; label: string };
  /** Editor (textarea): inline marks this text renders, offered as a toolbar: `**negritas**`, `[texto](/ruta)`. */
  marks?: ('bold' | 'link')[];
  /** Editor (image): narrowest width in px that still looks sharp in this slot. */
  minWidth?: number;
  /** For kind 'table': the most columns, rows and characters per cell (the backend enforces them too). */
  limits?: { columns: number; rows: number; cell: number };
  /** For kind 'action': where the button goes (opens in a new tab, so the draft stays open). Not the `href` kind. */
  actionHref?: string;
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
  { type: 'form', label: 'Formulario', description: 'Un formulario de Formularios, o uno del sitio (ficha de inscripción, contacto, facturación, agendar visita).', fields: [
    { key: 'form', label: 'Formulario', kind: 'form', required: true, hint: 'Elija uno de los formularios del sitio o uno creado en Contenido, Formularios.' },
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
  { type: 'table', label: 'Tabla', description: 'Tabla con encabezados, filas y notas al pie; puede pegar celdas de Excel o Google Sheets.', fields: [
    { key: 'title', label: 'Título', kind: 'text', hint: 'También es el nombre de la tabla para lectores de pantalla.' },
    { key: 'intro', label: 'Introducción', kind: 'textarea' },
    { key: 'table', label: 'Tabla', kind: 'table', required: true, limits: { ...TABLE_LIMITS } },
    { key: 'notes', label: 'Notas al pie', kind: 'textarea', hint: 'Una nota por línea.' },
    { key: 'card', label: 'Mostrar como tarjeta (igual que las tablas de Costos)', kind: 'toggle', group: 'Estilo' },
    { key: 'tone', label: 'Color de la tarjeta', kind: 'select', group: 'Estilo', options: [
      { value: 'green', label: 'Verde' }, { value: 'coral', label: 'Coral' }, { value: 'purple', label: 'Morado' }, { value: 'pink', label: 'Rosa' },
    ] },
    { key: 'icon', label: 'Ícono de la tarjeta', kind: 'icon', group: 'Estilo' },
    { key: 'label', label: 'Etiqueta de la tarjeta', kind: 'text', group: 'Estilo', hint: 'Texto pequeño sobre el título, por ejemplo «Mensual».' },
    { key: 'subtitle', label: 'Subtítulo de la tarjeta', kind: 'text', group: 'Estilo' },
    { key: 'bg', label: 'Fondo de la sección', kind: 'select', group: 'Estilo', options: [{ value: 'cream', label: 'Crema' }, { value: 'white', label: 'Blanco' }] },
  ], defaults: {
    title: 'Nueva tabla', intro: '', table: emptyTable(), notes: '',
    card: true, tone: 'green', icon: 'CircleDollarSign', label: '', subtitle: '', bg: 'cream',
  } },
];

const GENERIC = new Map(BLOCKS.map((b) => [b.type, b]));

/** Editor and checks: the spec of a generic block or of a registered designed section. */
export const blockSpec = (type: string): BlockSpec | undefined => GENERIC.get(type) ?? registeredSection(type);

// The public site needs only these two (./specs), not the generic block catalogue above.
export { registerBlockSpecs, withDefaults } from './specs';
