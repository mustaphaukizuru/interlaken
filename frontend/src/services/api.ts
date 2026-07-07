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

  getTransactions: (params?: { page?: number }) =>
    api.get('/cafeteria/transactions/', { params }),

  requestTopUp: (studentId: number, amount: number, method: string) =>
    api.post('/cafeteria/topup/', { student: studentId, amount, method }),

  // Admin
  getAllBalances: () =>
    api.get('/cafeteria/admin/balances/'),

  applyTopUp: (topupId: number) =>
    api.post(`/cafeteria/admin/topup/${topupId}/apply/`),

  syncBalance: (studentId: number) =>
    api.post(`/cafeteria/admin/sync/${studentId}/`),

  syncAll: () =>
    api.post('/cafeteria/admin/sync-all/'),
};

// ── PAYMENTS ─────────────────────────────────────────────
export const paymentsApi = {
  initiatePayment: (data: { amount: number; payment_type: string; description: string }) =>
    api.post('/payments/initiate/', data),

  getPaymentStatus: (paymentId: number) =>
    api.get(`/payments/${paymentId}/`),

  getMyPayments: () =>
    api.get('/payments/history/'),
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
