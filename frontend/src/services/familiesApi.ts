/**
 * Families (hermanos), admin console (2026-11-13). Backend: accounts/families_admin.py.
 *
 * A family groups siblings: every login of the family (each child's school
 * address, and any Padre/Tutor account) sees every child of it in the portal.
 */
import { api } from './api';
import type { BulkRequest, BulkResult, ExportParams, ListParams } from './dataOps';

export interface FamilyRef {
  id: number;
  name: string;
}

export interface FamilyStudent {
  id: number;
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  student_id: string;
  grade: string;
  group: string;
  status: 'active' | 'on_leave' | 'graduated' | 'withdrawn';
  status_label: string;
  archived: boolean;
  family: FamilyRef | null;
}

export type FamilyLoginKind = 'student' | 'guardian' | 'other';

export interface FamilyLogin {
  id: number;
  email: string;
  full_name: string;
  kind: FamilyLoginKind;
  kind_label: string;
  is_active: boolean;
  last_login: string | null;
  /** First names of the students this login is linked to directly. */
  linked_to: string[];
}

export interface FamilyDetail {
  id: number;
  name: string;
  notes: string;
  created_at: string | null;
  created_by: string;
  students: FamilyStudent[];
  logins: FamilyLogin[];
}

export interface FamilyRow {
  id: number;
  name: string;
  notes: string;
  created_at: string | null;
  children_count: number;
  students: FamilyStudent[];
  logins_count: number;
}

export type FamilyPlanAction = 'create' | 'add' | 'merge' | 'none';

export interface FamilyAccessGain extends FamilyLogin {
  /** Full names of the students this login will start to see. */
  gains: string[];
}

export interface FamilyPlan {
  dry_run: boolean;
  action: FamilyPlanAction;
  /** The existing family everyone ends up in (null: a new one). */
  family: FamilyRef | null;
  name: string;
  students_after: FamilyStudent[];
  adding: FamilyStudent[];
  merging: { id: number; name: string; students: number }[];
  new_access: FamilyAccessGain[];
  /** The family after a committed link. */
  result?: FamilyDetail | null;
}

export interface FamilyLinkBody {
  student_ids: number[];
  family?: number;
  name?: string;
  notify?: boolean;
  dry_run?: boolean;
}

export type SuggestionConfidence = 'alta' | 'media';

export interface FamilySuggestionReason {
  kind: 'guardian' | 'email' | 'phone' | 'surname';
  label: string;
  value: string;
}

export interface FamilySuggestion {
  key: string;
  confidence: SuggestionConfidence;
  students: FamilyStudent[];
  reasons: FamilySuggestionReason[];
  families: FamilyRef[];
}

export interface FamilySuggestionsResponse {
  count: number;
  counts: Record<SuggestionConfidence, number>;
  results: FamilySuggestion[];
}

export interface StudentFamilyTab {
  student: FamilyStudent;
  family: FamilyDetail | null;
  /** Without a family: the logins of this student alone. */
  logins: FamilyLogin[];
  suggestions: FamilySuggestion[];
}

export interface FamiliesListParams extends ListParams {
  /** 2, 3 or 4 (four or more children). */
  size?: string;
}

export interface SuggestionsParams {
  q?: string;
  confidence?: SuggestionConfidence;
  student?: number;
}

const BASE = '/accounts/admin/families';

export const familiesApi = {
  list: (params: FamiliesListParams) => api.get(`${BASE}/`, { params }),
  export: (params: ExportParams) => api.get<Blob>(`${BASE}/export/`, { params, responseType: 'blob' }),
  bulk: (body: BulkRequest) => api.post<BulkResult>(`${BASE}/bulk/`, body),
  link: (body: FamilyLinkBody) => api.post<FamilyPlan>(`${BASE}/link/`, body),
  get: (id: number) => api.get<FamilyDetail>(`${BASE}/${id}/`),
  update: (id: number, body: { name?: string; notes?: string }) => api.patch<FamilyDetail>(`${BASE}/${id}/`, body),
  dissolve: (id: number) => api.delete(`${BASE}/${id}/`),
  removeStudent: (familyId: number, studentId: number) =>
    api.delete<{ dissolved: boolean }>(`${BASE}/${familyId}/students/${studentId}/`),
  studentFamily: (studentId: number) => api.get<StudentFamilyTab>(`/accounts/admin/students/${studentId}/family/`),
  suggestions: (params: SuggestionsParams) => api.get<FamilySuggestionsResponse>(`${BASE}/suggestions/`, { params }),
  /** Same body and result as every bulk; `ids` are suggestion keys ("12-34"). */
  suggestionsBulk: (body: Omit<BulkRequest, 'ids'> & { ids: Array<string | number> }) =>
    api.post<BulkResult>(`${BASE}/suggestions/bulk/`, body),
};
