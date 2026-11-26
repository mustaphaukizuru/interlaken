/**
 * The signed-in route tables (family portal, staff analytics, admin console),
 * loaded only when someone opens /portal, /staff or /admin.
 *
 * They used to sit in App.tsx, so every public visitor downloaded about sixty
 * lazy() stubs and <Route> elements they never use (the home page's JS budget
 * named this as the structural follow-up). App.tsx now mounts these three
 * tables through one lazy chunk; paths here are relative to /portal, /staff
 * and /admin.
 */
import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { AdminOnlyPage } from '@/components/layout/ConsoleAreaGuard';

// PortalLayout stays its own chunk: the sidebar, header and notifications
// (date-fns + `es` locale) load with the first console page, as before.
const PortalLayout = lazy(() =>
  import('@/components/layout/PortalLayout').then((m) => ({ default: m.PortalLayout })),
);

// Parent portal
const ParentDashboard = lazy(() => import('@/pages/parent/ParentDashboard'));
const CafeteriaPage   = lazy(() => import('@/pages/parent/CafeteriaPage'));
const CredencialPage  = lazy(() => import('@/pages/parent/CredencialPage'));
const CafeteriaTopupReturn = lazy(() => import('@/pages/parent/CafeteriaTopupReturn'));
const MyCafeteriaPage = lazy(() => import('@/pages/parent/MyCafeteriaPage'));
// Bitácora 10 (14/10/2026): Comunicados and Inscripciones are off the family portal (their pages
// stay so they can return). Pagos keeps the cafetería payments; only colegiaturas are «Próximamente».
const PaymentsPage = lazy(() => import('@/pages/parent/PaymentsPage'));
const NotificationsPage = lazy(() => import('@/pages/parent/NotificationsPage'));
const NotificationDetailPage = lazy(() => import('@/pages/parent/NotificationDetailPage'));
const ProfilePage = lazy(() => import('@/pages/parent/ProfilePage'));
const PrivacyPage = lazy(() => import('@/pages/parent/PrivacyPage'));

// Staff dashboard
const StaffDashboard  = lazy(() => import('@/pages/staff/StaffDashboard'));

// Admin console
const AdminDashboard  = lazy(() => import('@/pages/admin/AdminDashboard'));
const AdminAnnouncements = lazy(() => import('@/pages/admin/AdminAnnouncements'));
const AdminSettings   = lazy(() => import('@/pages/admin/AdminSettings'));
// Admisiones list, pipeline and Expediente: one entry (see AdmissionsConsole).
const AdmissionsConsole = lazy(() => import('@/pages/admin/AdmissionsConsole'));
const AdminCafeteria  = lazy(() => import('@/pages/admin/AdminCafeteria'));
const AdminCafeteriaStudent = lazy(() => import('@/pages/admin/AdminCafeteriaStudent'));
const AdminStudents   = lazy(() => import('@/pages/admin/AdminStudents'));
const AdminStudentDetail = lazy(() => import('@/pages/admin/AdminStudentDetail'));
const AdminBookings   = lazy(() => import('@/pages/admin/AdminBookings'));
const AdminAudit      = lazy(() => import('@/pages/admin/AdminAudit'));
const AdminVisitsWeek = lazy(() => import('@/pages/admin/AdminVisitsWeek'));
const AdminRequiredDocs = lazy(() => import('@/pages/admin/AdminRequiredDocs'));
const AdminArco = lazy(() => import('@/pages/admin/AdminArco'));
const AdminGuardianMerge = lazy(() => import('@/pages/admin/AdminGuardianMerge'));
const AdminFamilies = lazy(() => import('@/pages/admin/AdminFamilies'));
const AdminSchoolYear = lazy(() => import('@/pages/admin/AdminSchoolYear'));
const AdminNavigation = lazy(() => import('@/pages/admin/AdminNavigation'));
const AdminForms = lazy(() => import('@/pages/admin/AdminForms'));
const AdminPages = lazy(() => import('@/pages/admin/AdminPages'));
const AdminPageEditor = lazy(() => import('@/pages/admin/AdminPageEditor'));
const AdminMedia = lazy(() => import('@/pages/admin/AdminMedia'));
const AdminPrivacyNotice = lazy(() => import('@/pages/admin/AdminPrivacyNotice'));
const AdminTestimonials = lazy(() => import('@/pages/admin/AdminTestimonials'));
const AdminPricing = lazy(() => import('@/pages/admin/AdminPricing'));
const AdminCalendar = lazy(() => import('@/pages/admin/AdminCalendar'));
const AdminStaffUsers = lazy(() => import('@/pages/admin/AdminStaffUsers'));
const AdminContactInbox = lazy(() => import('@/pages/admin/AdminContactInbox'));
const AdminPayments = lazy(() => import('@/pages/admin/AdminPayments'));
const AdminPasswordRequests = lazy(() => import('@/pages/admin/AdminPasswordRequests'));

