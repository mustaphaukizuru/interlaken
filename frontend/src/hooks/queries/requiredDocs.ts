import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { adminKeys } from './keys';
import { listPublicRequiredDocs, publicRequiredDocsQuery, type LevelCode, type DocKind, type PublicRequiredDoc } from './requiredDocsPublic';

export type { DocKind, LevelCode, PublicRequiredDoc, PublicRequiredDocs } from './requiredDocsPublic';

// = hooks/queries/admissions REG_ENTITY. Not imported: that module pulls the
// Data Ops hooks into the public pages that read this one.
const REG_ENTITY = 'registrations';

/**
 * Required documents by school level (Fase 4): the one list the console edits
 * (Admin → Admisiones → Documentos requeridos), the public «Documentación»
 * page, the staff checklist of a registration and the family's upload page.
 * Backend: apps/admissions/required_docs_views.py.
 */

/** Computed status of one document of a registration (required_docs.py). */
export type DocStatus = 'no_aplica' | 'entregado_fisico' | 'aprobado' | 'en_revision' | 'rechazado' | 'falta';
export type ManualState = 'entregado_fisico' | 'no_aplica';
export type FileStatus = 'pending' | 'approved' | 'rejected';

/** A row of the console list. */
export interface RequiredDoc extends PublicRequiredDoc {
  id: number;
  active: boolean;
  order: number;
  upload_count: number;
  created_at: string;
  updated_at: string;
}

export type RequiredDocWrite = Pick<RequiredDoc,
  'name' | 'description' | 'physical_note' | 'levels' | 'multiple_files' | 'link_url' | 'link_label' | 'active'>;

export interface ChecklistFile {
  id: number;
  required_key: string | null;
  doc_type: string;
  filename: string;
  file_size: number;
  uploaded_at: string;
  status: FileStatus;
  review_note: string;
  download_url: string;
}

export interface ChecklistItem {
  id: number;
  key: string;
  name: string;
  description: string;
  physical_note: string;
  kind: DocKind;
  multiple_files: boolean;
  link_url: string;
  link_label: string;
  status: DocStatus;
  status_label: string;
  satisfied: boolean;
  reasons: string[];
  files: ChecklistFile[];
  /** The office's «Entregado en físico» / «No aplica» (note and author for staff only). */
  manual: { state: ManualState; state_label: string; note?: string; updated_at?: string; updated_by?: string } | null;
  can_upload: boolean;
}

export interface ChecklistCounts {
  total: number;
  done: number;
  approved: number;
  physical: number;
  not_applicable: number;
  in_review: number;
  rejected: number;
  missing: number;
}

export interface Checklist {
  registration: number;
  child_name: string;
  level: LevelCode | '';
  level_label: string;
  ficha_submitted: boolean;
  items: ChecklistItem[];
  other_files: ChecklistFile[];
  counts: ChecklistCounts;
  complete: boolean;
  missing: string[];
  parent_name?: string;
  parent_email?: string;
  whatsapp_phone?: string;
}

/** GET register/<id>/documents/list/ (the family's page). */
export interface FamilyChecklist {
  registration: number;
  child_name: string;
  level: LevelCode | '';
  level_label: string;
  ficha_submitted: boolean;
  items: ChecklistItem[];
  counts: ChecklistCounts;
  complete: boolean;
  limits: { max_bytes: number; extensions: string[]; max_files: number };
}

export interface ReminderResult {
  channel: 'email' | 'whatsapp';
  sent_to: string;
  missing: string[];
  text: string;
  whatsapp_text?: string;
  whatsapp_phone?: string;
  upload_url?: string;
}

const session = (token?: string) => (token ? { 'X-Session-Token': token } : {});

