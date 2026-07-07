import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';

// Public pages
import HomePage        from './pages/public/HomePage';
import AboutPage       from './pages/public/AboutPage';
import AdmissionsPage  from './pages/public/AdmissionsPage';
import PreRegisterPage from './pages/public/PreRegisterPage';
import RegisterPage    from './pages/public/RegisterPage';
import OpenSchoolPage  from './pages/public/OpenSchoolPage';
import BookVisitPage   from './pages/public/BookVisitPage';
import ContactPage     from './pages/public/ContactPage';

// Auth
import LoginPage       from './pages/auth/LoginPage';

// Parent portal
import ParentDashboard   from './pages/parent/ParentDashboard';
import CafeteriaPage     from './pages/parent/CafeteriaPage';
import PaymentsPage      from './pages/parent/PaymentsPage';

// Student portal
import StudentDashboard  from './pages/student/StudentDashboard';
import StudentCafeteria  from './pages/student/StudentCafeteria';

// Admin portal
import AdminDashboard    from './pages/admin/AdminDashboard';
import AdminAdmissions   from './pages/admin/AdminAdmissions';
import AdminCafeteria    from './pages/admin/AdminCafeteria';
import AdminStudents     from './pages/admin/AdminStudents';
import AdminBookings     from './pages/admin/AdminBookings';

// Guards
import { ProtectedRoute }  from './components/layout/ProtectedRoute';
import { PublicLayout }    from './components/layout/PublicLayout';
import { PortalLayout }    from './components/layout/PortalLayout';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 1000 * 60 * 5 },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Toaster position="top-right" />
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
            <Route path="alumnos"     element={<AdminStudents />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
