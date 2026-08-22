/**
 * CMS block registry (CMS-PLAN phase 2, BACKLOG P3-3). Mirrors
 * backend/apps/content/pages.py BLOCK_SCHEMAS: the editor form is generated
 * from `fields`, the backend validates `required`. Adding a block = one entry
 * here + one component in blocks/*.tsx.
 */
export type FieldKind = 'text' | 'textarea' | 'richtext' | 'image' | 'images' | 'link' | 'items' | 'url' | 'number';

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  /** For kind 'items': the sub-fields of each item. */
  item?: FieldSpec[];
  hint?: string;
}

export interface BlockSpec {
  type: string;
  label: string;
  description: string;
  fields: FieldSpec[];
}

export interface Block {
  id: string;
  type: string;
  props: Record<string, unknown>;
}

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
  { type: 'calendar', label: 'Calendario', description: 'Próximas fechas del calendario escolar (automático).', fields: [] },
  { type: 'sep_incorporation', label: 'Incorporación SEP', description: 'Registros oficiales (automático).', fields: [] },
];

export const blockSpec = (type: string) => BLOCKS.find((b) => b.type === type);
