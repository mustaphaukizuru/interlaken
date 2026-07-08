/**
 * api.ts — Axios instance & all API calls for Interlaken
 */
import axios from 'axios';

// Single source of truth: VITE_API_BASE_URL is the backend host (no path).
// The REST API lives under /api/v1; the OAuth redirect lives under /auth.
const API_HOST = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const BASE_URL = `${API_HOST}/api/v1`;

export const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-refresh on 401
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const refresh = localStorage.getItem('refresh_token');
        const { data } = await axios.post(`${BASE_URL}/accounts/token/refresh/`, { refresh });
        localStorage.setItem('access_token', data.access);
        original.headers.Authorization = `Bearer ${data.access}`;
        return api(original);
      } catch {
        localStorage.clear();
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// ── AUTH ──────────────────────────────────────────────────
export const authApi = {
  googleLogin: () => {
    window.location.href = `${API_HOST}/auth/google/`;
  },
  me: () => api.get('/accounts/me/'),
  refresh: (refresh: string) => api.post('/accounts/token/refresh/', { refresh }),
  logout: () => { localStorage.clear(); window.location.href = '/'; },
};

// ── ADMISSIONS ────────────────────────────────────────────
export const admissionsApi = {
  preRegister: (data: unknown) =>
    api.post('/admissions/pre-register/', data),

  createRegistration: (data: unknown) =>
    api.post('/admissions/register/', data),

  getRegistration: (id: number) =>
    api.get(`/admissions/register/${id}/`),

  updateRegistration: (id: number, data: unknown) =>
    api.patch(`/admissions/register/${id}/`, data),

  submitRegistration: (id: number) =>
    api.post(`/admissions/register/${id}/submit/`),

  uploadDocument: (registrationId: number, file: File, docType: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('doc_type', docType);
    return api.post(`/admissions/register/${registrationId}/documents/`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  getOpenSchoolEvents: () =>
    api.get('/admissions/open-school/'),

  signUpOpenSchool: (data: unknown) =>
    api.post('/admissions/open-school/signup/', data),
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

  requestTopUp: (
    studentId: number,
    amount: number,
    method: string,
    gateway?: string,
  ) =>
    api.post('/cafeteria/topup/', { student: studentId, amount, method, gateway }),

  // Admin
  getAllBalances: () =>
    api.get('/cafeteria/admin/balances/'),

  applyTopUp: (topupId: number) =>
    api.post(`/cafeteria/admin/topup/${topupId}/apply/`),

  syncBalance: (studentId: number) =>
    api.post(`/cafeteria/admin/sync/${studentId}/`),

  syncAll: () =>
    api.post('/cafeteria/admin/sync-all/'),

  // Admin console (Phase D)
  getTopUpLog: (params?: { status?: string; method?: string; from?: string; to?: string }) =>
    api.get('/cafeteria/admin/topups/', { params }),

  getStudentDetail: (studentId: number) =>
    api.get(`/cafeteria/admin/student/${studentId}/`),

  adjustBalance: (studentId: number, amount: number, reason: string) =>
    api.post(`/cafeteria/admin/adjust/${studentId}/`, { amount, reason }),

  refundTransaction: (txId: number, reason?: string) =>
    api.post(`/cafeteria/admin/refund/${txId}/`, { reason }),

  reconcile: (onlyDrift?: boolean) =>
    api.get('/cafeteria/admin/reconcile/', { params: onlyDrift ? { only: 'drift' } : {} }),

  getLowBalance: () =>
    api.get('/cafeteria/admin/low-balance/'),

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
export const paymentsApi = {
  initiatePayment: (data: { amount: number; payment_type: string; description: string }) =>
    api.post('/payments/initiate/', data),

  getPaymentStatus: (paymentId: number) =>
    api.get(`/payments/${paymentId}/`),

  getMyPayments: () =>
    api.get('/payments/history/'),
};

// ── FINANCE / TUITION (Prompt 17) ─────────────────────────
export const financeApi = {
  // Parent
  getInvoices: (params?: { student?: number; status?: string; period?: string }) =>
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
    status?: string; period?: string; student?: number; grade?: string; q?: string;
  }) => api.get('/finance/admin/invoices/', { params }),

  getAdminInvoice: (id: number) =>
    api.get(`/finance/admin/invoices/${id}/`),

  getStudentLedger: (studentId: number) =>
    api.get(`/finance/admin/student/${studentId}/`),

  markPaid: (id: number, reason?: string, method?: string) =>
    api.post(`/finance/admin/invoices/${id}/mark-paid/`, { reason, method }),

  adjustInvoice: (id: number, amount: number, reason: string) =>
    api.post(`/finance/admin/invoices/${id}/adjust/`, { amount, reason }),

  cancelInvoice: (id: number, reason: string) =>
    api.post(`/finance/admin/invoices/${id}/cancel/`, { reason }),

  generate: (period?: string) =>
    api.post('/finance/admin/generate/', period ? { period } : {}),

  bulkAction: (invoiceIds: number[], action: 'mark_paid' | 'cancel' | 'remind', reason?: string) =>
    api.post('/finance/admin/bulk/', { invoice_ids: invoiceIds, action, reason }),
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
    start_date: string;
    end_date: string;
    weekdays: number[];
    window_start: string;
    window_end: string;
    interval_minutes?: number;
    capacity?: number;
    location?: string;
  }) => api.post('/bookings/availability/', data),

  getAdminBookings: (params?: { type?: string; status?: string; date?: string }) =>
    api.get('/bookings/admin/bookings/', { params }),

  bookingAction: (id: number, action: 'confirm' | 'cancel' | 'attended' | 'no_show') =>
    api.post(`/bookings/admin/bookings/${id}/${action}/`),
};

// ── PORTAL ────────────────────────────────────────────────
export const portalApi = {
  getDashboard: () =>
    api.get('/portal/dashboard/'),

  getStudents: () =>
    api.get('/accounts/students/'),
};
