import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import type { ExportParams } from '@/services/dataOps';
import type { StageKey } from '@/lib/caseStages';
import { adminKeys, invalidateEntity } from './keys';
import { invalidateStudents } from './studentKeys';
import { PREREG_ENTITY, REG_ENTITY } from './admissions';

/**
 * The admission «Expediente» (Fase 5): the case list with its stage counts,
 * one case with everything the stage cards show, and every write the cards
 * make (stage PATCH, move / close / reopen, the five «Enviar…» actions,
 * becas y descuentos, pagos de inscripción, «Marcar como inscrito»), plus the
 * message templates and the exams of a week. Backend: `admissions/process_views.py`.
 *
 * Keys: `['admin', 'cases', …]`. A write puts the case it gets back in the
 * cache and refreshes the lists that show cases (Expedientes, board, the
 * legacy pre-registros list, Inscripciones, the week view).
 */
export const CASES_ENTITY = 'cases';
export const caseKeys = {
  all: adminKeys.entity(CASES_ENTITY),
  list: (params: CaseListParams) => adminKeys.list(CASES_ENTITY, params),
  detail: (id: number) => adminKeys.detail(CASES_ENTITY, id),
  exams: (from: string, to: string) => [...adminKeys.entity(CASES_ENTITY), 'exams', from, to] as const,
  templates: ['admin', 'case-templates'] as const,
};

// ── types ─────────────────────────────────────────────────────────────────
export interface NextAction { code: string; label: string }

