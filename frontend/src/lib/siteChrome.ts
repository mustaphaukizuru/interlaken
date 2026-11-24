/**
 * Site chrome copy (header buttons, footer text, mobile CTA): SiteSettings.chrome,
 * edited in Navegación. Every empty or missing value falls back to the built-in
 * one below, so the site never renders a blank button. Mirrors
 * backend/apps/content/navigation.py validate_chrome.
 */
/** `icon` names a lucide icon from the public menu's set (PublicLayout ICONS); unknown names draw none. */
export interface ChromeButton { label: string; href: string; primary?: boolean; icon?: string }

/** The tuition site (Servo Escolar): «Colegiaturas» in the header, the menu and /pagos. */
export const SERVO_ESCOLAR_URL = 'https://interlaken.servoescolar.mx/';

export interface SiteChrome {
  header_buttons: ChromeButton[];
  footer_tagline: string;
  footer_copyright: string;
  footer_note: string;
  sticky_label: string;
  sticky_href: string;
  /** The phone bar button's icon (a name from ChromeLink's set); blank = from its link. */
  sticky_icon: string;
}

export const CHROME_DEFAULTS: SiteChrome = {
  // Header version 3 (school, 2026-11-23): the two family payment links. From
  // 1024 px they are the header buttons (a signed-in visitor gets the avatar
  // in place of «Portal Cafetería»); on phones and tablets they open the menu
  // under «Pagos de familias». «Agendar visita» left the header: it is the
  // pill in the purple top bar and the button under that block in the menu.
  // Up to 4 fit (navigation.validate_chrome).
  header_buttons: [
    { label: 'Portal Cafetería', href: '/login', icon: 'Coffee' },
    { label: 'Colegiaturas', href: SERVO_ESCOLAR_URL, icon: 'CreditCard' },
  ],
  footer_tagline: 'Educación bilingüe de excelencia para el desarrollo integral de sus hijos. Tlalnepantla, Estado de México.',
  footer_copyright: '© {{anio}} Colegio Interlaken · Todos los derechos reservados',
  footer_note: 'Reconocimiento de validez oficial · SEP',
  // The phone bar's button, also the one button of the tablet header (version 3: «Pagos»).
  sticky_label: 'Pagos',
  sticky_href: '/pagos',
  sticky_icon: '',
};

const text = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim() : fallback);

export function resolveChrome(c: Partial<SiteChrome> | null | undefined): SiteChrome {
  const buttons = Array.isArray(c?.header_buttons)
    ? c!.header_buttons.filter((b) => b && b.label?.trim() && b.href?.trim())
    : [];
  return {
    header_buttons: buttons.length ? buttons : CHROME_DEFAULTS.header_buttons,
    footer_tagline: text(c?.footer_tagline, CHROME_DEFAULTS.footer_tagline),
    // {{anio}} stays a token here (the Navegación form edits this value);
    // withYear() fills it in when the footer renders.
    footer_copyright: text(c?.footer_copyright, CHROME_DEFAULTS.footer_copyright),
    footer_note: text(c?.footer_note, CHROME_DEFAULTS.footer_note),
    sticky_label: text(c?.sticky_label, CHROME_DEFAULTS.sticky_label),
    sticky_href: text(c?.sticky_href, CHROME_DEFAULTS.sticky_href),
    sticky_icon: typeof c?.sticky_icon === 'string' ? c.sticky_icon.trim() : '',
  };
}

/** A year typed by hand after «©» (the end of a range such as «© 1981-2026»); null when there is none. */
const FIXED_YEAR = /(©\s*(?:(?:19|20)\d\d\s*[-–]\s*)?)((?:19|20)\d\d)(?!\d)/;
export function fixedCopyrightYear(text: string): string | null {
  return FIXED_YEAR.exec(text ?? '')?.[2] ?? null;
}
/** The same line with that year as «Año en curso» ({{anio}}). */
export function copyrightWithToken(text: string): string {
  return (text ?? '').replace(FIXED_YEAR, (_m, pre: string) => `${pre}{{anio}}`);
}

