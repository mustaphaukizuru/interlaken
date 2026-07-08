import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';

// Layouts & guards are part of the shell — keep them in the main chunk.
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { PublicLayout } from './components/layout/PublicLayout';
import { PortalLayout } from './components/layout/PortalLayout';
import { CookieConsent } from './components/CookieConsent';
import { AnalyticsListener } from './components/analytics/AnalyticsListener';

// Public pages — route-level code splitting (each becomes its own chunk).
const HomePage        = lazy(() => import('./pages/public/HomePage'));
const AboutPage       = lazy(() => import('./pages/public/AboutPage'));
const AdmissionsPage  = lazy(() => import('./pages/public/AdmissionsPage'));
const PreRegisterPage = lazy(() => import('./pages/public/PreRegisterPage'));
const RegisterPage    = lazy(() => import('./pages/public/RegisterPage'));
const OpenSchoolPage  = lazy(() => import('./pages/public/OpenSchoolPage'));
const BookVisitPage   = lazy(() => import('./pages/public/BookVisitPage'));
const ContactPage     = lazy(() => import('./pages/public/ContactPage'));

// Auth
const LoginPage       = lazy(() => import('./pages/auth/LoginPage'));

// Parent portal
const ParentDashboard = lazy(() => import('./pages/parent/ParentDashboard'));
const CafeteriaPage   = lazy(() => import('./pages/parent/CafeteriaPage'));
const CafeteriaTopupReturn = lazy(() => import('./pages/parent/CafeteriaTopupReturn'));
const PaymentsPage    = lazy(() => import('./pages/parent/PaymentsPage'));

// Student portal
const StudentDashboard = lazy(() => import('./pages/student/StudentDashboard'));
const StudentCafeteria  = lazy(() => import('./pages/student/StudentCafeteria'));

// Admin portal
const AdminDashboard  = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminAdmissions = lazy(() => import('./pages/admin/AdminAdmissions'));
const AdminCafeteria  = lazy(() => import('./pages/admin/AdminCafeteria'));
const AdminCafeteriaStudent = lazy(() => import('./pages/admin/AdminCafeteriaStudent'));
const AdminStudents   = lazy(() => import('./pages/admin/AdminStudents'));
const AdminBookings   = lazy(() => import('./pages/admin/AdminBookings'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 1000 * 60 * 5 },
  },
});

/** Lightweight fallback shown while a route chunk loads. */
function RouteFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="min-h-[60vh] flex items-center justify-center"
    >
      <div className="w-10 h-10 rounded-full border-4 border-brand-100 border-t-brand-600 animate-spin" />
      <span className="sr-only">Cargando…</span>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Toaster position="top-right" />
        <AnalyticsListener />
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* ── PUBLIC SITE ─────────────────────────────── */}
            <Route element={<PublicLayout />}>
              <Route path="/"              element={<HomePage />} />
              <Route path="/nosotros"      element={<AboutPage />} />
              <Route path="/admisiones"    element={<AdmissionsPage />} />
              <Route path="/pre-registro"  element={<PreRegisterPage />} />
              <Route path="/inscripcion"   element={<RegisterPage />} />
              <Route path="/puertas-abiertas" element={<OpenSchoolPage />} />
              <Route path="/agendar-visita" element={<BookVisitPage />} />
              <Route path="/contacto"      element={<ContactPage />} />
            </Route>

            {/* ── AUTH ────────────────────────────────────── */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/auth/callback" element={<LoginPage />} />

            {/* ── PARENT PORTAL ───────────────────────────── */}
            <Route path="/portal" element={
              <ProtectedRoute roles={['parent', 'admin']}>
                <PortalLayout role="parent" />
              </ProtectedRoute>
            }>
              <Route index            element={<ParentDashboard />} />
              <Route path="cafeteria" element={<CafeteriaPage />} />
              <Route path="cafeteria/recarga/retorno" element={<CafeteriaTopupReturn />} />
              <Route path="pagos"     element={<PaymentsPage />} />
            </Route>

            {/* ── STUDENT PORTAL ──────────────────────────── */}
            <Route path="/alumno" element={
              <ProtectedRoute roles={['student', 'admin']}>
                <PortalLayout role="student" />
              </ProtectedRoute>
            }>
              <Route index            element={<StudentDashboard />} />
              <Route path="cafeteria" element={<StudentCafeteria />} />
            </Route>

            {/* ── ADMIN PORTAL ────────────────────────────── */}
            <Route path="/admin" element={
              <ProtectedRoute roles={['admin']}>
                <PortalLayout role="admin" />
              </ProtectedRoute>
            }>
              <Route index              element={<AdminDashboard />} />
              <Route path="admisiones"  element={<AdminAdmissions />} />
              <Route path="visitas"     element={<AdminBookings />} />
              <Route path="cafeteria"   element={<AdminCafeteria />} />
              <Route path="cafeteria/:studentId" element={<AdminCafeteriaStudent />} />
              <Route path="alumnos"     element={<AdminStudents />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        <CookieConsent />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