export const requiredDocsApi = {
  listAdmin: () => api.get<RequiredDoc[]>('/admissions/admin/required-documents/'),
  create: (data: RequiredDocWrite) => api.post<RequiredDoc>('/admissions/admin/required-documents/', data),
  update: (id: number, data: Partial<RequiredDocWrite>) => api.patch<RequiredDoc>(`/admissions/admin/required-documents/${id}/`, data),
  remove: (id: number) => api.delete(`/admissions/admin/required-documents/${id}/`),
  reorder: (ids: number[]) => api.post<RequiredDoc[]>('/admissions/admin/required-documents/reorder/', { ids }),

  checklist: (registrationId: number) => api.get<Checklist>(`/admissions/admin/register/${registrationId}/checklist/`),
  setState: (registrationId: number, key: string, state: ManualState, note = '') =>
    api.put<Checklist>(`/admissions/admin/register/${registrationId}/checklist/${key}/state/`, { state, note }),
  clearState: (registrationId: number, key: string) =>
    api.delete<Checklist>(`/admissions/admin/register/${registrationId}/checklist/${key}/state/`),
  remind: (registrationId: number, channel: 'email' | 'whatsapp') =>
    api.post<ReminderResult>(`/admissions/admin/register/${registrationId}/checklist/reminder/`, { channel }),
  /** Approve / reject (the note is required to reject) one file. */
  reviewFile: (fileId: number, status: FileStatus, note = '') =>
    api.patch(`/admissions/documents/${fileId}/verify/`, { status, review_note: note }),
  /** Authenticated download (prod serves no /media/): the caller saves the blob. */
  downloadFile: (fileId: number) => api.get<Blob>(`/admissions/documents/${fileId}/download/`, { responseType: 'blob' }),

  listPublic: listPublicRequiredDocs,

  familyList: (registrationId: number, sessionToken?: string) =>
    api.get<FamilyChecklist>(`/admissions/register/${registrationId}/documents/list/`, { headers: session(sessionToken) }),
  /** One file to one document (`replaces`: a rejected file of a several-files document). */
  upload: (registrationId: number, file: File, key: string, opts: {
    sessionToken?: string; replaces?: number; onProgress?: (percent: number) => void;
  } = {}) => {
    const form = new FormData();
    form.append('file', file);
    form.append('required_key', key);
    if (opts.replaces) form.append('replaces', String(opts.replaces));
    return api.post(`/admissions/register/${registrationId}/documents/`, form, {
      headers: { 'Content-Type': 'multipart/form-data', ...session(opts.sessionToken) },
      onUploadProgress: (e) => {
        if (opts.onProgress && e.total) opts.onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
      },
    });
  },
  /** «Pedir un enlace nuevo» from a used or expired link: always the same answer;
   *  a link goes only to the address on file (`registration` = the page's rid). */
  requestNewLink: (email: string, registration?: number | null) =>
    api.post<{ detail: string }>('/admissions/documents/new-link/', registration ? { email, registration } : { email }),
};

export const REQUIRED_DOCS_ENTITY = 'required-documents';
export const checklistKey = (registrationId: number) => [...adminKeys.entity(REG_ENTITY), 'checklist', registrationId] as const;

export function useAdminRequiredDocs() {
  return useQuery({
    queryKey: adminKeys.list(REQUIRED_DOCS_ENTITY, null),
    queryFn: async () => (await requiredDocsApi.listAdmin()).data,
  });
}

export function useRegistrationChecklist(registrationId: number | null) {
  return useQuery({
    queryKey: checklistKey(registrationId ?? 0),
    queryFn: async () => (await requiredDocsApi.checklist(registrationId!)).data,
    enabled: registrationId != null,
  });
}

/** Writes on the console list refresh it and the public list. */
export function useRequiredDocsInvalidate() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: adminKeys.entity(REQUIRED_DOCS_ENTITY) }),
    qc.invalidateQueries({ queryKey: publicRequiredDocsQuery.queryKey }),
  ]);
}

/** Manual state set/clear answer with the new checklist: put it in the cache, refresh the lists. */
export function useChecklistState(registrationId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, state, note }: { key: string; state: ManualState | null; note?: string }) =>
      state ? requiredDocsApi.setState(registrationId, key, state, note) : requiredDocsApi.clearState(registrationId, key),
    onSuccess: ({ data }) => {
      qc.setQueryData(checklistKey(registrationId), data);
      void refreshBoards(qc);
    },
  });
}

/** The inscripciones list, the pipeline and the Expediente (its documents gate) show document counters. */
export function refreshBoards(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: [...adminKeys.entity(REG_ENTITY), 'list'] }),
    qc.invalidateQueries({ queryKey: ['admissions-pipeline'] }),
    qc.invalidateQueries({ queryKey: adminKeys.entity('cases') }),
  ]);
}
