import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastHost } from '@/components/ui/ToastHost';

import { bootstrapSession } from './services/api';
import { useAuthStore } from './store/authStore';

// Layouts & guards are part of the shell — keep them in the main chunk.
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { PublicLayout } from './components/layout/PublicLayout';
// PortalLayout is lazy ON PURPOSE (perf budget): it statically pulls the whole
// authenticated chrome — Sidebar, AppHeader, NotificationsMenu (which drags in
// date-fns + the `es` locale), AccountMenu, MobileTabBar, CommandPalette — and
// keeping it in the shell made every PUBLIC visitor download ~14 kB gz of
// portal-only code. Visitors never render it; portal users load it with their
// first portal route inside the existing route-level <Suspense>.
const PortalLayout = lazy(() =>
  import('./components/layout/PortalLayout').then((m) => ({ default: m.PortalLayout })),
);
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
const CredencialPage  = lazy(() => import('./pages/parent/CredencialPage'));
const CafeteriaTopupReturn = lazy(() => import('./pages/parent/CafeteriaTopupReturn'));
const PaymentsPage    = lazy(() => import('./pages/parent/PaymentsPage'));
const ComunicadosPage = lazy(() => import('./pages/parent/ComunicadosPage'));
const ComunicadoDetailPage = lazy(() => import('./pages/parent/ComunicadoDetailPage'));
const InscripcionesPage = lazy(() => import('./pages/parent/InscripcionesPage'));
const NotificationsPage = lazy(() => import('./pages/parent/NotificationsPage'));
const ProfilePage = lazy(() => import('./pages/parent/ProfilePage'));
const PrivacyPage = lazy(() => import('./pages/parent/PrivacyPage'));

// Staff dashboard
const StaffDashboard  = lazy(() => import('./pages/staff/StaffDashboard'));

