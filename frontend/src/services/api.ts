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
export const authApi = {
  googleLogin: () => {
    window.location.href = `${API_BASE}/auth/google/`;
  },
  me: () => api.get('/accounts/me/'),
  updateMe: (data: { first_name?: string; last_name?: string; whatsapp?: string; avatar?: string }) =>
    api.patch('/accounts/me/', data),
  requestPasswordReset: (email: string) =>
    api.post('/accounts/password-reset/', { email }),
  confirmPasswordReset: (data: { uid: string; token: string; password: string }) =>
    api.post('/accounts/password-reset/confirm/', data),
  setPassword: (password: string) =>
    api.post('/accounts/set-password/', { password }),
  getNotifPrefs: () =>
    api.get<{ email_enabled: boolean; in_app_enabled: boolean; push_enabled: boolean }>(
      '/accounts/notification-preferences/',
    ),
  updateNotifPrefs: (data: Partial<{ email_enabled: boolean; in_app_enabled: boolean; push_enabled: boolean }>) =>
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

export const admissionsApi = {
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

  // Family sets the saldo-bajo warning level for one of their children.
  updateLowBalanceThreshold: (studentId: number, threshold: number) =>
    api.patch(`/cafeteria/balance/${studentId}/threshold/`, { threshold }),

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
// Real money starts from finance invoice-pay or cafeteria top-up.
export const paymentsApi = {
  getPaymentStatus: (paymentId: number) =>
    api.get(`/payments/${paymentId}/`),

  getMyPayments: (params?: { page?: number }) =>
    api.get('/payments/history/', { params }),
};

// ── FINANCE / TUITION (Prompt 17) ─────────────────────────
export const financeApi = {
  // Parent
  getInvoices: (params?: { student?: number; status?: string; period?: string; page?: number }) =>
    api.get('/finance/invoices/', { params }),

  getInvoice: (id: number) =>
    api.get(`/finance/invoices/${id}/`),

  payInvoice: (id: number, gateway?: string) =>
    api.post(`/finance/invoices/${id}/pay/`, gateway ? { gateway } : {}),

  downloadReceipt: (id: number) =>
    api.get(`/finance/invoices/${id}/receipt/`, { responseType: 'blob' }),

  // Admin
  getDashboard: (period?: string) =>
    api.get('/finance/admin/dashboard/', { params: period ? { period } : {} }),

  getAdminInvoices: (params?: {
    status?: string; period?: string; student?: number; grade?: string; q?: string; page?: number;
  }) => api.get('/finance/admin/invoices/', { params }),

  getAdminInvoice: (id: number) =>
    api.get(`/finance/admin/invoices/${id}/`),

  getStudentLedger: (studentId: number) =>
    api.get(`/finance/admin/student/${studentId}/`),

  // Tuition plans (Planes de Colegiatura) CRUD.
  adminListFees: () => api.get('/finance/admin/fee-schedules/'),
  adminCreateFee: (data: Record<string, unknown>) => api.post('/finance/admin/fee-schedules/', data),
  adminUpdateFee: (id: number, data: Record<string, unknown>) => api.patch(`/finance/admin/fee-schedules/${id}/`, data),
  adminDeleteFee: (id: number) => api.delete(`/finance/admin/fee-schedules/${id}/`),

  // Per-student becas / descuentos CRUD.
  adminListDiscounts: (studentId: number) => api.get('/finance/admin/discounts/', { params: { student: studentId } }),
  adminCreateDiscount: (data: Record<string, unknown>) => api.post('/finance/admin/discounts/', data),
  adminUpdateDiscount: (id: number, data: Record<string, unknown>) => api.patch(`/finance/admin/discounts/${id}/`, data),
  adminDeleteDiscount: (id: number) => api.delete(`/finance/admin/discounts/${id}/`),

  markPaid: (id: number, reason?: string, method?: string) =>
    api.post(`/finance/admin/invoices/${id}/mark-paid/`, { reason, method }),

  adjustInvoice: (id: number, amount: number, reason: string) =>
    api.post(`/finance/admin/invoices/${id}/adjust/`, { amount, reason }),

  cancelInvoice: (id: number, reason: string) =>
    api.post(`/finance/admin/invoices/${id}/cancel/`, { reason }),

  /** Record offline refund of an applied online overpayment (Payment→REFUNDED). */
  refundOverpayment: (id: number, reason: string, paymentId?: number) =>
    api.post(`/finance/admin/invoices/${id}/refund/`, {
      reason,
      ...(paymentId != null ? { payment_id: paymentId } : {}),
    }),

  generate: (period?: string) =>
    api.post('/finance/admin/generate/', period ? { period } : {}),

  bulkAction: (invoiceIds: number[], action: 'mark_paid' | 'cancel' | 'remind', reason?: string) =>
    api.post('/finance/admin/bulk/', { invoice_ids: invoiceIds, action, reason }),
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
};

// ── CONTACT ───────────────────────────────────────────────
export const contactApi = {
  send: (data: { name: string; email: string; subject: string; message: string }) =>
    api.post('/contact/', data),
};

// ── BOOKINGS ──────────────────────────────────────────────
export const bookingsApi = {
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

  getStudents: (params?: { page?: number; search?: string }) =>
    api.get('/accounts/students/', { params }),

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
  getNotifications: () => api.get('/portal/notifications/'),
  markNotificationRead: (id: number) => api.post(`/portal/notifications/${id}/read/`),
  markAllNotificationsRead: () => api.post('/portal/notifications/mark-all-read/'),

  // Admin comunicados (announcements) CRUD.
  adminListAnnouncements: () => api.get('/portal/admin/announcements/'),
  adminCreateAnnouncement: (data: { title: string; body: string; audience: string; is_active?: boolean }) =>
    api.post('/portal/admin/announcements/', data),
  adminUpdateAnnouncement: (id: number, data: Record<string, unknown>) =>
    api.patch(`/portal/admin/announcements/${id}/`, data),
  adminDeleteAnnouncement: (id: number) =>
    api.delete(`/portal/admin/announcements/${id}/`),

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
};

// ── CONTENT (CMS) ─────────────────────────────────────────
export const contentApi = {
  // Public site settings — phone/social/contact data (server-cached 5 min).
  getSettings: () =>
    api.get('/content/settings/'),

  // Costos por sección (editables por el colegio en el admin).
  getCosts: () =>
    api.get('/content/costs/'),

  // Admin CMS — edit the public contact/social data.
  adminGetSettings: () => api.get('/content/admin/settings/'),
  adminUpdateSettings: (data: Record<string, unknown>) =>
    api.patch('/content/admin/settings/', data),
};
