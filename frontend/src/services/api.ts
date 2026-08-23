/**
 * api.ts — Axios instance & all API calls for Interlaken.
 *
 * AUTH MODEL (see AUTH.md): the access token is held in memory (authStore), the
 * refresh token is an httpOnly cookie the browser sends automatically with
 * `withCredentials`. Refresh/logout are protected by a double-submit CSRF token
 * (a JS-readable cookie echoed in the `X-CSRF-Token` header). No token is ever
 * read from localStorage or a URL.
 */
import axios from 'axios';

export interface StaffUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: 'admin' | 'staff';
  is_active: boolean;
  is_superuser: boolean;
  last_login: string | null;
  date_joined: string;
  has_password: boolean;
}

export interface PasswordRequest {
  id: number;
  user: number | null;
  user_name: string;
  user_email: string;
  requested_email: string;
  requester_name: string;
  channel: string;
  note: string;
  status: 'open' | 'resolved' | 'rejected';
  created_by_name: string;
  created_at: string;
  resolved_by_name: string;
  resolved_at: string | null;
  delivered_via: string;
}

export interface PasswordRequestResolved extends PasswordRequest {
  temporary_password: string;
  templates: { whatsapp_text: string; email_subject: string; email_body: string };
  whatsapp_number: string;
}

export interface PaymentSummary {
  month_total: string;
  month_count: number;
  pending_count: number;
  last_success: import('@/types').Payment | null;
  per_child: { student_id: number; name: string; total: string; count: number }[];
}

export interface AdminPaymentsSummary {
  days: number;
  since: string;
  by_status: Record<string, { count: number; total: string }>;
  series: { date: string; total: string; count: number }[];
  stuck_pending: number;
}

export interface DocumentsListing {
  registration: number;
  child_name: string;
  required: { code: string; label: string }[];
  documents: { id: number; doc_type: string; filename: string; file_size: number; uploaded_at: string; is_verified: boolean; status: 'pending' | 'approved' | 'rejected'; review_note: string; download_url: string }[];
}

export interface DeliveryReport {
  announcement: number;
  recipients: number;
  pending_dispatch: number;
  read: number;
  email: Record<string, number>;
  push: Record<string, number>;
  failed: { id: number; user: string; email: string; attempts: number; error: string }[];
}

export interface GuardianWrite {
  first_name: string;
  last_name: string;
  email: string;
  whatsapp: string;
  phone: string;
  relationship: string;
}

export interface StudentWrite {
  first_name: string;
  last_name: string;
  email?: string;
  student_id: string;
  grade: string;
  group?: string;
  enrollment_date?: string | null;
  is_active?: boolean;
  status?: StudentStatus;
  birth_date?: string | null;
  curp?: string;
  emergency_name?: string;
  emergency_phone?: string;
  emergency_rel?: string;
  blood_type?: string;
  allergies?: string;
  medical_notes?: string;
  /** Set when medical fields were masked (P5-6): 'consent_required' | 'role'. */
  medical_masked?: 'consent_required' | 'role';
}

export type StudentStatus = 'active' | 'on_leave' | 'graduated' | 'withdrawn';

import { useAuthStore } from '@/store/authStore';

// Relative by default so the SPA is same-origin with the API (prod: served by
// Django; dev: via the Vite proxy) — required for the auth cookies to be sent.
// VITE_API_BASE_URL may override with an absolute host for split deployments.
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const BASE_URL = `${API_BASE}/api/v1`;
const CSRF_COOKIE = 'interlaken_csrf';

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

export const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// Attach the in-memory access token + the double-submit CSRF header.
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const csrf = getCookie(CSRF_COOKIE);
  if (csrf) config.headers['X-CSRF-Token'] = csrf;
  return config;
});

/** Exchange the httpOnly refresh cookie for a new access token (no body token). */
async function refreshAccess(): Promise<string> {
  const csrf = getCookie(CSRF_COOKIE);
  const { data } = await axios.post(
    `${BASE_URL}/accounts/token/refresh/`,
    {},
    { withCredentials: true, headers: csrf ? { 'X-CSRF-Token': csrf } : {} },
  );
  return data.access as string;
}

// Coalesce concurrent refreshes so a burst of 401s — or a StrictMode/boot double
// mount — triggers a single network call. Critical with refresh-token rotation +
// blacklisting: two concurrent refreshes would rotate once and 401 the loser,
// spuriously logging the user out. Every caller MUST go through this, including
// bootstrapSession (a direct refreshAccess there was the source of that race).
let refreshing: Promise<string> | null = null;

function coalescedRefresh(): Promise<string> {
  if (!refreshing) {
    refreshing = refreshAccess().finally(() => { refreshing = null; });
  }
  return refreshing;
}

