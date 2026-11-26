import { Navigate, useLocation } from 'react-router-dom';
import CafeteriaPage from './CafeteriaPage';
import CredencialPage from './CredencialPage';
import { MineScope } from '@/lib/cafeteriaScope';
import { MY_CAFETERIA_PATH, myCafeteriaPath } from '@/lib/areas';
import { useAuthStore } from '@/store/authStore';

/**
 * «Mi cafetería» (2026-11-18): a staff member's own cafetería account
 * (balance, movements, card top-up, statement, credential) for a login that
 * has the console (an admin such as colegio@, or staff with console areas).
 * The family pages render unchanged inside `MineScope`, so every request asks
 * for the caller's own account only (`?mine=1`).
 *
 * It lives at /admin/mi-cafeteria, inside the console (owner, 2026-11-25: at
 * /portal/mi-cafeteria the family frame replaced the admin menu and it looked
 * like the account had stopped being an administrator). A console user who
 * reaches the old portal address is sent there; a staff login without
 * console areas keeps the portal one.
 *
 * Staff whose login is portal-only already see their wallet in «Cafetería».
 */
export default function MyCafeteriaPage({ view }: { view?: 'credencial' }) {
  const user = useAuthStore((s) => s.user);
  const { pathname, search } = useLocation();
  if (myCafeteriaPath(user) === MY_CAFETERIA_PATH && !pathname.startsWith(MY_CAFETERIA_PATH)) {
    return <Navigate to={`${MY_CAFETERIA_PATH}${view === 'credencial' ? '/credencial' : ''}${search}`} replace />;
  }
  return (
    <MineScope.Provider value>
      {view === 'credencial' ? <CredencialPage /> : <CafeteriaPage />}
    </MineScope.Provider>
  );
}
