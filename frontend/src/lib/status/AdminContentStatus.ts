import type { SchoolEvent } from '@/services/api';
import type { BadgeVariant } from './importRow';

/** Label/variant maps shared by the Contenido tables, chips and bulk dialogs (Data Ops Phase 8). */

export const EVENT_KINDS: { value: SchoolEvent['kind']; label: string }[] = [
  { value: 'holiday', label: 'Suspensión de clases' },
  { value: 'vacation', label: 'Vacaciones' },
  { value: 'exam', label: 'Evaluaciones' },
  { value: 'event', label: 'Evento escolar' },
  { value: 'meeting', label: 'Junta de padres' },
  { value: 'deadline', label: 'Fecha límite' },
];

export const LEVELS: { value: string; label: string }[] = [
  { value: 'preescolar', label: 'Preescolar' },
  { value: 'primaria', label: 'Primaria' },
  { value: 'secundaria', label: 'Secundaria' },
];

export const levelLabel = (level: string, empty = 'Todos') => LEVELS.find((l) => l.value === level)?.label ?? (level || empty);

export const PUBLISHED_OPTIONS = [
  { value: '1', label: 'Publicados' },
  { value: '0', label: 'Borradores' },
];

export const publishedMeta = (published: boolean): { label: string; variant: BadgeVariant } =>
  published ? { label: 'Publicado', variant: 'success' } : { label: 'Borrador', variant: 'warning' };

/** YYYY-MM-DD → DD/MM/YYYY without a timezone shift (date-only values). */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '';
  const [y, m, d] = value.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : value;
}

export const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** Media upload gate (mirrors the server): size and type errors are shown, never dropped silently. */
export function checkMediaFile(file: File): string | null {
  if (!MEDIA_TYPES.includes(file.type)) return 'Solo imágenes JPG, PNG, WebP o GIF.';
  if (file.size > MEDIA_MAX_BYTES) return `Pesa ${formatBytes(file.size)}; el límite es 10 MB.`;
  return null;
}
