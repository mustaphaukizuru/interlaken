/**
 * api.ts — Axios instance & all API calls for Interlaken
 */
import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

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
    window.location.href = `${import.meta.env.VITE_API_BASE || 'http://localhost:8000'}/auth/google/`;
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

// ── PORTAL ────────────────────────────────────────────────
export const portalApi = {
  getDashboard: () =>
    api.get('/portal/dashboard/'),

  getStudents: () =>
    api.get('/accounts/students/'),
};