/**
 * The copyright line with {{anio}} as the current year, split into text parts
 * (the year its own text node, as the hand-written footer rendered it). Safety
 * net (owner, 2026-11-22): a past year typed by hand after «©» shows as the
 * current one too, so the footer never says last year.
 */
export function withYear(text: string): string[] {
  const year = Number(fixedCopyrightYear(text));
  if (year && year < new Date().getFullYear()) text = copyrightWithToken(text);
  return text.split(/(\{\{\s*anio\s*\}\})/g).map((part) => (/^\{\{\s*anio\s*\}\}$/.test(part) ? String(new Date().getFullYear()) : part)).filter(Boolean);
}

export const isExternalHref = (href: string) => /^https?:/.test(href);

/* ── Site texts (Navegación → «Textos del sitio») ─────────────────────────
 * More site-wide copy in the same SiteSettings.chrome JSON: cookie banner,
 * prefilled WhatsApp messages, the contact bubble, footer legal links, the
 * privacy note under forms, the admission steps and the offline page.
 * Each consumer keeps its own built-in text (so the main bundle does not
 * carry copy only lazy pages use); blank = that built-in text. Mirrors
 * backend/apps/content/navigation.py SITE_TEXTS.
 */
export type SiteTextKey =
  | 'cookie_text' | 'cookie_link' | 'cookie_decline' | 'cookie_accept'
  | 'wa_admissions' | 'wa_visit' | 'wa_float' | 'wa_password' | 'wa_estimator'
  | 'float_whatsapp' | 'float_visit' | 'float_password'
  | 'nav_contact' | 'footer_contact' | 'skip_link' | 'nav_payments'
  | 'privacy_note' | 'privacy_link'
  | 'funnel_1' | 'funnel_2' | 'funnel_3' | 'funnel_4' | 'funnel_now' | 'funnel_done' | 'funnel_next'
  | 'offline_title' | 'offline_accent' | 'offline_text' | 'offline_retry' | 'offline_home';

export interface FooterLink { label: string; href: string }

export type SiteTexts = Partial<Record<SiteTextKey, string>> & { legal_links?: FooterLink[] };

/** Built-in words of the header, footer and skip link (components/layout/PublicLayout). */
export const LAYOUT_TEXT_DEFAULTS = {
  nav_contact: 'Contacto',
  footer_contact: 'Contacto',
  skip_link: 'Saltar al contenido',
  // Header version 3: the label over the payment links in the phone/tablet
  // menu. «Agendar visita» (top bar pill, menu button) is the bubble's
  // float_visit text, so the three always say the same.
  nav_payments: 'Pagos de familias',
} as const;

/** «Agendar visita»: the purple top bar's pill and the menu button (header version 3). */
export const VISIT_HREF = '/agendar-visita';

/** Footer bottom-bar links when Navegación has none. */
export const LEGAL_LINKS_DEFAULT: FooterLink[] = [{ label: 'Aviso de Privacidad', href: '/aviso-de-privacidad' }];

/** A site text from chrome, or `fallback` when it is blank or missing (the server stores them trimmed). */
export function siteText(chrome: unknown, key: SiteTextKey, fallback: string): string {
  const v = (chrome as Record<string, unknown> | null | undefined)?.[key];
  return typeof v === 'string' && v ? v : fallback;
}

/** Every text of `builtIn` as the school edited it (blank or missing = built-in). */
export function siteTexts<T extends Partial<Record<SiteTextKey, string>>>(chrome: unknown, builtIn: T): T {
  const out = { ...builtIn };
  for (const k in builtIn) out[k] = siteText(chrome, k as SiteTextKey, builtIn[k] as string) as T[typeof k];
  return out;
}

/** Footer legal links from chrome (valid ones only), else the built-in list. */
export function legalLinks(chrome: unknown): FooterLink[] {
  const raw = (chrome as SiteTexts | null | undefined)?.legal_links;
  const list = Array.isArray(raw) ? raw.filter((l) => l?.label && l.href) : [];
  return list.length ? list : LEGAL_LINKS_DEFAULT;
}

