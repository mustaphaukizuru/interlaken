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
export const OFFLINE_KEYS = ['offline_title', 'offline_accent', 'offline_text', 'offline_retry', 'offline_home'] as const;

/** The built-in text of public/offline.html (keep both in sync). */
export const OFFLINE_DEFAULTS = {
  offline_title: 'Sin conexión a',
  offline_accent: 'internet',
  offline_text: 'No pudimos cargar esta página. Verifique su conexión Wi-Fi o de datos móviles e intente de nuevo. Cuando la conexión regrese, el portal se mostrará normalmente.',
  offline_retry: 'Reintentar',
  offline_home: 'Ir al portal',
} as const;

export function saveOfflineCopy(chrome: unknown): void {
  try {
    const c = (chrome && typeof chrome === 'object' ? chrome : {}) as Record<string, unknown>;
    const copy = Object.fromEntries(
      OFFLINE_KEYS.map((k) => [k, typeof c[k] === 'string' ? (c[k] as string).trim() : '']).filter(([, v]) => v),
    );
    if (Object.keys(copy).length) localStorage.setItem(OFFLINE_COPY_KEY, JSON.stringify(copy));
    else localStorage.removeItem(OFFLINE_COPY_KEY);
  } catch {
    // Private mode or storage disabled: the offline page keeps its built-in text.
  }
}
