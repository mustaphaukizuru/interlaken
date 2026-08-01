import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';

import { bootstrapSession } from './services/api';
import { useAuthStore } from './store/authStore';

// Layouts & guards are part of the shell — keep them in the main chunk.
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { PublicLayout } from './components/layout/PublicLayout';
import { PortalLayout } from './components/layout/PortalLayout';
import { CookieConsent } from './components/CookieConsent';
import { AnalyticsListener } from './components/analytics/AnalyticsListener';
import { ErrorBoundary } from './components/ErrorBoundary';

// Public pages — route-level code splitting (each becomes its own chunk).
const HomePage        = lazy(() => import('./pages/public/HomePage'));
const AboutPage       = lazy(() => import('./pages/public/AboutPage'));
const AdmissionsPage  = lazy(() => import('./pages/public/AdmissionsPage'));
const DocumentacionPage = lazy(() => import('./pages/public/DocumentacionPage'));
const CostosPage      = lazy(() => import('./pages/public/CostosPage'));
const PreRegisterPage = lazy(() => import('./pages/public/PreRegisterPage'));
const RegisterPage    = lazy(() => import('./pages/public/RegisterPage'));
const OpenSchoolPage  = lazy(() => import('./pages/public/OpenSchoolPage'));
const BookVisitPage   = lazy(() => import('./pages/public/BookVisitPage'));
const ContactPage     = lazy(() => import('./pages/public/ContactPage'));
const AvisoPrivacidadPage = lazy(() => import('./pages/public/AvisoPrivacidadPage'));
const NotFoundPage    = lazy(() => import('./pages/public/NotFoundPage'));
const NivelPage       = lazy(() => import('./pages/public/NivelPage'));
const ModeloEducativoPage = lazy(() => import('./pages/public/ModeloEducativoPage'));
const GaleriaPage     = lazy(() => import('./pages/public/GaleriaPage'));
const PlataformasPage = lazy(() => import('./pages/public/PlataformasPage'));
const FacturacionPage = lazy(() => import('./pages/public/FacturacionPage'));

// Auth
const LoginPage       = lazy(() => import('./pages/auth/LoginPage'));
const SandboxCheckout = lazy(() => import('./pages/public/SandboxCheckout'));

// Parent portal
const ParentDashboard = lazy(() => import('./pages/parent/ParentDashboard'));
const CafeteriaPage   = lazy(() => import('./pages/parent/CafeteriaPage'));
const CafeteriaTopupReturn = lazy(() => import('./pages/parent/CafeteriaTopupReturn'));
const PaymentsPage    = lazy(() => import('./pages/parent/PaymentsPage'));
const ColegiaturasPage = lazy(() => import('./pages/parent/ColegiaturasPage'));
const ColegiaturaPaymentReturn = lazy(() => import('./pages/parent/ColegiaturaPaymentReturn'));
const ComunicadosPage = lazy(() => import('./pages/parent/ComunicadosPage'));
const ComunicadoDetailPage = lazy(() => import('./pages/parent/ComunicadoDetailPage'));

// Staff dashboard
const StaffDashboard  = lazy(() => import('./pages/staff/StaffDashboard'));

