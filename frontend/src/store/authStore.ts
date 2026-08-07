/**
 * authStore.ts — Global auth state (Zustand).
 *
 * SECURITY: the access token lives in memory ONLY (never localStorage) and is
 * short-lived. The refresh token is an httpOnly cookie the browser manages — it
 * is never visible to JS. Only `user` + `isAuthenticated` are persisted (for a
 * snappy reload); the access token is re-minted via a silent cookie refresh on
 * load (see services/api.ts `bootstrapSession`). See AUTH.md.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: 'admin' | 'parent' | 'student' | 'staff';
  avatar: string;
  whatsapp: string;
  has_usable_password?: boolean;
  notif_prefs?: {
    email_enabled: boolean;
    in_app_enabled: boolean;
    push_enabled: boolean;
  };
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;

  /** Set after login: user + fresh in-memory access token. */
  setAuth: (user: User, access: string) => void;
  /** Update just the in-memory access token (silent refresh). */
  setAccess: (access: string) => void;
  setUser: (user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,

      setAuth: (user, access) =>
        set({ user, accessToken: access, isAuthenticated: true }),

      setAccess: (access) => set({ accessToken: access, isAuthenticated: true }),

      setUser: (user) => set({ user }),

      logout: () => set({ user: null, accessToken: null, isAuthenticated: false }),
    }),
    {
      name: 'interlaken-auth',
      // Never persist the access token — memory only.
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