// Admin portal
const AdminDashboard  = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminAnnouncements = lazy(() => import('./pages/admin/AdminAnnouncements'));
const AdminSettings   = lazy(() => import('./pages/admin/AdminSettings'));
const AdminAdmissions = lazy(() => import('./pages/admin/AdminAdmissions'));
const AdminCafeteria  = lazy(() => import('./pages/admin/AdminCafeteria'));
const AdminCafeteriaStudent = lazy(() => import('./pages/admin/AdminCafeteriaStudent'));
const AdminStudents   = lazy(() => import('./pages/admin/AdminStudents'));
const AdminStudentDetail = lazy(() => import('./pages/admin/AdminStudentDetail'));
const AdminBookings   = lazy(() => import('./pages/admin/AdminBookings'));
const AdminAudit      = lazy(() => import('./pages/admin/AdminAudit'));
import { CmsOverride } from './cms/CmsOverride';
const CmsPage = lazy(() => import('./cms/CmsPage'));
const CmsOrNotFound = lazy(() => import('./cms/CmsOrNotFound'));
const CalendarioPage = lazy(() => import('./pages/public/CalendarioPage'));
const AdminNavigation = lazy(() => import('./pages/admin/AdminNavigation'));
const AdminForms = lazy(() => import('./pages/admin/AdminForms'));
const AdminPages = lazy(() => import('./pages/admin/AdminPages'));
const AdminPageEditor = lazy(() => import('./pages/admin/AdminPageEditor'));
const AdminMedia = lazy(() => import('./pages/admin/AdminMedia'));
const AdminTestimonials = lazy(() => import('./pages/admin/AdminTestimonials'));
const AdminCalendar = lazy(() => import('./pages/admin/AdminCalendar'));
const DocumentsUploadPage = lazy(() => import('./pages/public/DocumentsUploadPage'));
const AdminStaffUsers = lazy(() => import('./pages/admin/AdminStaffUsers'));
const AdminContactInbox = lazy(() => import('./pages/admin/AdminContactInbox'));
const AdminPayments = lazy(() => import('./pages/admin/AdminPayments'));
const AdminPasswordRequests = lazy(() => import('./pages/admin/AdminPasswordRequests'));

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
        <ToastHost />
        <AnalyticsListener />
        <ErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* ── PUBLIC SITE ─────────────────────────────── */}
            <Route element={<PublicLayout />}>
              <Route path="/" element={<CmsOverride slug="inicio"><HomePage /></CmsOverride>} />
              <Route path="/nosotros" element={<CmsOverride slug="nosotros"><AboutPage /></CmsOverride>} />
              <Route path="/admisiones" element={<CmsOverride slug="admisiones"><AdmissionsPage /></CmsOverride>} />
              <Route path="/admisiones/documentacion" element={<CmsOverride slug="documentacion"><DocumentacionPage /></CmsOverride>} />
              <Route path="/admisiones/costos" element={<CmsOverride slug="costos"><CostosPage /></CmsOverride>} />
              <Route path="/pre-registro"  element={<PreRegisterPage />} />
              <Route path="/inscripcion"   element={<RegisterPage />} />
              <Route path="/inscripcion/documentos" element={<DocumentsUploadPage />} />
              {/* Puertas Abiertas is admin-only now (bookings console); public URL redirects. */}
              <Route path="/puertas-abiertas" element={<Navigate to="/agendar-visita" replace />} />
              <Route path="/agendar-visita" element={<BookVisitPage />} />
              <Route path="/contacto" element={<CmsOverride slug="contacto"><ContactPage /></CmsOverride>} />
              <Route path="/aviso-de-privacidad" element={<AvisoPrivacidadPage />} />
              {/* IA confirmada por el cliente (menú 2026-07) */}
              <Route path="/modelo-educativo" element={<CmsOverride slug="modelo-educativo"><ModeloEducativoPage /></CmsOverride>} />
              <Route path="/galeria" element={<CmsOverride slug="galeria"><GaleriaPage /></CmsOverride>} />
              <Route path="/niveles/:nivel"   element={<NivelPage />} />
              <Route path="/comunidad/plataformas" element={<CmsOverride slug="plataformas"><PlataformasPage /></CmsOverride>} />
              <Route path="/calendario" element={<CalendarioPage />} />
              <Route path="/comunidad/facturacion" element={<FacturacionPage />} />
              {/* 404 — honest not-found instead of a silent redirect home. */}
              <Route path="p/:slug" element={<CmsPage />} />
              <Route path="*" element={<CmsOrNotFound />} />
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
              <Route path="credencial" element={<CredencialPage />} />
              <Route path="cafeteria/recarga/retorno" element={<CafeteriaTopupReturn />} />
              <Route path="pagos"     element={<PaymentsPage />} />
              <Route path="inscripciones" element={<InscripcionesPage />} />
              <Route path="comunicados" element={<ComunicadosPage />} />
              <Route path="comunicados/:id" element={<ComunicadoDetailPage />} />
              <Route path="perfil"    element={<ProfilePage />} />
              <Route path="notificaciones" element={<NotificationsPage />} />
              <Route path="privacidad" element={<PrivacyPage />} />
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
              <Route path="alumnos"     element={<AdminStudents />} />
              <Route path="alumnos/:studentId" element={<AdminStudentDetail />} />
              <Route path="comunicados" element={<AdminAnnouncements />} />
              <Route path="ajustes"     element={<AdminSettings />} />
              <Route path="auditoria"   element={<AdminAudit />} />
              <Route path="contrasenas" element={<AdminPasswordRequests />} />
              <Route path="pagos"       element={<AdminPayments />} />
              <Route path="mensajes"    element={<AdminContactInbox />} />
              <Route path="usuarios"    element={<AdminStaffUsers />} />
              <Route path="calendario"  element={<AdminCalendar />} />
              <Route path="testimonios" element={<AdminTestimonials />} />
              <Route path="contenido" element={<AdminPages />} />
              <Route path="formularios" element={<AdminForms />} />
              <Route path="navegacion" element={<AdminNavigation />} />
              <Route path="contenido/medios" element={<AdminMedia />} />
              <Route path="contenido/:id" element={<AdminPageEditor />} />
            </Route>

          </Routes>
        </Suspense>
        </ErrorBoundary>
        <CookieConsent />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