// Silent refresh on 401.
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const url: string = original?.url || '';
    if (
      error.response?.status === 401 &&
      !original._retry &&
      !url.includes('/token/refresh')
    ) {
      original._retry = true;
      try {
        const access = await coalescedRefresh();
        useAuthStore.getState().setAccess(access);
        original.headers.Authorization = `Bearer ${access}`;
        return api(original);
      } catch {
        useAuthStore.getState().logout();
        if (typeof window !== 'undefined') window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

/** Restore a session on page load from the httpOnly refresh cookie. */
export async function bootstrapSession(): Promise<boolean> {
  try {
    useAuthStore.getState().setAccess(await coalescedRefresh());
    return true;
  } catch {
    useAuthStore.getState().logout();
    return false;
  }
}

// ── AUTH ──────────────────────────────────────────────────
export interface SessionsInfo { active_sessions: number; totp_enabled: boolean; history: { at: string; method: string; success: boolean; reason: string; ip: string | null; device: string }[] }
const csrfHeader = () => { const c = getCookie(CSRF_COOKIE); return c ? { 'X-CSRF-Token': c } : {}; };

export const authApi = {
  googleLogin: () => {
    window.location.href = `${API_BASE}/auth/google/`;
  },
  me: () => api.get('/accounts/me/'),
  /** Security (BACKLOG P4-7). */
  sessions: () => api.get<SessionsInfo>('/accounts/me/sessions/'),
  closeOtherSessions: () => api.post<{ closed: number }>('/accounts/me/sessions/close-others/', {}, { headers: csrfHeader() }),
  totpSetup: () => api.post<{ secret: string; otpauth_url: string }>('/accounts/me/totp/setup/', {}),
  totpEnable: (code: string) => api.post('/accounts/me/totp/enable/', { code }),
  totpDisable: (code: string) => api.post('/accounts/me/totp/disable/', { code }),
  /** Profile photo (BACKLOG P1-F2). */
  uploadAvatar: (blob: Blob) => { const fd = new FormData(); fd.append('file', blob, 'avatar.webp'); return api.post('/accounts/me/avatar/', fd, { headers: { 'Content-Type': 'multipart/form-data' } }); },
  deleteAvatar: () => api.delete('/accounts/me/avatar/'),
  updateMe: (data: { first_name?: string; last_name?: string; whatsapp?: string; avatar?: string }) =>
    api.patch('/accounts/me/', data),
  getNotifPrefs: () =>
    api.get<{ email_enabled: boolean; in_app_enabled: boolean; push_enabled: boolean }>(
      '/accounts/notification-preferences/',
    ),
  updateNotifPrefs: (data: Partial<{ email_enabled: boolean; in_app_enabled: boolean; push_enabled: boolean; cat_cafeteria: boolean; cat_payment: boolean; cat_info: boolean }>) =>
    api.patch('/accounts/notification-preferences/', data),
  logout: async () => {
    const csrf = getCookie(CSRF_COOKIE);
    const token = useAuthStore.getState().accessToken;
    try {
      await axios.post(`${API_BASE}/auth/logout/`, {}, {
        withCredentials: true,
        headers: {
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    } catch {
      /* best-effort — clear locally regardless */
    }
    useAuthStore.getState().logout();
    window.location.href = '/';
  },
};

// ── ADMISSIONS ────────────────────────────────────────────
// The one-time invite token (returned by createRegistration) is exchanged via
// exchangeAccess() for a session token, which is passed on subsequent steps as
// the X-Session-Token header — never a URL. See AUTH.md / IK-SEC A2.
const sessionHeaders = (token?: string) =>
  token ? { headers: { 'X-Session-Token': token } } : {};

export interface PipelineCard { id: number; child_name: string; level: string; grade_applying: string; parent_name: string; parent_email: string; parent_phone: string; status: string; submitted_at: string | null; updated_at: string; docs_verified: number; docs_required: number; missing: string[]; student: number | null }
export interface ConvertResult { student: number; student_id?: string; already: boolean; credentials: { email: string; password: string | null; name: string }[] }

export const admissionsApi = {
  /** Admissions pipeline (BACKLOG P4-1). */
  pipeline: () => api.get<{ columns: { status: string; label: string; cards: PipelineCard[] }[]; templates: { missing_docs: string } }>('/admissions/admin/pipeline/'),
  requestDocs: (id: number) => api.post<{ sent_to: string; missing: string[]; text: string }>(`/admissions/admin/register/${id}/request-docs/`, {}),
  convert: (id: number, data: { student_id?: string; grade?: string; group?: string }) => api.post<ConvertResult>(`/admissions/admin/register/${id}/convert/`, data),
  getTemplates: () => api.get<{ missing_docs: string; default_missing_docs: string; placeholders: string[] }>('/admissions/admin/templates/'),
  updateTemplates: (data: { missing_docs: string }) => api.patch<{ missing_docs: string }>('/admissions/admin/templates/', data),
  preRegister: (data: unknown) =>
    api.post('/admissions/pre-register/', data),

  createRegistration: (data: unknown) =>
    api.post('/admissions/register/', data),

  /** Exchange the one-time invite token for a working session token. */
  exchangeAccess: (id: number, token: string) =>
    api.post(`/admissions/register/${id}/access/`, { token }),

  getRegistration: (id: number, sessionToken?: string) =>
    api.get(`/admissions/register/${id}/`, sessionHeaders(sessionToken)),

  updateRegistration: (id: number, data: unknown, sessionToken?: string) =>
    api.patch(`/admissions/register/${id}/`, data, sessionHeaders(sessionToken)),

  submitRegistration: (id: number, sessionToken?: string, acceptPrivacy = true) =>
    api.post(`/admissions/register/${id}/submit/`, { accept_privacy: acceptPrivacy }, sessionHeaders(sessionToken)),

  /** Applicant's documents with review status (BACKLOG P1-G4). */
  listDocuments: (registrationId: number, sessionToken?: string) =>
    api.get(`/admissions/register/${registrationId}/documents/list/`, sessionHeaders(sessionToken)),

  uploadDocument: (registrationId: number, file: File, docType: string, sessionToken?: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('doc_type', docType);
    return api.post(`/admissions/register/${registrationId}/documents/`, form, {
      headers: {
        'Content-Type': 'multipart/form-data',
        ...(sessionToken ? { 'X-Session-Token': sessionToken } : {}),
      },
    });
  },

  /** Parent portal — registrations linked to the logged-in user's email. */
  getMyRegistrations: () =>
    api.get('/admissions/my-registrations/'),

  getOpenSchoolEvents: () =>
    api.get('/admissions/open-school/'),

  signUpOpenSchool: (data: unknown) =>
    api.post('/admissions/open-school/signup/', data),
};

// ── ADMISSIONS (admin console) ────────────────────────────
// Staff (JWT) actions for the Admisiones console: issue enrollment invites and
// review registrations + documents. Staff bypass the session-token gate.
export const admissionsAdminApi = {
  /** #2 — issue a pre-filled enrollment invite for a pre-registration. */
  invitePreRegistration: (preId: number) =>
    api.post(`/admissions/pre-register/${preId}/invite/`),

  /** #1 — paginated registrations list for the review console. */
  listRegistrations: (page = 1) =>
    api.get('/admissions/register/', { params: { page } }),

  /** Full registration (medical gated on consent) — no session token as admin. */
  getRegistration: (id: number) =>
    api.get(`/admissions/register/${id}/`),

  /** Move a registration through review (approved / rejected / …) + notes. */
  updateRegistrationStatus: (id: number, data: { status: string; admin_notes?: string }) =>
    api.patch(`/admissions/register/${id}/status/`, data),

  /** Mark an uploaded document verified (or clear it). */
  verifyDocument: (docId: number, isVerified: boolean) =>
    api.patch(`/admissions/documents/${docId}/verify/`, { is_verified: isVerified }),
  /** Approve / reject with a note (P1-G4). */
  reviewDocument: (docId: number, status: 'approved' | 'rejected' | 'pending', note = '') =>
    api.patch(`/admissions/documents/${docId}/verify/`, { status, review_note: note }),
  /** Issue and email a fresh single-use documents link. */
  sendDocumentsLink: (registrationId: number) =>
    api.post<{ url: string; missing: string[] }>(`/admissions/register/${registrationId}/documents-link/`, {}),

  /** Download an uploaded document as a blob (prod serves no /media/, so this
   *  authenticated endpoint carries the JWT and streams the file). */
  downloadDocument: (docId: number) =>
    api.get(`/admissions/documents/${docId}/download/`, { responseType: 'blob' }),
};

// ── CAFETERIA ─────────────────────────────────────────────
export const cafeteriaApi = {
  getMyBalance: () =>
    api.get('/cafeteria/balance/'),

  getTransactions: (params?: {
    page?: number;
    student?: number;
    type?: 'purchase' | 'topup' | 'refund';
    from?: string;
    to?: string;
  }) =>
    api.get('/cafeteria/transactions/', { params }),

  // Daily spending (purchases) time-series — optionally scoped to one child.
  getSpendingTrend: (days = 30, student?: number) =>
    api.get('/cafeteria/spending-trend/', {
      params: { days, ...(student ? { student } : {}) },
    }),

  // Spend grouped by coarse category (Bebidas / Comida / Snacks / Otros).
  getSpendingCategories: (days = 30, student?: number) =>
    api.get<{
      days: number;
      total: number;
      categories: { category: string; total: number; count: number; pct: number }[];
    }>('/cafeteria/spending-categories/', {
      params: { days, ...(student ? { student } : {}) },
    }),

  // Digital student card(s): identity + code (QR/barcode) + balance + Loyverse stats.
  /** Admin: one student's card (staff credencial view). */
  getStudentCard: (studentId: number) =>
    api.get<import('@/types').CafeteriaCard[]>('/cafeteria/cards/', { params: { student: studentId } }),
  getCards: () => api.get<import('@/types').CafeteriaCard[]>('/cafeteria/cards/'),

  // Read-only recent purchases pulled live from Loyverse (does not touch the ledger).
  getLoyverseHistory: (student?: number, limit = 20) =>
    api.get<{
      linked: boolean;
      error?: string;
      receipts: import('@/types').LoyverseHistoryReceipt[];
    }>('/cafeteria/loyverse-history/', {
      params: { limit, ...(student ? { student } : {}) },
    }),

  // Family sets the saldo-bajo warning level for one of their children.
  updateLowBalanceThreshold: (studentId: number, threshold: number) =>
    api.patch(`/cafeteria/balance/${studentId}/threshold/`, { threshold }),

  // Family sets daily/weekly spend caps (0 disables). Either field may be sent alone.
  updateSpendLimits: (
    studentId: number,
    limits: { daily_spend_limit?: number; weekly_spend_limit?: number },
  ) =>
    api.patch(`/cafeteria/balance/${studentId}/budget/`, limits),

  requestTopUp: (
    studentId: number,
    amount: number,
    method: string,
    gateway?: string,
  ) =>
    api.post('/cafeteria/topup/', { student: studentId, amount, method, gateway }),

  /** On-demand Loyverse purchase poll (parents/staff). Rate-limited server-side. */
  refreshFromLoyverse: () =>
    api.post<{
      detail: string;
      receipts: number;
      created: number;
      notified: number;
      students: number;
    }>('/cafeteria/refresh/'),

  /** Parent family CSV of children's cafeteria transactions. */
  exportMyTransactions: () =>
    api.get('/cafeteria/export/', { responseType: 'blob' }),

  // Admin
  getAllBalances: (params?: { page?: number }) =>
    api.get('/cafeteria/admin/balances/', { params }),

  applyTopUp: (topupId: number) =>
    api.post(`/cafeteria/admin/topup/${topupId}/apply/`),

  syncBalance: (studentId: number) =>
    api.post(`/cafeteria/admin/sync/${studentId}/`),

  syncAll: () =>
    api.post<{
      detail: string;
      balances_ok?: number;
      balances_failed?: number;
      receipts?: number;
      purchases_created?: number;
      notified?: number;
    }>('/cafeteria/admin/sync-all/'),

  // Admin console (Phase D)
  getTopUpLog: (params?: {
    status?: string;
    method?: string;
    from?: string;
    to?: string;
    needs_pos?: boolean | number | string;
    needs_unload?: boolean | number | string;
    page?: number;
  }) =>
    api.get('/cafeteria/admin/topups/', { params }),

  markTopUpPosLoaded: (topupId: number) =>
    api.post(`/cafeteria/admin/topup/${topupId}/pos-loaded/`),

  markTopUpPosUnloaded: (topupId: number) =>
    api.post(`/cafeteria/admin/topup/${topupId}/pos-unloaded/`),

  getStudentDetail: (studentId: number) =>
    api.get(`/cafeteria/admin/student/${studentId}/`),

  adjustBalance: (studentId: number, amount: number, reason: string) =>
    api.post(`/cafeteria/admin/adjust/${studentId}/`, { amount, reason }),

  refundTransaction: (txId: number, reason?: string) =>
    api.post(`/cafeteria/admin/refund/${txId}/`, { reason }),

  reconcile: (onlyDrift?: boolean, params?: { limit?: number; offset?: number }) =>
    api.get('/cafeteria/admin/reconcile/', {
      params: {
        ...(onlyDrift ? { only: 'drift' } : {}),
        ...(params?.limit != null ? { limit: params.limit } : {}),
        ...(params?.offset != null ? { offset: params.offset } : {}),
      },
    }),

  getLowBalance: (params?: { page?: number }) =>
    api.get('/cafeteria/admin/low-balance/', { params }),

  exportStudent: (studentId: number, fmt: 'csv' | 'pdf') =>
    api.get(`/cafeteria/admin/export/student/${studentId}/`, {
      params: { fmt }, responseType: 'blob',
    }),

  exportSchool: (fmt: 'csv' | 'pdf') =>
    api.get('/cafeteria/admin/export/school/', {
      params: { fmt }, responseType: 'blob',
    }),
};

/** Trigger a browser download for an axios blob response. */
export function downloadBlob(data: Blob, filename: string) {
  const url = window.URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

// ── PAYMENTS ─────────────────────────────────────────────
// Bare POST /payments/initiate/ is fail-closed (no unlinked charge path).
// Real money starts from the cafeteria top-up.
export const paymentsApi = {
  getPaymentStatus: (paymentId: number) =>
    api.get(`/payments/${paymentId}/`),

  getMyPayments: (params?: { page?: number; status?: string; student?: string; from?: string; to?: string }) =>
    api.get('/payments/history/', { params }),
  exportMyPayments: (params?: { status?: string; student?: string; from?: string; to?: string }) =>
    api.get('/payments/history/export/', { params, responseType: 'blob' }),
  getSummary: () => api.get<PaymentSummary>('/payments/summary/'),
  getReceipt: (paymentId: number) => api.get(`/payments/${paymentId}/receipt/`, { responseType: 'blob' }),
  /** Admin ledger (BACKLOG P1-D9). */
  adminList: (params?: { page?: number; q?: string; status?: string; gateway?: string; from?: string; to?: string }) =>
    api.get('/payments/admin/', { params }),
  adminSummary: (days = 30) => api.get<AdminPaymentsSummary>('/payments/admin/summary/', { params: { days } }),
};

// Cafetería top-ups are the only money path; there is no tuition/finance API.

// ── CORE (audit trail) ────────────────────────────────────
export interface ContactMessage {
  id: number;
  name: string;
  email: string;
  subject: string;
  message: string;
  is_handled: boolean;
  created_at: string;
}

export const coreApi = {
  exportAuditLog: (params?: { actor?: string; action?: string; from?: string; to?: string }) =>
    api.get('/core/admin/audit/export/', { params, responseType: 'blob' }),
  /** Website inbox (BACKLOG P1-G7). */
  getContactMessages: (params?: { page?: number; q?: string; handled?: string }) =>
    api.get('/core/admin/contact-messages/', { params }),
  setContactHandled: (id: number, is_handled: boolean) =>
    api.patch<ContactMessage>(`/core/admin/contact-messages/${id}/`, { is_handled }),
  /** Live sidebar counters (BACKLOG P1-E3). */
  getBadges: () => api.get<Record<string, number>>('/core/badges/'),
  /** Read-only admin audit log (append-only), paginated + filterable. */
  getAuditLog: (params?: {
    page?: number;
    actor?: string;
    action?: string;
    context?: string;
    object_type?: string;
    object_id?: string | number;
    from?: string;
    to?: string;
  }) => api.get('/core/admin/audit/', { params }),
};

// ── LEGAL / CONSENT (LFPDPPP) ─────────────────────────────
export const legalApi = {
  /** Current Aviso de Privacidad (public). */
  getNotice: () => api.get('/legal/notice/'),

  /** The guardian's consent state + whether re-acceptance is needed. */
  getConsent: (student?: number) =>
    api.get('/legal/consent/', { params: student ? { student } : {} }),

  /** Record granular consent (grant/revoke) for the guardian, optionally per student. */
  recordConsent: (purposes: Record<string, boolean>, student?: number) =>
    api.post('/legal/consent/', { purposes, ...(student ? { student } : {}) }),

  // ARCO rights (Acceso, Rectificación, Cancelación, Oposición)
  listArco: () => api.get('/legal/arco/'),
  createArco: (requestType: string, details: string) =>
    api.post('/legal/arco/', { request_type: requestType, details }),
  /** Acceso: download everything held on the requesting household. */
  exportMyData: () => api.get('/legal/arco/export/'),
  // Staff console
  adminListArco: (status?: string) =>
    api.get('/legal/admin/arco/', { params: status ? { status } : {} }),
  adminSetArcoStatus: (id: number, status: string, resolutionNote?: string) =>
    api.post(`/legal/admin/arco/${id}/status/`, { status, resolution_note: resolutionNote }),
  /** Record a request received via privacidad@ / WhatsApp / in person (BACKLOG P5-5). */
  adminIntakeArco: (data: { requester_email: string; requester_name?: string; request_type: string; channel: string; details?: string }) =>
    api.post<ArcoRequest>('/legal/admin/arco/intake/', data),
};

// ── CONTACT ───────────────────────────────────────────────
export const contactApi = {
  send: (data: { name: string; email: string; subject: string; message: string }) =>
    api.post('/contact/', data),
  /** CFDI request (BACKLOG P1-G6). */
  requestInvoice: (data: Record<string, string>) => api.post('/facturacion/', data),
};

// ── BOOKINGS ──────────────────────────────────────────────
export interface WeekBooking { id: number; parent_name: string; child_name: string; status: string; outcome: string; num_attendees: number; parent_phone: string }
export interface WeekSlot { id: number; date: string; title: string; visit_type: string; start_time: string; end_time: string; capacity: number; is_active: boolean; booked: number; bookings: WeekBooking[] }

export const bookingsApi = {
  /** Weekly calendar, reschedule and outcome (BACKLOG P4-2). */
  adminWeek: (start: string) => api.get<{ start: string; end: string; days: { date: string; slots: WeekSlot[] }[] }>('/bookings/admin/week/', { params: { start } }),
  adminReschedule: (id: number, slot: number) => api.post(`/bookings/admin/bookings/${id}/reschedule/`, { slot }),
  adminOutcome: (id: number, data: { outcome: string; note?: string }) => api.post<{ pre_registration: { id: number; status: string } | null }>(`/bookings/admin/bookings/${id}/outcome/`, data),
  // Public
  getAvailability: (params?: { type?: string; from?: string; to?: string }) =>
    api.get('/bookings/availability/', { params }),

  createBooking: (data: {
    slot: number;
    parent_name: string;
    parent_email: string;
    parent_phone: string;
    child_name?: string;
    child_grade?: string;
    num_attendees?: number;
  }) => api.post('/bookings/', data),

  getBooking: (id: number) =>
    api.get(`/bookings/${id}/`),

  cancelBooking: (id: number) =>
    api.post(`/bookings/${id}/cancel/`),

  // Admin
  generateSlots: (data: {
    visit_type?: string;
    title?: string;
    start_date: string;
    end_date: string;
    weekdays: number[];
    window_start: string;
    window_end: string;
    interval_minutes?: number;
    capacity?: number;
    location?: string;
  }) => api.post('/bookings/availability/', data),

  getAdminBookings: (params?: { type?: string; status?: string; date?: string; q?: string; page?: number }) =>
    api.get('/bookings/admin/bookings/', { params }),

  /** CSV of the visits list, respecting the active filters. */
  exportBookings: (params?: { type?: string; status?: string; date?: string; q?: string }) =>
    api.get('/bookings/admin/bookings/export/', { params, responseType: 'blob' }),

  bookingAction: (id: number, action: 'confirm' | 'cancel' | 'attended' | 'no_show') =>
    api.post(`/bookings/admin/bookings/${id}/${action}/`),

  // Slot management (view / edit / deactivate / delete published availability).
  getAdminSlots: (params?: { type?: string; active?: 'true' | 'false'; from?: string; to?: string; page?: number }) =>
    api.get('/bookings/admin/slots/', { params }),
  updateSlot: (id: number, data: { capacity?: number; location?: string; title?: string; is_active?: boolean }) =>
    api.patch(`/bookings/admin/slots/${id}/`, data),
  deleteSlot: (id: number) =>
    api.delete(`/bookings/admin/slots/${id}/`),
};

// ── PORTAL ────────────────────────────────────────────────
export const portalApi = {
  getDashboard: () =>
    api.get('/portal/dashboard/'),

  getStudents: (params?: { page?: number; search?: string; estado?: string; acceso?: string; nivel?: string; grado?: string; grupo?: string; ordering?: string }) =>
    api.get('/accounts/students/', { params }),

  /** Bulk roster edit (BACKLOG P1-A8). */
  bulkStudents: (data: { ids: number[]; action: 'status' | 'group' | 'grade'; value: string }) => api.post<{ updated: number }>('/accounts/admin/students/bulk/', data),
  /** One student profile (admin, or a family's own child). */
  getStudent: (studentId: number) =>
    api.get(`/accounts/students/${studentId}/`),

  /** Portal student editor (admin). Blank email = synthetic school login. */
  createStudent: (data: StudentWrite) => api.post('/accounts/admin/students/', data),
  updateStudent: (studentId: number, data: Partial<StudentWrite>) =>
    api.patch(`/accounts/admin/students/${studentId}/`, data),

  /** CSV roster export (grade/group/guardians count), honors ?search=. */
  exportStudents: (search?: string) =>
    api.get('/accounts/admin/export/students/', {
      params: search ? { search } : {}, responseType: 'blob',
    }),

  // Aggregated staff analytics (staff/admin only; server-cached 60s per range).
  getStaffAnalytics: (days?: number) =>
    api.get('/portal/analytics/', { params: days ? { days } : undefined }),

  // Idempotent read receipts — feeds the circulars read-rate KPI.
  markAnnouncementsRead: (ids: number[]) =>
    api.post('/portal/announcements/mark-read/', { ids }),

  // Comunicados (announcements) for families — list, detail, and replies.
  getAnnouncements: (params?: { page?: number }) =>
    api.get('/portal/announcements/', { params }),
  getAnnouncement: (id: number) => api.get(`/portal/announcements/${id}/`),
  getAnnouncementComments: (id: number) =>
    api.get(`/portal/announcements/${id}/comments/`),
  postAnnouncementComment: (id: number, body: string) =>
    api.post(`/portal/announcements/${id}/comments/`, { body }),

  // Personal notifications (header bell menu).
  getNotifications: (params?: { page?: number; type?: string; unread?: string }) =>
    api.get('/portal/notifications/', { params }),
  markNotificationRead: (id: number) => api.post(`/portal/notifications/${id}/read/`),
  markAllNotificationsRead: () => api.post('/portal/notifications/mark-all-read/'),

  // Admin comunicados (announcements) CRUD.
  adminListAnnouncements: () => api.get('/portal/admin/announcements/'),
  /** Portal novedades feed (BACKLOG P4-11). */
  novedades: (since?: string) => api.get<{ since: string; unread: number; items: NovedadItem[] }>('/portal/novedades/', { params: since ? { since } : undefined }),
  /** Public avisos banner (BACKLOG P3-9). */
  getSiteNotices: () => api.get<SiteNotice[]>('/portal/avisos/'),
  getAnnouncementDelivery: (id: number) => api.get<DeliveryReport>(`/portal/admin/announcements/${id}/delivery/`),
  resendAnnouncementFailed: (id: number) =>
    api.post<{ requeued: number }>(`/portal/admin/announcements/${id}/delivery/`, { action: 'resend_failed' }),
  /** Guardian merge (BACKLOG P4-6). */
  guardianMergePreview: (keep: string, drop: string) => api.get<MergePreview>('/accounts/admin/guardians/merge/preview/', { params: { keep, drop } }),
  guardianMerge: (data: { keep: number; drop: number; confirm: string }) => api.post<MergeResult>('/accounts/admin/guardians/merge/', data),
  /** New school year wizard (BACKLOG P4-5). */
  schoolYearPreview: () => api.get<SchoolYearPreview>('/accounts/admin/school-year/preview/'),
  schoolYearRun: (data: { confirm: string; new_cycle: string; reset_threshold: number | null }) => api.post<SchoolYearResult>('/accounts/admin/school-year/run/', data),
  adminCreateAnnouncement: (data: {
    title: string; body: string; audience: string;
    is_active?: boolean; push_enabled?: boolean; show_on_site?: boolean; site_until?: string | null; site_link?: string;
  }) => api.post('/portal/admin/announcements/', data),
  adminUpdateAnnouncement: (id: number, data: Record<string, unknown>) =>
    api.patch(`/portal/admin/announcements/${id}/`, data),
  adminDeleteAnnouncement: (id: number) =>
    api.delete(`/portal/admin/announcements/${id}/`),

  /** Composer preview: active accounts a comunicado with this audience notifies. */
  getAnnouncementRecipientCount: (audience: string) =>
    api.get<{ audience: string; count: number }>(
      '/portal/admin/announcements/recipient-count/', { params: { audience } }),

  /** Urgent school-wide broadcast (creates comunicado + fans out WARNING notifs). */
  adminEmergencyBroadcast: (data: {
    title: string;
    message: string;
    audience: string;
    whatsapp?: boolean;
  }) => api.post('/portal/admin/broadcast/', data),

  // Web push opt-in/out (subscription persisted per user+device).
  subscribePush: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    api.post('/portal/push/subscribe/', sub),
  unsubscribePush: (endpoint: string) =>
    api.post('/portal/push/unsubscribe/', { endpoint }),

  // Bulk CSV import (admin): dry_run=true simulates and returns per-row results.
  importStudents: (file: File, dryRun: boolean) => {
    const form = new FormData();
    form.append('file', file);
    form.append('dry_run', dryRun ? '1' : '0');
    return api.post('/accounts/admin/import-students/', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  // Roster ↔ Loyverse linking (admin): commit=false previews the plan, true persists.
  linkLoyverse: (commit: boolean) =>
    api.post('/accounts/admin/link-loyverse/', { commit: commit ? '1' : '0' }),

  // Import roster from Loyverse customers (admin): preview then commit (+ link).
  importLoyverse: (commit: boolean, seedBalances = true) =>
    api.post('/accounts/admin/import-loyverse/', {
      commit: commit ? '1' : '0',
      seed_balances: seedBalances ? '1' : '0',
    }),

  // Per-student parent/guardian linking (admin).
  listGuardians: (studentId: number) =>
    api.get(`/accounts/admin/students/${studentId}/guardians/`),
  linkGuardian: (
    studentId: number,
    data: {
      email: string;
      full_name?: string;
      first_name?: string;
      last_name?: string;
      phone?: string;
      relationship?: string;
    },
  ) => api.post(`/accounts/admin/students/${studentId}/guardians/`, data),
  unlinkGuardian: (studentId: number, userId: number) =>
    api.delete(`/accounts/admin/students/${studentId}/guardians/${userId}/`),
  /** Staff user management (BACKLOG P1-H1). */
  listStaff: () => api.get<{ results: StaffUser[]; count: number }>('/accounts/admin/staff/'),
  inviteStaff: (data: { email: string; first_name: string; last_name?: string; role: StaffUser['role'] }) =>
    api.post<StaffUser & { temporary_password: string }>('/accounts/admin/staff/', data),
  updateStaff: (id: number, data: Partial<Pick<StaffUser, 'role' | 'is_active' | 'first_name' | 'last_name'>>) =>
    api.patch<StaffUser>(`/accounts/admin/staff/${id}/`, data),
  resetStaffPassword: (id: number) =>
    api.post<{ temporary_password: string; sessions_revoked: number }>(`/accounts/admin/staff/${id}/reset-password/`, {}),
  /** Password request inbox (admin). */
  getPasswordRequests: (status?: string) =>
    api.get<{ count: number; open_count: number; results: PasswordRequest[] }>('/accounts/admin/password-requests/', { params: status ? { status } : undefined }),
  createPasswordRequest: (data: { requested_email: string; requester_name?: string; channel: string; note?: string }) =>
    api.post<PasswordRequest>('/accounts/admin/password-requests/', data),
  updatePasswordRequest: (id: number, data: { action: 'resolve' | 'reject'; delivered_via?: string; note?: string }) =>
    api.patch<PasswordRequest | PasswordRequestResolved>(`/accounts/admin/password-requests/${id}/`, data),
  /** Edit a linked guardian's identity/contact (admin). */
  updateGuardian: (studentId: number, userId: number, data: Partial<GuardianWrite>) =>
    api.patch(`/accounts/admin/students/${studentId}/guardians/${userId}/`, data),

  // Admin-managed password reset (school policy: only an admin resets a family
  // password — imported accounts have no usable one and their synthetic
  // @alumnos address receives no mail). Omit `password` and the server mints a
  // temporary one, returned ONCE as `temporary_password`. Never targets another
  // admin. Setting the password kills the account's existing sessions.
  setUserPassword: (userId: number, data: { password?: string; reason?: string }) =>
    api.post(`/accounts/admin/users/${userId}/set-password/`, data),
};

// ── CONTENT (CMS) ─────────────────────────────────────────
export interface SchoolEvent {
  id: number;
  title: string;
  kind: 'holiday' | 'vacation' | 'exam' | 'event' | 'meeting' | 'deadline';
  kind_label: string;
  start_date: string;
  end_date: string | null;
  level: string;
  description: string;
  is_published: boolean;
}
export type FormFieldType = 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'date' | 'number';
export interface FormField {
  key: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  help?: string;
  show_if?: { field: string; equals: string } | null;
}
export interface FormDefinitionPublic {
  slug: string;
  title: string;
  description: string;
  fields: FormField[];
  consent_text: string;
  success_message: string;
  submit_label: string;
}
export interface FormDefinitionAdmin extends FormDefinitionPublic {
  id: number;
  notify_to: string;
  is_published: boolean;
  submissions_count: number;
  pending_count: number;
  updated_at: string;
}
export interface FormSubmission {
  id: number;
  form: number;
  form_title: string;
  data: Record<string, string | boolean>;
  page: string;
  is_handled: boolean;
  reply_to: string;
  created_at: string;
}

export interface SiteRedirect { id: number; from_path: string; to_path: string; permanent: boolean; hits: number; created_at: string }

export interface NovedadItem { type: 'comunicado' | 'evento' | 'cafeteria' | 'pago' | 'sitio' | string; title: string; text: string; link: string; at: string; unread: boolean }
export interface ArcoRequest { id: number; requester_email: string; requester_name: string; channel: string; request_type: string; details: string; status: 'received' | 'in_review' | 'resolved' | 'rejected'; resolution_note: string; statutory_deadline: string; created_at: string; resolved_at: string | null; is_overdue: boolean; days_left: number }
export interface SiteNotice { id: number; title: string; body: string; link: string; until: string | null }

export interface PageIssue { level: 'error' | 'warning'; code: string; message: string; block_id: string | null }

export interface MergeUser { id: number; email: string; full_name: string; is_active: boolean; last_login: string | null; has_password: boolean; google: boolean; phone: string; children: { id: number; name: string; grade: string }[] }
export interface MergePreview { keep: MergeUser; drop: MergeUser; references: Record<string, number> }
export interface MergeResult { moved: Record<string, number>; skipped: Record<string, number>; keep: number; drop: number }
export interface SchoolYearPreview { moves: { from: string; to: string; count: number }[]; graduates: number; active_total: number; skipped: number; current_cycle: string; suggested_cycle: string; last_rollover_at: string | null }
export interface SchoolYearResult { promoted: number; graduated: number; thresholds_reset: number; school_year: string }

export interface CmsPageAdmin {
  id: number;
  slug: string;
  title: string;
  template: 'home' | 'level' | 'simple' | 'landing';
  status: 'draft' | 'published';
  draft_blocks: { id: string; type: string; props: Record<string, unknown> }[];
  seo: { title?: string; description?: string; og_image?: string; noindex?: boolean };
  published_version_number: number | null;
  has_unpublished_changes: boolean;
  published_at: string | null;
  review_requested_at?: string | null;
  review_requested_by_name?: string;
  review_note?: string;
  publish_at?: string | null;
  unpublish_at?: string | null;
  updated_at: string;
}

export interface MediaAsset {
  id: number;
  filename: string;
  content_type: string;
  size: number;
  width: number;
  height: number;
  alt: string;
  caption: string;
  focal_x: number;
  focal_y: number;
  tags: string;
  urls: Record<string, string>;
  created_at: string;
}

export interface Testimonial {
  id: number;
  quote: string;
  author: string;
  role: string;
  level: string;
  is_published: boolean;
  order: number;
  created_at: string;
}
export type TestimonialWrite = Omit<Testimonial, 'id' | 'created_at'>;

export type SchoolEventWrite = Omit<SchoolEvent, 'id' | 'kind_label' | 'end_date'> & { end_date?: string | null };

export const contentApi = {
  // Public site settings — phone/social/contact data (server-cached 5 min).
  getSettings: () =>
    api.get('/content/settings/'),
  /** School calendar (BACKLOG P2-16). */
  getCalendar: (params?: { from?: string; to?: string; level?: string }) => api.get('/content/calendar/', { params }),
  adminListCalendar: () => api.get('/content/admin/calendar/'),
  adminCreateCalendar: (data: SchoolEventWrite) => api.post<SchoolEvent>('/content/admin/calendar/', data),
  adminUpdateCalendar: (id: number, data: Partial<SchoolEventWrite>) => api.patch<SchoolEvent>(`/content/admin/calendar/${id}/`, data),
  adminDeleteCalendar: (id: number) => api.delete(`/content/admin/calendar/${id}/`),
  /** CMS pages (BACKLOG P3-3). */
  getPage: (slug: string) => api.get(`/content/pages/${encodeURIComponent(slug)}/`),
  getPagePreviewBySlug: (_slug: string, token: string) => api.get('/content/pages/preview/', { params: { token } }),
  adminListPages: () => api.get('/content/admin/pages/'),
  adminGetPage: (id: number) => api.get<CmsPageAdmin>(`/content/admin/pages/${id}/`),
  adminCreatePage: (data: Partial<CmsPageAdmin>) => api.post<CmsPageAdmin>('/content/admin/pages/', data),
  adminUpdatePage: (id: number, data: Partial<CmsPageAdmin>) => api.patch<CmsPageAdmin>(`/content/admin/pages/${id}/`, data),
  adminDeletePage: (id: number) => api.delete(`/content/admin/pages/${id}/`),
  adminPublishPage: (id: number, action: 'publish' | 'unpublish' = 'publish') => api.post<CmsPageAdmin & { version?: number }>(`/content/admin/pages/${id}/publish/`, { action }),
  adminPageVersions: (id: number) => api.get<{ id: number; number: number; author_name: string; created_at: string }[]>(`/content/admin/pages/${id}/versions/`),
  adminRollbackPage: (id: number, version: number) => api.post(`/content/admin/pages/${id}/versions/`, { version }),
  adminPageChecks: (id: number) => api.get<{ ok: boolean; issues: PageIssue[] }>(`/content/admin/pages/${id}/checks/`),
  adminReviewPage: (id: number, action: 'request' | 'reject', note?: string) => api.post<CmsPageAdmin>(`/content/admin/pages/${id}/review/`, { action, note }),
  adminPreviewToken: (id: number) => api.post<{ token: string; url: string }>(`/content/admin/pages/${id}/preview-token/`, {}),
  /** Navigation, redirects (BACKLOG P3-7). */
  getRedirects: () => api.get<Record<string, { to: string; permanent: boolean }>>('/content/redirects/'),
  hitRedirect: (from: string) => api.post('/content/redirects/hit/', { from }),
  adminListRedirects: () => api.get<SiteRedirect[]>('/content/admin/redirects/'),
  adminCreateRedirect: (data: Partial<SiteRedirect>) => api.post<SiteRedirect>('/content/admin/redirects/', data),
  adminDeleteRedirect: (id: number) => api.delete(`/content/admin/redirects/${id}/`),
  /** CMS forms builder (BACKLOG P3-6). */
  getForm: (slug: string) => api.get<FormDefinitionPublic>(`/content/forms/${encodeURIComponent(slug)}/`),
  submitForm: (slug: string, data: Record<string, unknown>) => api.post<{ ok: boolean; message: string }>(`/content/forms/${encodeURIComponent(slug)}/submit/`, data),
  adminListForms: () => api.get<FormDefinitionAdmin[]>('/content/admin/forms/'),
  adminCreateForm: (data: Partial<FormDefinitionAdmin>) => api.post<FormDefinitionAdmin>('/content/admin/forms/', data),
  adminUpdateForm: (id: number, data: Partial<FormDefinitionAdmin>) => api.patch<FormDefinitionAdmin>(`/content/admin/forms/${id}/`, data),
  adminDeleteForm: (id: number) => api.delete(`/content/admin/forms/${id}/`),
  adminFormSubmissions: (id: number, params?: { handled?: '0' | '1' }) => api.get<FormSubmission[]>(`/content/admin/forms/${id}/submissions/`, { params }),
  adminFormSubmissionsCsvUrl: (id: number) => `/api/v1/content/admin/forms/${id}/submissions/?export=csv`,
  adminHandleSubmission: (id: number, is_handled: boolean) => api.patch<FormSubmission>(`/content/admin/form-submissions/${id}/`, { is_handled }),
  /** CMS media library (BACKLOG P3-1). */
  adminListMedia: (params?: { page?: number; q?: string }) => api.get('/content/admin/media/', { params }),
  adminUploadMedia: (file: File, meta?: { alt?: string; caption?: string; tags?: string }) => {
    const form = new FormData();
    form.append('file', file);
    Object.entries(meta ?? {}).forEach(([k, v]) => { if (v) form.append(k, v); });
    return api.post<MediaAsset>('/content/admin/media/', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  adminUpdateMedia: (id: number, data: Partial<Pick<MediaAsset, 'alt' | 'caption' | 'tags' | 'focal_x' | 'focal_y'>>) =>
    api.patch<MediaAsset>(`/content/admin/media/${id}/`, data),
  adminDeleteMedia: (id: number) => api.delete(`/content/admin/media/${id}/`),
  /** Testimonials (BACKLOG P2-15). */
  getTestimonials: () => api.get('/content/testimonials/'),
  adminListTestimonials: () => api.get('/content/admin/testimonials/'),
  adminCreateTestimonial: (data: TestimonialWrite) => api.post<Testimonial>('/content/admin/testimonials/', data),
  adminUpdateTestimonial: (id: number, data: Partial<TestimonialWrite>) => api.patch<Testimonial>(`/content/admin/testimonials/${id}/`, data),
  adminDeleteTestimonial: (id: number) => api.delete(`/content/admin/testimonials/${id}/`),

  // Costos por sección (editables por el colegio en el admin).
  getCosts: () =>
    api.get('/content/costs/'),

  // Paquete completo de precios 2026-2027: inscripción/reinscripción,
  // colegiaturas, seguros, extraescolares, estancia y políticas.
  getPricing: () =>
    api.get('/content/pricing/'),

  // Admin CMS — edit the public contact/social data.
  adminGetSettings: () => api.get('/content/admin/settings/'),
  adminUpdateSettings: (data: Record<string, unknown>) =>
    api.patch('/content/admin/settings/', data),
};
