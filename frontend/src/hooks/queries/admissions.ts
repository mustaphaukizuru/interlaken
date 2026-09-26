import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import type { BulkRequest, BulkResult, ExportParams, ImportApi, ImportFormat, ImportUploadOptions } from '@/services/dataOps';
import { importFormData } from '@/services/dataOps';
import { createListHook, useBulk, useExport } from './dataOpsHooks';
import { adminKeys, invalidateEntity } from './keys';

/**
 * Admisiones data layer (Data Ops Phase 4): pre-registros and inscripciones
 * lists, exports, bulk actions, the fair-sheet import and the document bulk
 * review used by the review modal. Query keys: `['admin', 'preregistrations' |
 * 'registrations', …]`; the review modal's detail lives under
 * `['admin', 'registrations', 'detail', id]` so one invalidation refreshes both.
 */
export const PREREG_ENTITY = 'preregistrations';
export const REG_ENTITY = 'registrations';

export interface PreRegistrationRow {
  id: number;
  child_name: string;
  child_dob?: string;
  level: string;
  grade_applying: string;
  cycle?: string;
  parent_name: string;
  parent_email: string;
  parent_phone: string;
  referral_source?: string;
  wants_visit?: boolean;
  status: string;
  notes?: string;
  created_at: string;
  updated_at?: string;
}

export interface RegistrationRow {
  id: number;
  child_name: string;
  level?: string;
  grade_applying: string;
  cycle: string;
  parent1_name: string;
  parent1_email: string;
  parent1_phone: string;
  parent2_email?: string;
  child_curp?: string;
  status: string;
  submitted_at: string | null;
  created_at: string;
  updated_at?: string;
  doc_count: number;
  doc_verified: number;
}

export interface PreRegistrationParams {
  page?: number;
  q?: string;
  status?: string;
  level?: string;
  cycle?: string;
  wants_visit?: string;
  from?: string;
  to?: string;
  ordering?: string;
}

export interface RegistrationParams {
  page?: number;
  q?: string;
  status?: string;
  level?: string;
  cycle?: string;
  documents_pending?: string;
  from?: string;
  to?: string;
  ordering?: string;
}

/** Ordering keys whitelisted by the API (docs/API-LISTING.md; pinned by a backend test). */
export const PREREG_ORDERING_KEYS = ['created_at', 'child', 'level', 'grade', 'status', 'parent'] as const;
export const REG_ORDERING_KEYS = ['created_at', 'updated_at', 'submitted_at', 'child', 'level', 'status'] as const;

export const admissionsDataApi = {
  listPreRegistrations: (params: PreRegistrationParams) => api.get('/admissions/pre-register/', { params }),
  exportPreRegistrations: (params: ExportParams) =>
    api.get<Blob>('/admissions/pre-register/export/', { params, responseType: 'blob' }),
  bulkPreRegistrations: (body: BulkRequest) => api.post<BulkResult>('/admissions/admin/pre-registrations/bulk/', body),
  setPreRegistrationStatus: (id: number, status: string, note?: string) =>
    api.patch(`/admissions/pre-register/${id}/`, note ? { status, note } : { status }),
  invitePreRegistration: (id: number) => api.post(`/admissions/pre-register/${id}/invite/`),

  listRegistrations: (params: RegistrationParams) => api.get('/admissions/register/', { params }),
  exportRegistrations: (params: ExportParams) =>
    api.get<Blob>('/admissions/register/export/', { params, responseType: 'blob' }),
  bulkRegistrations: (body: BulkRequest) => api.post<BulkResult>('/admissions/admin/registrations/bulk/', body),
  bulkDocuments: (body: BulkRequest) => api.post<BulkResult>('/admissions/admin/documents/bulk/', body),
};

/** C4 endpoints of the pre-registros import (fair sign-up sheets). */
export const preRegistrationImportApi: ImportApi = {
  template: (fmt: ImportFormat) =>
    api.get<Blob>('/admissions/admin/pre-registrations/import/template/', { params: { fmt }, responseType: 'blob' }),
  upload: (file: File, opts: ImportUploadOptions) =>
    api.post('/admissions/admin/pre-registrations/import/', importFormData(file, opts), {
      responseType: opts.report ? 'blob' : 'json',
    }),
};

export const usePreRegistrationList = createListHook<PreRegistrationRow, PreRegistrationParams>(
  PREREG_ENTITY,
  admissionsDataApi.listPreRegistrations,
);
export const useRegistrationList = createListHook<RegistrationRow, RegistrationParams>(
  REG_ENTITY,
  admissionsDataApi.listRegistrations,
);

export const usePreRegistrationExport = () => useExport(PREREG_ENTITY, admissionsDataApi.exportPreRegistrations);
export const useRegistrationExport = () => useExport(REG_ENTITY, admissionsDataApi.exportRegistrations);

/** Invites create draft inscripciones, so the pre-registros bulk refreshes both lists. */
export const usePreRegistrationBulk = () => useBulk(PREREG_ENTITY, admissionsDataApi.bulkPreRegistrations, [REG_ENTITY]);
export const useRegistrationBulk = () => useBulk(REG_ENTITY, admissionsDataApi.bulkRegistrations);
/** Document review changes the inscripción's counters and its detail. */
export const useDocumentBulk = () => useBulk(REG_ENTITY, admissionsDataApi.bulkDocuments);

/** Single-row status change (forward transitions; reverse ones go through the bulk dialog for the note). */
export function usePreRegistrationStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, note }: { id: number; status: string; note?: string }) =>
      admissionsDataApi.setPreRegistrationStatus(id, status, note),
    onSuccess: () => invalidateEntity(qc, PREREG_ENTITY),
  });
}

export function usePreRegistrationInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: number; name: string }) => admissionsDataApi.invitePreRegistration(id),
    onSuccess: () => invalidateEntity(qc, PREREG_ENTITY, [REG_ENTITY]),
  });
}

export const registrationDetailKey = (id: number | null) => adminKeys.detail(REG_ENTITY, id ?? 0);
