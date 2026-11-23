import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastHost } from '@/components/ui/ToastHost';

import { bootstrapSession } from './services/api';
import { useAuthStore } from './store/authStore';
import { bindQueryCacheToUser } from './lib/queryCacheOwner';

// The public layout is part of the shell; the signed-in route tables
// (portal, staff, admin) load on demand from routes/ConsoleRoutes.
import { PublicLayout } from './components/layout/PublicLayout';
const consoleRoutes = () => import('./routes/ConsoleRoutes');
const PortalRoutes = lazy(() => consoleRoutes().then((m) => ({ default: m.PortalRoutes })));
const StaffRoutes = lazy(() => consoleRoutes().then((m) => ({ default: m.StaffRoutes })));
const AdminRoutes = lazy(() => consoleRoutes().then((m) => ({ default: m.AdminRoutes })));
import { CookieConsent } from './components/CookieConsent';
import { AnalyticsListener } from './components/analytics/AnalyticsListener';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ScrollManager } from './components/layout/ScrollManager';

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
// Design-system reference, DEV only: the conditional keeps the chunk out of production builds.
const DesignSystemPage = import.meta.env.DEV ? lazy(() => import('./pages/dev/DesignSystemPage')) : () => null;



import { prefetchPublishedPage } from './cms/published';
const CmsPage = lazy(() => import('./cms/CmsPage'));
const CmsOrNotFound = lazy(() => import('./cms/CmsOrNotFound'));
const DocumentsUploadPage = cmsRoute('inscripcion-documentos', () => import('./pages/public/DocumentsUploadPage'));

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
        <ScrollManager />
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
            {import.meta.env.DEV && <Route path="/_design" element={<DesignSystemPage />} />}

            {/* ── SIGNED-IN AREAS (routes/ConsoleRoutes, one lazy chunk) ── */}
            <Route path="/portal/*" element={<PortalRoutes />} />
            {/* Student portal merged into the family portal: /alumno* redirects. */}
            <Route path="/alumno/*" element={<Navigate to="/portal" replace />} />
            <Route path="/staff/*" element={<StaffRoutes />} />
            <Route path="/admin/*" element={<AdminRoutes />} />

          </Routes>
        </Suspense>
        </ErrorBoundary>
        <CookieConsent />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