// Admin portal
const AdminDashboard  = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminAnnouncements = lazy(() => import('./pages/admin/AdminAnnouncements'));
const AdminSettings   = lazy(() => import('./pages/admin/AdminSettings'));
const AdminFees       = lazy(() => import('./pages/admin/AdminFees'));
const AdminAdmissions = lazy(() => import('./pages/admin/AdminAdmissions'));
const AdminCafeteria  = lazy(() => import('./pages/admin/AdminCafeteria'));
const AdminCafeteriaStudent = lazy(() => import('./pages/admin/AdminCafeteriaStudent'));
const AdminStudents   = lazy(() => import('./pages/admin/AdminStudents'));
const AdminStudentDetail = lazy(() => import('./pages/admin/AdminStudentDetail'));
const AdminBookings   = lazy(() => import('./pages/admin/AdminBookings'));
const AdminFinance    = lazy(() => import('./pages/admin/AdminFinance'));

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
  // On reload, a previously-authenticated user has no in-memory access token;
  // silently re-mint one from the httpOnly refresh cookie (see AUTH.md).
  useEffect(() => {
    const s = useAuthStore.getState();
    if (s.isAuthenticated && !s.accessToken) void bootstrapSession();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Toaster position="top-right" />
        <AnalyticsListener />
        <ErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* ── PUBLIC SITE ─────────────────────────────── */}
            <Route element={<PublicLayout />}>
              <Route path="/"              element={<HomePage />} />
              <Route path="/nosotros"      element={<AboutPage />} />
              <Route path="/admisiones"    element={<AdmissionsPage />} />
              <Route path="/admisiones/documentacion" element={<DocumentacionPage />} />
              <Route path="/admisiones/costos" element={<CostosPage />} />
              <Route path="/pre-registro"  element={<PreRegisterPage />} />
              <Route path="/inscripcion"   element={<RegisterPage />} />
              <Route path="/puertas-abiertas" element={<OpenSchoolPage />} />
              <Route path="/agendar-visita" element={<BookVisitPage />} />
              <Route path="/contacto"      element={<ContactPage />} />
              <Route path="/aviso-de-privacidad" element={<AvisoPrivacidadPage />} />
              {/* IA confirmada por el cliente (menú 2026-07) */}
              <Route path="/modelo-educativo" element={<ModeloEducativoPage />} />
              <Route path="/galeria"          element={<GaleriaPage />} />
              <Route path="/niveles/:nivel"   element={<NivelPage />} />
              <Route path="/comunidad/plataformas" element={<PlataformasPage />} />
              <Route path="/comunidad/facturacion" element={<FacturacionPage />} />
              {/* 404 — honest not-found instead of a silent redirect home. */}
              <Route path="*" element={<NotFoundPage />} />
            </Route>

            {/* ── AUTH ────────────────────────────────────── */}
            {/* Google OAuth returns to /login?login=ok — /auth/* is reserved for
                the backend (Vite proxy + SPA catch-all both send it to Django). */}
            <Route path="/login" element={<LoginPage />} />
            {/* Mock hosted-payment page — DEV only. It's a neutral bank-styled
                page with an attacker-controllable amount/return_url, so mounting
                it in production would be an open-redirect + phishing surface; in
                prod the real gateway's hosted page is used instead. */}
            {import.meta.env.DEV && (
              <Route path="/pago/simulado" element={<SandboxCheckout />} />
            )}

            {/* ── PARENT PORTAL ───────────────────────────── */}
            <Route path="/portal" element={
              <ProtectedRoute roles={['parent', 'student', 'staff', 'admin']}>
                <PortalLayout role="parent" />
              </ProtectedRoute>
            }>
              <Route index            element={<ParentDashboard />} />
              <Route path="cafeteria" element={<CafeteriaPage />} />
              <Route path="cafeteria/recarga/retorno" element={<CafeteriaTopupReturn />} />
              <Route path="colegiaturas" element={<ColegiaturasPage />} />
              <Route path="colegiaturas/retorno" element={<ColegiaturaPaymentReturn />} />
              <Route path="pagos"     element={<PaymentsPage />} />
              <Route path="comunicados" element={<ComunicadosPage />} />
              <Route path="comunicados/:id" element={<ComunicadoDetailPage />} />
            </Route>

            {/* Student portal merged into the family portal — /alumno* redirects. */}
            <Route path="/alumno/*" element={<Navigate to="/portal" replace />} />

            {/* ── STAFF ANALYTICS DASHBOARD ───────────────── */}
            <Route path="/staff" element={
              <ProtectedRoute roles={['staff', 'admin']}>
                <PortalLayout role="staff" />
              </ProtectedRoute>
            }>
              <Route index element={<StaffDashboard />} />
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
              <Route path="finanzas"    element={<AdminFinance />} />
              <Route path="planes"      element={<AdminFees />} />
              <Route path="alumnos"     element={<AdminStudents />} />
              <Route path="alumnos/:studentId" element={<AdminStudentDetail />} />
              <Route path="comunicados" element={<AdminAnnouncements />} />
              <Route path="ajustes"     element={<AdminSettings />} />
            </Route>

          </Routes>
        </Suspense>
        </ErrorBoundary>
        <CookieConsent />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
