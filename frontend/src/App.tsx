import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastHost } from '@/components/ui/ToastHost';

import { bootstrapSession } from './services/api';
import { useAuthStore } from './store/authStore';
import { bindQueryCacheToUser } from './lib/queryCacheOwner';

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
// cmsRoute starts the published-CMS lookup in parallel with the chunk download
// (cms/published.ts), so an edited page costs no extra round trip.
const cmsRoute = <T extends ComponentType>(slug: string | (() => string | undefined), load: () => Promise<{ default: T }>) =>
  lazy(() => {
    const s = typeof slug === 'function' ? slug() : slug;
    if (s) prefetchPublishedPage(s);
    return load();
  });
const HomePage        = cmsRoute('inicio', () => import('./pages/public/HomePage'));
const AboutPage       = cmsRoute('nosotros', () => import('./pages/public/AboutPage'));
const AdmissionsPage  = cmsRoute('admisiones', () => import('./pages/public/AdmissionsPage'));
const DocumentacionPage = cmsRoute('documentacion', () => import('./pages/public/DocumentacionPage'));
const CostosPage      = cmsRoute('costos', () => import('./pages/public/CostosPage'));
const PreRegisterPage = cmsRoute('pre-registro', () => import('./pages/public/PreRegisterPage'));
const BookVisitPage   = cmsRoute('agendar-visita', () => import('./pages/public/BookVisitPage'));
const ContactPage     = cmsRoute('contacto', () => import('./pages/public/ContactPage'));
const AvisoPrivacidadPage = cmsRoute('aviso-de-privacidad', () => import('./pages/public/AvisoPrivacidadPage'));
const NotFoundPage    = cmsRoute('no-encontrada', () => import('./pages/public/NotFoundPage'));
const NivelPage       = cmsRoute(() => window.location.pathname.split('/')[2], () => import('./pages/public/NivelPage'));
const ModeloEducativoPage = cmsRoute('modelo-educativo', () => import('./pages/public/ModeloEducativoPage'));
const GaleriaPage     = cmsRoute('galeria', () => import('./pages/public/GaleriaPage'));
const PlataformasPage = cmsRoute('plataformas', () => import('./pages/public/PlataformasPage'));
const PagosPage = cmsRoute('pagos', () => import('./pages/public/PagosPage'));
const FacturacionPage = cmsRoute('facturacion', () => import('./pages/public/FacturacionPage'));

// Auth
const LoginPage       = cmsRoute('iniciar-sesion', () => import('./pages/auth/LoginPage'));
const ConfirmNotifyEmailPage = cmsRoute('confirmar-correo', () => import('./pages/public/ConfirmNotifyEmailPage'));
const SandboxCheckout = lazy(() => import('./pages/public/SandboxCheckout'));

// Parent portal
const ParentDashboard = lazy(() => import('./pages/parent/ParentDashboard'));
const CafeteriaPage   = lazy(() => import('./pages/parent/CafeteriaPage'));
const CredencialPage  = lazy(() => import('./pages/parent/CredencialPage'));
const CafeteriaTopupReturn = lazy(() => import('./pages/parent/CafeteriaTopupReturn'));
const MyCafeteriaPage = lazy(() => import('./pages/parent/MyCafeteriaPage'));
// Bitácora 10 (14/10/2026): Comunicados and Inscripciones are off the family portal (their pages
// stay so they can return). Pagos keeps the cafetería payments; only colegiaturas are «Próximamente».
const PaymentsPage = lazy(() => import('./pages/parent/PaymentsPage'));
const NotificationsPage = lazy(() => import('./pages/parent/NotificationsPage'));
const NotificationDetailPage = lazy(() => import('./pages/parent/NotificationDetailPage'));
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
import { prefetchPublishedPage } from './cms/published';
const CmsPage = lazy(() => import('./cms/CmsPage'));
const CmsOrNotFound = lazy(() => import('./cms/CmsOrNotFound'));
const AdminVisitsWeek = lazy(() => import('./pages/admin/AdminVisitsWeek'));
const AdminPipeline = lazy(() => import('./pages/admin/AdminPipeline'));
const AdminRequiredDocs = lazy(() => import('./pages/admin/AdminRequiredDocs'));
const AdminArco = lazy(() => import('./pages/admin/AdminArco'));
const AdminGuardianMerge = lazy(() => import('./pages/admin/AdminGuardianMerge'));
const AdminFamilies = lazy(() => import('./pages/admin/AdminFamilies'));
const AdminSchoolYear = lazy(() => import('./pages/admin/AdminSchoolYear'));
const AdminNavigation = lazy(() => import('./pages/admin/AdminNavigation'));
const AdminForms = lazy(() => import('./pages/admin/AdminForms'));
const AdminPages = lazy(() => import('./pages/admin/AdminPages'));
const AdminPageEditor = lazy(() => import('./pages/admin/AdminPageEditor'));
const AdminMedia = lazy(() => import('./pages/admin/AdminMedia'));
const AdminPrivacyNotice = lazy(() => import('./pages/admin/AdminPrivacyNotice'));
const AdminTestimonials = lazy(() => import('./pages/admin/AdminTestimonials'));
const AdminPricing = lazy(() => import('./pages/admin/AdminPricing'));
const AdminCalendar = lazy(() => import('./pages/admin/AdminCalendar'));
const DocumentsUploadPage = cmsRoute('inscripcion-documentos', () => import('./pages/public/DocumentsUploadPage'));
const AdminStaffUsers = lazy(() => import('./pages/admin/AdminStaffUsers'));
const AdminContactInbox = lazy(() => import('./pages/admin/AdminContactInbox'));
const AdminPayments = lazy(() => import('./pages/admin/AdminPayments'));
const AdminPasswordRequests = lazy(() => import('./pages/admin/AdminPasswordRequests'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 1000 * 60 * 5 },
  },
});
// Cached data belongs to one user: empty it on every login/logout/switch.
bindQueryCacheToUser(queryClient);