export interface CaseRow {
  id: number;
  child_name: string;
  parent_name: string;
  parent_phone: string;
  parent_email: string;
  level: string;
  level_label: string;
  grade_applying: string;
  cycle: string;
  stage: StageKey;
  stage_label: string;
  closed_outcome: string;
  closed_outcome_label: string;
  status: string;
  next_action: NextAction | null;
  days_waiting: number;
  stage_changed_at: string | null;
  exam_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseListParams {
  page?: number;
  page_size?: number;
  stage?: string;
  closed?: string;
  level?: string;
  cycle?: string;
  q?: string;
  from?: string;
  to?: string;
  ordering?: string;
}

export interface CaseList {
  count: number;
  results: CaseRow[];
  counts: Partial<Record<StageKey, number>>;
}

export interface CaseBooking {
  id: number;
  date: string;
  start_time: string;
  end_time: string;
  visit_type: string;
  visit_type_label: string;
  status: string;
  status_label: string;
  outcome: string;
  outcome_label: string;
  outcome_note: string;
  num_attendees: number;
  source: string;
  created_at: string;
}

export type DiscountKind = 'inscripcion' | 'beca_colegiatura' | 'descuento_colegiatura';
export type DiscountDuration = '' | '3_meses' | '6_meses' | 'ciclo' | 'permanente' | 'personalizado';

export interface CaseDiscount {
  id: number;
  kind: DiscountKind;
  kind_label: string;
  percent: string | null;
  amount: string | null;
  duration: DiscountDuration;
  duration_label: string;
  start_month: string | null;
  end_month: string | null;
  authorized_by: string;
  note: string;
  summary: string;
  months: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface DiscountInput {
  kind: DiscountKind;
  percent: string | null;
  amount: string | null;
  duration: DiscountDuration;
  start_month: string | null;
  end_month: string | null;
  authorized_by: string;
  note: string;
}

export type PaymentMethod = 'efectivo' | 'transferencia' | 'tarjeta' | 'otro';

export interface CasePayment {
  id: number;
  paid_on: string;
  amount: string;
  method: PaymentMethod;
  method_label: string;
  reference: string;
  note: string;
  summary: string;
  recorded_by: string;
  created_at: string;
}

export interface PaymentInput {
  paid_on: string;
  amount: string;
  method: PaymentMethod;
  reference: string;
  note: string;
}

export interface GateItem {
  key: 'stage' | 'ficha' | 'documents' | 'payment' | string;
  label: string;
  ok: boolean;
  detail: string;
  state?: 'waived' | 'complete' | 'incomplete' | 'unknown';
  missing?: string[];
  overridable?: boolean;
}

export interface DocumentsState {
  state: 'waived' | 'complete' | 'incomplete' | 'unknown';
  ok: boolean;
  detail: string;
  missing: string[];
  counts: Record<string, number> | null;
}

export interface CaseFicha {
  id: number;
  status: string;
  status_label: string;
  ficha_version: number;
  submitted_at: string | null;
  invite_expires_at: string | null;
  invite_used_at: string | null;
  /** Sections of the ficha (alumno, domicilio, …) with what each still misses. */
  completeness: { complete: boolean; sections: Record<string, { complete: boolean; missing: string[] }> } | null;
  documents: DocumentsState;
  student: { id: number; student_id: string } | null;
}

export interface CaseHistoryEntry {
  id: number;
  at: string;
  actor: string;
  action: string;
  object_type: string;
  object_label: string;
  object_id: string;
  changes: Record<string, unknown>;
  context: string;
}

export interface CaseDetail extends CaseRow {
  lead: {
    child_first_name: string;
    child_last_name: string;
    child_dob: string | null;
    child_age: number | null;
    previous_school: string;
    relationship: string;
    referral_source: string;
    message: string;
    wants_visit: boolean;
    notes: string;
  };
  closed: { outcome: string; outcome_label: string; reason: string; from_stage: string; at: string | null } | null;
  informes: { costs_sent_at: string | null; visit_link_sent_at: string | null; outcome: string; outcome_label: string };
  visita: { outcome: string; outcome_label: string; outcome_at: string | null; note: string; bookings: CaseBooking[] };
  examen: {
    exam_at: string | null;
    exam_notes: string;
    exam_results_at: string | null;
    result: string;
    result_label: string;
    reason: string;
    date_sent_at: string | null;
    result_sent_at: string | null;
  };
  documentacion: {
    documents_waived: boolean;
    documents_waived_reason: string;
    documents_waived_at: string | null;
    agreements_note: string;
    discounts: CaseDiscount[];
  };
  inscrito: { enrolled_at: string | null; payments: CasePayment[]; gates: { ready: boolean; items: GateItem[] } };
  ficha: CaseFicha | null;
  ficha_link: { allowed: boolean; overridable: boolean; reason: string; sent_at: string | null; can_override: boolean };
  history: CaseHistoryEntry[];
}

export type CaseAction = 'send-costs' | 'send-visit-link' | 'send-ficha-link' | 'send-exam-date' | 'send-exam-result';

export interface SendResult {
  sent: boolean;
  channel: 'email' | 'whatsapp';
  whatsapp_text: string;
  whatsapp_url: string;
  link: string;
  sent_to: string;
  sent_at: string | null;
  case: CaseRow;
  registration?: number;
  expires_at?: string | null;
  override?: boolean;
}

export interface Credential { email: string; password: string | null; name: string }

export interface EnrollResult {
  already: boolean;
  case: CaseDetail;
  student?: number;
  student_id?: string;
  credentials?: Credential[];
  unlinked?: { email: string; name: string; reason: string }[];
}

export interface ProspectInput {
  child_name: string;
  parent_name: string;
  parent_phone: string;
  grade_applying: string;
  cycle: 'actual' | 'proximo' | string;
  previous_school?: string;
  child_age?: number | null;
  parent_email?: string;
  relationship?: string;
  referral_source?: string;
  notes?: string;
}

export interface CaseTemplates {
  templates: Record<string, string>;
  customized: string[];
  defaults: Record<string, string>;
  placeholders: Record<string, string[]>;
  labels: Record<string, string>;
}

export interface ExamItem {
  case: number;
  child_name: string;
  parent_name: string;
  parent_phone: string;
  grade_applying: string;
  level: string;
  exam_at: string;
  time: string;
  exam_notes: string;
  exam_results_at: string | null;
  result: string;
  stage: StageKey;
  date_sent_at: string | null;
}

export interface ExamsWeek { from: string; to: string; days: { date: string; exams: ExamItem[] }[] }

// ── API ───────────────────────────────────────────────────────────────────
const base = '/admissions/admin/cases';

export const casesApi = {
  list: (params: CaseListParams) => api.get<CaseList>(`${base}/`, { params }),
  create: (data: ProspectInput, dryRun = false) =>
    api.post<CaseDetail & { duplicates: CaseRow[]; created?: false }>(`${base}/`, data, dryRun ? { params: { dry_run: 1 } } : undefined),
  get: (id: number) => api.get<CaseDetail>(`${base}/${id}/`),
  patchStage: (id: number, stage: 'informes' | 'visita' | 'examen' | 'documentacion', data: Record<string, unknown>) =>
    api.patch<CaseDetail>(`${base}/${id}/${stage}/`, data),
  move: (id: number, data: { stage: string; note?: string }) => api.post<CaseDetail>(`${base}/${id}/move/`, data),
  close: (id: number, data: { outcome: string; reason: string }) => api.post<CaseDetail>(`${base}/${id}/close/`, data),
  reopen: (id: number, data: { note: string; stage?: string }) => api.post<CaseDetail>(`${base}/${id}/reopen/`, data),
  action: (id: number, action: CaseAction, data: { channel?: 'email' | 'whatsapp' | null; override?: boolean }) =>
    api.post<SendResult>(`${base}/${id}/actions/${action}/`, data),
  addDiscount: (id: number, data: DiscountInput) => api.post<CaseDiscount>(`${base}/${id}/discounts/`, data),
  updateDiscount: (id: number, item: number, data: Partial<DiscountInput>) =>
    api.patch<CaseDiscount>(`${base}/${id}/discounts/${item}/`, data),
  voidDiscount: (id: number, item: number, reason: string) =>
    api.delete(`${base}/${id}/discounts/${item}/`, { data: { reason } }),
  addPayment: (id: number, data: PaymentInput) => api.post<CasePayment>(`${base}/${id}/payments/`, data),
  voidPayment: (id: number, item: number, reason: string) =>
    api.delete(`${base}/${id}/payments/${item}/`, { data: { reason } }),
  enroll: (id: number, data: { student_id?: string; grade?: string; group?: string; override_documents?: boolean; override_reason?: string }) =>
    api.post<EnrollResult>(`${base}/${id}/enroll/`, data),
  templates: () => api.get<CaseTemplates>(`${base}/templates/`),
  saveTemplates: (data: Record<string, string>) => api.patch<CaseTemplates>(`${base}/templates/`, data),
  exams: (from: string, to: string) => api.get<ExamsWeek>('/admissions/admin/exams/', { params: { from, to } }),
  /** The «Expedientes» tab exports through the pre-registro export (same rows, stage filter + Etapa column). */
  export: (params: ExportParams) => api.get<Blob>('/admissions/pre-register/export/', { params, responseType: 'blob' }),
};

/** Staff preview of «Cuotas por nivel» (never cached). */
export const cuotasPreviewPath = (level: string) => `/admissions/admin/cuotas/${level || 'todos'}.pdf`;

// ── hooks ─────────────────────────────────────────────────────────────────
export function useCaseList(params: CaseListParams) {
  return useQuery({
    queryKey: caseKeys.list(params),
    queryFn: async () => {
      const { data } = await casesApi.list(params);
      return { count: data.count ?? data.results?.length ?? 0, results: data.results ?? [], counts: data.counts ?? {} } as CaseList;
    },
    placeholderData: keepPreviousData,
  });
}

export function useCase(id: number | null) {
  return useQuery({
    queryKey: caseKeys.detail(id ?? 0),
    queryFn: async () => (await casesApi.get(id!)).data,
    enabled: id != null && id > 0,
  });
}

/** Every list that shows a case refreshes after a write. */
export function refreshCaseLists(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: [...caseKeys.all, 'list'] }),
    qc.invalidateQueries({ queryKey: [...caseKeys.all, 'exams'] }),
    invalidateEntity(qc, PREREG_ENTITY, [REG_ENTITY, 'bookings']),
    qc.invalidateQueries({ queryKey: ['visits-week'] }),
    qc.invalidateQueries({ queryKey: ['badges'] }),
  ]);
}