/** /portal/*: the family portal. */
export function PortalRoutes() {
  return (
    <Routes>
      <Route element={
        <ProtectedRoute roles={['parent', 'student', 'staff', 'admin']}>
          <PortalLayout role="parent" />
        </ProtectedRoute>
      }>
        <Route index            element={<ParentDashboard />} />
        <Route path="cafeteria" element={<CafeteriaPage />} />
        <Route path="credencial" element={<CredencialPage />} />
        <Route path="cafeteria/recarga/retorno" element={<CafeteriaTopupReturn />} />
        {/* A staff member's own wallet. Console users are sent to /admin/mi-cafeteria
            (MyCafeteriaPage); a staff login without console areas stays here. */}
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
        {/* Unknown /portal/... addresses go to the portal home (they used to fall through to the CMS 404). */}
        <Route path="*" element={<Navigate to="/portal" replace />} />
      </Route>
    </Routes>
  );
}

/**
 * /staff/*: the «Panel de Dirección» and the site content, administrators
 * only (QA 2026-11-24). A staff account is sent to its console area, or told
 * why it has none (AdminOnlyPage).
 */
export function StaffRoutes() {
  return (
    <Routes>
      <Route element={
        <ProtectedRoute roles={['staff', 'admin']}>
          <PortalLayout role="staff" />
        </ProtectedRoute>
      }>
        <Route index element={<AdminOnlyPage><StaffDashboard /></AdminOnlyPage>} />
        <Route path="contenido" element={<AdminOnlyPage><AdminPages /></AdminOnlyPage>} />
        <Route path="contenido/medios" element={<AdminOnlyPage><AdminMedia /></AdminOnlyPage>} />
        <Route path="contenido/:id" element={<AdminOnlyPage><AdminPageEditor /></AdminOnlyPage>} />
        <Route path="*" element={<Navigate to="/staff" replace />} />
      </Route>
    </Routes>
  );
}

/** /admin/*: the admin console. */
export function AdminRoutes() {
  return (
    <Routes>
      <Route element={
        <ProtectedRoute roles={['admin', 'staff']}>
          {/* Staff see only their console areas: ConsoleAreaGuard inside PortalLayout. */}
          <PortalLayout role="admin" />
        </ProtectedRoute>
      }>
        <Route index              element={<AdminDashboard />} />
        <Route path="admisiones"  element={<AdmissionsConsole page="list" />} />
        <Route path="admisiones/pipeline" element={<AdmissionsConsole page="pipeline" />} />
        <Route path="admisiones/documentos" element={<AdminRequiredDocs />} />
        <Route path="admisiones/:caseId" element={<AdmissionsConsole page="case" />} />
        <Route path="visitas"     element={<AdminBookings />} />
        <Route path="visitas/semana" element={<AdminVisitsWeek />} />
        <Route path="cafeteria"   element={<AdminCafeteria />} />
        <Route path="cafeteria/:studentId" element={<AdminCafeteriaStudent />} />
        {/* The person's own staff wallet, inside the console (owner, 2026-11-25). */}
        <Route path="mi-cafeteria" element={<MyCafeteriaPage />} />
        <Route path="mi-cafeteria/credencial" element={<MyCafeteriaPage view="credencial" />} />
        <Route path="alumnos"     element={<AdminStudents />} />
        <Route path="alumnos/:studentId" element={<AdminStudentDetail />} />
        {/* Staff cafetería accounts and their console access (2026-11-25). */}
        <Route path="personal"    element={<AdminStudents mode="personal" />} />
        <Route path="personal/:studentId" element={<AdminStudentDetail />} />
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
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  );
}
