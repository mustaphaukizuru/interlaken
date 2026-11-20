/**
 * The offline page (public/offline.html) is a static file the service worker
 * precaches at build time, so it cannot fetch the school's edited copy when
 * it is shown (there is no network then). Instead the site keeps the copy
 * edited in Navegación → «Textos del sitio» (SiteSettings.chrome offline_*)
 * in localStorage whenever it loads the site settings, and public/offline.js
 * swaps it in. Nothing stored (first visit, storage blocked, nothing edited)
 * = the built-in text of offline.html.
 */
export const OFFLINE_COPY_KEY = 'ik:offline-copy';
export function saveOfflineCopy(chrome: unknown): void {
  try {
    const copy = Object.fromEntries(Object.entries(chrome && typeof chrome === 'object' ? chrome : {})
      .filter(([k, v]) => k.startsWith('offline_') && typeof v === 'string' && v.trim()));
    if (Object.keys(copy).length) localStorage.setItem(OFFLINE_COPY_KEY, JSON.stringify(copy));
    else localStorage.removeItem(OFFLINE_COPY_KEY);
  } catch {
    // Private mode or storage disabled: the offline page keeps its built-in text.
  }
}
