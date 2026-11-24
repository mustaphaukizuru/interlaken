/**
 * Console-only helpers for SiteSettings.chrome (kept out of lib/siteChrome,
 * which every public page loads).
 */
/**
 * Saving one part of chrome must keep the parts other editors own: the
 * header/footer form and «Textos del sitio» each send only their keys.
 */
export function mergeChrome(stored: object | null | undefined, ownKeys: readonly string[], patch: object): Record<string, unknown> {
  const keep = Object.fromEntries(Object.entries(stored ?? {}).filter(([k]) => !ownKeys.includes(k)));
  return { ...keep, ...patch };
}

/** The keys the header/footer form (AdminNavigation ChromeEditor) owns. */
export const CHROME_KEYS = ['header_buttons', 'footer_tagline', 'footer_copyright', 'footer_note', 'sticky_label', 'sticky_href', 'sticky_icon'] as const;
