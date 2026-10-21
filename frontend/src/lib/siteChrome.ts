/**
 * Site chrome copy (header buttons, footer text, mobile CTA): SiteSettings.chrome,
 * edited in Navegación. Every empty or missing value falls back to the built-in
 * one below, so the site never renders a blank button. Mirrors
 * backend/apps/content/navigation.py validate_chrome.
 */
export interface ChromeButton { label: string; href: string; primary?: boolean }

export interface SiteChrome {
  header_buttons: ChromeButton[];
  footer_tagline: string;
  footer_copyright: string;
  footer_note: string;
  sticky_label: string;
  sticky_href: string;
}

export const CHROME_DEFAULTS: SiteChrome = {
  header_buttons: [
    { label: 'Pagos', href: 'https://interlaken.servoescolar.mx' },
    { label: 'Cafetería', href: '/login' },
    { label: 'Agendar visita', href: '/agendar-visita', primary: true },
  ],
  footer_tagline: 'Educación bilingüe de excelencia para el desarrollo integral de sus hijos. Tlalnepantla, Estado de México.',
  footer_copyright: '© {{anio}} Colegio Interlaken · Todos los derechos reservados',
  footer_note: 'Reconocimiento de validez oficial · SEP',
  sticky_label: 'Agendar visita',
  sticky_href: '/agendar-visita',
};

const text = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim() : fallback);

export function resolveChrome(c: Partial<SiteChrome> | null | undefined): SiteChrome {
  const buttons = Array.isArray(c?.header_buttons)
    ? c!.header_buttons.filter((b) => b && b.label?.trim() && b.href?.trim())
    : [];
  return {
    header_buttons: buttons.length ? buttons : CHROME_DEFAULTS.header_buttons,
    footer_tagline: text(c?.footer_tagline, CHROME_DEFAULTS.footer_tagline),
    footer_copyright: text(c?.footer_copyright, CHROME_DEFAULTS.footer_copyright).replace(/\{\{\s*anio\s*\}\}/g, String(new Date().getFullYear())),
    footer_note: text(c?.footer_note, CHROME_DEFAULTS.footer_note),
    sticky_label: text(c?.sticky_label, CHROME_DEFAULTS.sticky_label),
    sticky_href: text(c?.sticky_href, CHROME_DEFAULTS.sticky_href),
  };
}

export const isExternalHref = (href: string) => /^https?:/.test(href);
