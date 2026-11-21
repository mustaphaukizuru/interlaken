/**
 * Pure helpers for the per-level document list (Fase 4): level labels, the
 * status vocabulary shared by the staff checklist and the family's page, and
 * the summary line of the public lists. Data: hooks/queries/requiredDocs.ts.
 */
import type { DocStatus } from '@/hooks/queries/requiredDocs';
import type { LevelCode, PublicRequiredDoc } from '@/hooks/queries/requiredDocsPublic';

export const LEVELS: { value: LevelCode; label: string }[] = [
  { value: 'preescolar', label: 'Preescolar' },
  { value: 'primaria', label: 'Primaria' },
  { value: 'secundaria', label: 'Secundaria' },
];

export const levelLabel = (code: string) => LEVELS.find((l) => l.value === code)?.label ?? '';

/** «Preescolar», «Primaria y Secundaria», «Todos los niveles». */
export function levelsLabel(levels: readonly string[]): string {
  const names = LEVELS.filter((l) => levels.includes(l.value)).map((l) => l.label);
  if (names.length === LEVELS.length) return 'Todos los niveles';
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

/** Tone of each status (chips always pair it with an icon and the words). */
export type StatusTone = 'success' | 'info' | 'warning' | 'error' | 'neutral';
export const STATUS_TONE: Record<DocStatus, StatusTone> = {
  aprobado: 'success',
  entregado_fisico: 'success',
  no_aplica: 'neutral',
  en_revision: 'info',
  rechazado: 'error',
  falta: 'warning',
};
/** Staff wording (the family page takes its words from the CMS). */
export const STATUS_LABEL: Record<DocStatus, string> = {
  aprobado: 'Aprobado',
  entregado_fisico: 'Entregado en físico',
  no_aplica: 'No aplica',
  en_revision: 'En revisión',
  rechazado: 'Rechazado',
  falta: 'Falta',
};

/** Fills `{total}`, `{online}` (documents with an official online link) and `{nivel}` in a summary line. */
export function docsSummary(template: string, docs: PublicRequiredDoc[], level = ''): string {
  return template
    .replace(/\{total\}/g, String(docs.length))
    .replace(/\{online\}/g, String(docs.filter((d) => d.link_url).length))
    .replace(/\{nivel\}/g, level);
}

/** The documents of one level, in the list's order ('' = every active document). */
export function docsForLevel(docs: PublicRequiredDoc[], level: LevelCode | ''): PublicRequiredDoc[] {
  return level ? docs.filter((d) => d.levels.includes(level)) : docs;
}

/** «2.4 MB», «850 KB». */
export function fileSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
