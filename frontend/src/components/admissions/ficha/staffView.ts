/**
 * The ficha seen by the school's staff (2026-11-21). The ficha is private:
 * families open it only with their personal link. An administrator, or a
 * staff account with the «admisiones» area (the console's own rule,
 * lib/areas), may open /pre-registro without a link and fill a ficha with a
 * family at the office; the server lets them start one with the public
 * start off (admissions views `_is_staff`).
 *
 * Never a flash of the wizard for a visitor: without a remembered login the
 * answer is «no» at once; a remembered staff login counts only once the
 * session is restored (App's bootstrapSession mints the access token), and
 * until then the page shows its loading state.
 */
import { useEffect, useState } from 'react';
import { areasOf, isAdmin } from '@/lib/areas';
import { useAuthStore, type User } from '@/store/authStore';

export type StaffView = 'unknown' | 'staff' | 'no';

/** Admin, or staff with the «admisiones» area. */
export const fillsFichasForFamilies = (user: User | null | undefined) => isAdmin(user) || areasOf(user).has('admisiones');

export function useStaffView(): StaffView {
  const [hydrated, setHydrated] = useState(() => useAuthStore.persist?.hasHydrated?.() ?? true);
  useEffect(() => {
    if (hydrated) return undefined;
    const done = () => setHydrated(true);
    const off = useAuthStore.persist?.onFinishHydration?.(done);
    if (useAuthStore.persist?.hasHydrated?.()) done();
    return off;
  }, [hydrated]);
  const user = useAuthStore((s) => s.user);
  const signedIn = useAuthStore((s) => s.isAuthenticated);
  const access = useAuthStore((s) => s.accessToken);
  if (!hydrated) return 'unknown';
  if (!signedIn || !fillsFichasForFamilies(user)) return 'no';
  return access ? 'staff' : 'unknown';
}
