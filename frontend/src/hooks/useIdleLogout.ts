import { useEffect } from 'react';
import toast from 'react-hot-toast';
import { authApi } from '@/services/api';

export const IDLE_MINUTES = 30;

/**
 * Signs staff/admin out after IDLE_MINUTES without pointer, keyboard, scroll
 * or touch activity (BACKLOG P4-7). Families are not timed out: the portal is
 * often left open on a phone and nothing there is sensitive beyond their own data.
 */
export function useIdleLogout(enabled: boolean, minutes = IDLE_MINUTES) {
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const fire = () => { toast('Sesión cerrada por inactividad.', { icon: '🔒' }); void authApi.logout(); };
    const reset = () => { clearTimeout(timer); timer = setTimeout(fire, minutes * 60_000); };
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'focus'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => { clearTimeout(timer); events.forEach((e) => window.removeEventListener(e, reset)); };
  }, [enabled, minutes]);
}
