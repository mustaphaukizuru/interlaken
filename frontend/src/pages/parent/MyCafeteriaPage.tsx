import CafeteriaPage from './CafeteriaPage';
import CredencialPage from './CredencialPage';
import { MineScope } from '@/lib/cafeteriaScope';

/**
 * /portal/mi-cafeteria — «Mi cafetería» (2026-11-18): a staff member's own
 * cafetería account (balance, movements, card top-up, statement, credential),
 * for a login that has the console (an admin such as colegio@, or staff with
 * console areas). The family pages render unchanged inside `MineScope`, so
 * every request asks for the caller's own account only (`?mine=1`).
 *
 * Staff whose login is portal-only already see their wallet in «Cafetería».
 */
export default function MyCafeteriaPage({ view }: { view?: 'credencial' }) {
  return (
    <MineScope.Provider value>
      {view === 'credencial' ? <CredencialPage /> : <CafeteriaPage />}
    </MineScope.Provider>
  );
}
