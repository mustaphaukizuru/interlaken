import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';

/**
 * The public half of the required-documents data (Fase 4): what the
 * «Documentación» and «Admisiones» pages read. Kept apart from
 * hooks/queries/requiredDocs.ts (console and family API) so those pages only
 * ship this. Backend: GET /admissions/required-documents/.
 */

export type LevelCode = 'preescolar' | 'primaria' | 'secundaria';
export type DocKind = 'upload' | 'ficha';

/** A document as the public pages show it. */
export interface PublicRequiredDoc {
  key: string;
  name: string;
  description: string;
  physical_note: string;
  levels: LevelCode[];
  kind: DocKind;
  multiple_files: boolean;
  link_url: string;
  link_label: string;
}

export interface PublicRequiredDocs {
  level: LevelCode | '';
  levels: { value: LevelCode; label: string; count: number }[];
  results: PublicRequiredDoc[];
}

export const listPublicRequiredDocs = () => api.get<PublicRequiredDocs>('/admissions/required-documents/');

/** One cache entry for every public reader (Documentación, Admisiones). */
export const publicRequiredDocsQuery = {
  queryKey: ['required-documents', 'public'] as const,
  queryFn: async () => (await listPublicRequiredDocs()).data,
  staleTime: 5 * 60_000,
  retry: 1,
};

export function usePublicRequiredDocs() {
  return useQuery(publicRequiredDocsQuery);
}