/** Write the fresh case into the cache, then refresh the lists. */
export function storeCase(qc: QueryClient, data: CaseDetail) {
  qc.setQueryData(caseKeys.detail(data.id), data);
  void refreshCaseLists(qc);
}

/** A write that answers with the full case (stage PATCH, move, close, reopen). */
export function useCaseWrite<V>(id: number, fn: (vars: V) => Promise<{ data: CaseDetail }>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: V) => (await fn(vars)).data,
    onSuccess: (data) => storeCase(qc, data),
  });
}

/** A write that answers with something else: re-read the case. */
export function useCaseSideWrite<V, R>(id: number, fn: (vars: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: caseKeys.detail(id) }), refreshCaseLists(qc)]),
  });
}

export function useEnroll(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: Parameters<typeof casesApi.enroll>[1]) => (await casesApi.enroll(id, vars)).data,
    onSuccess: (data) => {
      storeCase(qc, data.case);
      void invalidateStudents(qc);
    },
  });
}

export function useCaseTemplates() {
  return useQuery({ queryKey: caseKeys.templates, queryFn: async () => (await casesApi.templates()).data });
}

export function useExamsWeek(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: caseKeys.exams(from, to),
    queryFn: async () => (await casesApi.exams(from, to)).data,
    enabled,
  });
}