/** /inscripcion → /pre-registro with the same query (a staff link's rid and token). */
function ToFicha() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: '/pre-registro', search }} replace />;
}

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
              <Route path="/" element={<HomePage />} />
              <Route path="/nosotros" element={<AboutPage />} />
              <Route path="/admisiones" element={<AdmissionsPage />} />
              <Route path="/admisiones/documentacion" element={<DocumentacionPage />} />
              <Route path="/admisiones/costos" element={<CostosPage />} />
              <Route path="/pre-registro"  element={<PreRegisterPage />} />
              {/* The old wizard's staff links (?rid=&token=) open the ficha; the server also answers a 301. */}
              <Route path="/inscripcion"   element={<ToFicha />} />
              <Route path="/inscripcion/documentos" element={<DocumentsUploadPage />} />
              {/* Puertas Abiertas is admin-only now (bookings console); public URL redirects. */}
              <Route path="/puertas-abiertas" element={<Navigate to="/agendar-visita" replace />} />
              <Route path="/agendar-visita" element={<BookVisitPage />} />
              <Route path="/contacto" element={<ContactPage />} />
              <Route path="/aviso-de-privacidad" element={<AvisoPrivacidadPage />} />
              {/* IA confirmada por el cliente (menú 2026-07) */}
              <Route path="/modelo-educativo" element={<ModeloEducativoPage />} />
              <Route path="/galeria" element={<GaleriaPage />} />
              <Route path="/niveles/:nivel"   element={<NivelPage />} />
              {/* Bitácora 13/10/2026: la antigua Plataformas se divide en Pagos y Plataformas. */}
              <Route path="/comunidad/plataformas" element={<Navigate to="/pagos" replace />} />
              <Route path="/pagos" element={<PagosPage />} />
              <Route path="/plataformas" element={<PlataformasPage />} />
              {/* Calendario escolar left the public site (owner, 2026-11-08); old links land on the home page. */}
              <Route path="/calendario" element={<Navigate to="/" replace />} />
              <Route path="/comunidad/facturacion" element={<FacturacionPage />} />
              {/* 404 — honest not-found instead of a silent redirect home. */}
              <Route path="p/:slug" element={<CmsPage />} />
              <Route path="*" element={<CmsOrNotFound />} />
            </Route>

            {/* ── AUTH ────────────────────────────────────── */}
            {/* Google OAuth returns to /login?login=ok — /auth/* is reserved for
                the backend (Vite proxy + SPA catch-all both send it to Django). */}
            <Route path="/login" element={<LoginPage />} />
            {/* «Correo para avisos» link: public, the token is the proof (owner, 2026-11-08). */}
            <Route path="/confirmar-correo" element={<ConfirmNotifyEmailPage />} />
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
              {/* A staff member's own wallet, for logins that have the console. */}
              <Route path="mi-cafeteria" element={<MyCafeteriaPage />} />
              <Route path="mi-cafeteria/credencial" element={<MyCafeteriaPage view="credencial" />} />
              <Route path="pagos"     element={<PaymentsPage />} />
              <Route path="inscripciones" element={<Navigate to="/portal" replace />} />
              <Route path="comunicados" element={<Navigate to="/portal/notificaciones" replace />} />
              <Route path="comunicados/:id" element={<Navigate to="/portal/notificaciones" replace />} />
              <Route path="perfil"    element={<ProfilePage />} />
              <Route path="notificaciones" element={<NotificationsPage />} />
              <Route path="notificaciones/:id" element={<NotificationDetailPage />} />
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
              <Route path="contenido" element={<AdminPages />} />
              <Route path="contenido/medios" element={<AdminMedia />} />
              <Route path="contenido/:id" element={<AdminPageEditor />} />
            </Route>

            {/* ── ADMIN PORTAL ────────────────────────────── */}
            <Route path="/admin" element={
              <ProtectedRoute roles={['admin', 'staff']}>
                {/* Staff see only their console areas: ConsoleAreaGuard inside PortalLayout. */}
                <PortalLayout role="admin" />
              </ProtectedRoute>
            }>
              <Route index              element={<AdminDashboard />} />
              <Route path="admisiones"  element={<AdminAdmissions />} />
              <Route path="admisiones/pipeline" element={<AdminPipeline />} />
              <Route path="admisiones/documentos" element={<AdminRequiredDocs />} />
              <Route path="visitas"     element={<AdminBookings />} />
              <Route path="visitas/semana" element={<AdminVisitsWeek />} />
              <Route path="cafeteria"   element={<AdminCafeteria />} />
              <Route path="cafeteria/:studentId" element={<AdminCafeteriaStudent />} />
              <Route path="alumnos"     element={<AdminStudents />} />
              <Route path="alumnos/:studentId" element={<AdminStudentDetail />} />
              <Route path="familias"    element={<AdminFamilies />} />
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
              <Route path="costos" element={<AdminPricing />} />
              <Route path="nuevo-ciclo" element={<AdminSchoolYear />} />
              <Route path="fusionar-cuentas" element={<AdminGuardianMerge />} />
              <Route path="arco" element={<AdminArco />} />
              <Route path="contenido/medios" element={<AdminMedia />} />
              <Route path="contenido/:id" element={<AdminPageEditor />} />
              <Route path="aviso-privacidad" element={<AdminPrivacyNotice />} />
              <Route path="aviso-privacidad/:id" element={<AdminPrivacyNotice />} />
            </Route>

          </Routes>
        </Suspense>
        </ErrorBoundary>
        <CookieConsent />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
