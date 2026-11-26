import { createContext, useContext } from 'react';
import { myCafeteriaPath } from '@/lib/areas';
import { useAuthStore } from '@/store/authStore';

/**
 * «Mi cafetería» (2026-11-18). True while the family cafetería pages
 * (CafeteriaPage, CredencialPage) show the caller's OWN staff wallet: every
 * request then carries `mine=1`, which the API answers with that account only
 * whatever the caller's role. A console user (an admin such as colegio@, or
 * staff with console areas) reaches it from the «Mi cafetería» entry; the
 * console itself never changes.
 */
export const MineScope = createContext(false);

export const useMineScope = () => useContext(MineScope);

/**
 * The address of the caller's own wallet, for links back to it: inside the
 * console for a console user (/admin/mi-cafeteria, owner 2026-11-25), the
 * portal one otherwise.
 */
export const useMyCafeteriaPath = () =>
  myCafeteriaPath(useAuthStore((s) => s.user)) ?? '/portal/mi-cafeteria';
