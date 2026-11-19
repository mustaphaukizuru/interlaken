import { createContext, useContext } from 'react';

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
