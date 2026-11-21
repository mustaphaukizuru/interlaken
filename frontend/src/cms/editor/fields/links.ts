/**
 * Link destinations for the CMS editor (contract C5): what a stored href
 * means, whether it is valid, and how the picker builds one. Stored values
 * never change shape: an href is the same plain string a hand-typed field
 * held (`/admisiones`, `https://…`, `mailto:…`, `tel:…`, `https://wa.me/…`).
 */

/** Public pages of the site, with the titles the office knows them by. links.test.ts keeps this list in step with the page templates. */
export interface SitePage { path: string; title: string; group: string; note?: string }

export const SITE_PAGES: SitePage[] = [
  { path: '/', title: 'Inicio', group: 'El Colegio' },
  { path: '/nosotros', title: 'Nosotros (quiénes somos)', group: 'El Colegio' },
  { path: '/modelo-educativo', title: 'Modelo educativo', group: 'El Colegio' },
  { path: '/galeria', title: 'Galería', group: 'El Colegio' },
  { path: '/plataformas', title: 'Plataformas', group: 'El Colegio' },
  { path: '/niveles/preescolar', title: 'Preescolar', group: 'Niveles' },
  { path: '/niveles/primaria', title: 'Primaria', group: 'Niveles' },
  { path: '/niveles/secundaria', title: 'Secundaria', group: 'Niveles' },
  { path: '/admisiones', title: 'Admisiones', group: 'Admisiones' },
  { path: '/admisiones/costos', title: 'Costos', group: 'Admisiones' },
  { path: '/admisiones/documentacion', title: 'Documentación', group: 'Admisiones' },
  { path: '/agendar-visita', title: 'Agendar visita', group: 'Admisiones' },
  { path: '/pagos', title: 'Colegiaturas y cafetería (pagos)', group: 'Comunidad' },
  { path: '/comunidad/facturacion', title: 'Facturación', group: 'Comunidad' },
  { path: '/contacto', title: 'Contacto', group: 'Comunidad' },
  { path: '/login', title: 'Iniciar sesión (portal de familias)', group: 'Comunidad' },
  { path: '/aviso-de-privacidad', title: 'Aviso de privacidad', group: 'Comunidad' },
];

/**
 * Pages that only work from a personal link the school sends (a token): never offered as a destination.
 * The ficha de inscripción (/pre-registro) is one: the school sends it after the admission exam.
 */
export const PERSONAL_LINK_PATHS = ['/pre-registro', '/inscripcion/documentos', '/confirmar-correo'];

/** Sections of a page that can be linked directly (an id on the public page). */
export const SITE_ANCHORS: Record<string, { hash: string; title: string }[]> = {
  '/admisiones': [{ hash: 'estimador', title: 'Estimador de costos' }],
};

export type HrefKind = 'empty' | 'page' | 'web' | 'email' | 'phone' | 'whatsapp' | 'invalid';

export const KIND_LABEL: Record<Exclude<HrefKind, 'empty' | 'invalid'>, string> = {
  page: 'Página del sitio',
  web: 'Sitio web',
  email: 'Correo',
  phone: 'Teléfono',
  whatsapp: 'WhatsApp',
};

const WHATSAPP_RE = /^https:\/\/(wa\.me|api\.whatsapp\.com)\//i;

export function hrefKind(href: string | undefined | null): HrefKind {
  const h = (href ?? '').trim();
  if (!h) return 'empty';
  if (h.startsWith('mailto:')) return 'email';
  if (h.startsWith('tel:')) return 'phone';
  if (WHATSAPP_RE.test(h) || h === '/whatsapp' || h.startsWith('/whatsapp/')) return 'whatsapp';
  if (h.startsWith('//')) return 'invalid';
  if (h.startsWith('/') || h.startsWith('#')) return 'page';
  if (/^https?:\/\//i.test(h)) return 'web';
  return 'invalid';
}

/** Why an href cannot be used, in plain Spanish; null when it is fine (or empty). */
export function hrefProblem(href: string | undefined | null): string | null {
  const h = (href ?? '').trim();
  if (!h) return null;
  if (/^(javascript|data|vbscript):/i.test(h)) return 'Este tipo de enlace no está permitido.';
  if (h.startsWith('mailto:')) return /^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(h) ? null : 'Revise el correo: debe tener la forma nombre@dominio.mx.';
  if (h.startsWith('tel:')) return /^tel:\+?[\d\s()-]{7,20}$/.test(h) ? null : 'Revise el teléfono: escriba solo números, por ejemplo 55 5379 1188.';
  if (/\s/.test(h)) return 'El enlace no puede llevar espacios.';
  if (h.startsWith('//')) return 'Para otro sitio escriba la dirección completa, empezando con https://.';
  if (h.startsWith('/') || h.startsWith('#')) return null;
  if (/^https?:\/\/[^/\s.]+(\.[^/\s.]+)+(\/|\?|#|$)/i.test(h)) return null;
  if (/^https?:\/\//i.test(h)) return 'Revise la dirección web: parece incompleta.';
  return 'Elija una página del sitio o escriba una dirección completa que empiece con https://.';
}

/** Path part of an internal href (no query, no hash, no trailing slash). */
export const pathOf = (href: string) => (href.split(/[?#]/)[0].replace(/\/+$/, '') || '/');

export interface HrefInfo { kind: HrefKind; title: string; detail: string; warning?: string }

/** What the editor shows for a stored href: the destination's name and its address. */
export function describeHref(href: string | undefined | null, pages: SitePage[] = SITE_PAGES): HrefInfo {
  const h = (href ?? '').trim();
  const kind = hrefKind(h);
  switch (kind) {
    case 'empty':
      return { kind, title: 'Sin destino', detail: '' };
    case 'page': {
      if (h.startsWith('#')) return { kind, title: 'Una sección de esta misma página', detail: h };
      const path = pathOf(h);
      const page = pages.find((p) => p.path === path);
      const hash = h.includes('#') ? h.slice(h.indexOf('#') + 1) : '';
      const anchor = hash ? SITE_ANCHORS[path]?.find((a) => a.hash === hash) : undefined;
      if (!page && PERSONAL_LINK_PATHS.includes(path)) {
        return { kind, title: `Página ${path}`, detail: h, warning: 'Esta página solo se abre con el enlace personal que envía el colegio. Elija otra, por ejemplo Agendar visita.' };
      }
      if (!page) return { kind, title: `Página ${path}`, detail: h, warning: 'No encontramos esta página en el sitio. Revise que exista o elija otra.' };
      return { kind, title: anchor ? `${page.title} · ${anchor.title}` : page.title, detail: h, warning: page.note };
    }
    case 'web': {
      let host = h;
      try { host = new URL(h).host.replace(/^www\./, ''); } catch { /* keep the raw text */ }
      return { kind, title: `Sitio web: ${host}`, detail: h, warning: h.startsWith('http://') ? 'Este sitio no usa conexión segura (https). Si existe la versión https, úsela.' : undefined };
    }
    case 'email':
      return { kind, title: `Correo: ${decodeURIComponent(h.slice(7).split('?')[0])}`, detail: h };
    case 'phone':
      return { kind, title: `Llamar al ${h.slice(4)}`, detail: h };
    case 'whatsapp': {
      const wa = parseWhatsApp(h);
      return { kind, title: wa.number ? `WhatsApp: ${wa.number}` : 'WhatsApp del colegio', detail: wa.message ? `Mensaje: «${wa.message}»` : h };
    }
    default:
      return { kind, title: 'Enlace por revisar', detail: h };
  }
}

/* ── Builders (picker → stored href) and parsers (stored href → picker) ── */

const digits = (s: string) => s.replace(/\D/g, '');

export function buildWeb(input: string): string {
  const v = input.trim();
  if (!v) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v.replace(/^\/+/, '')}`;
}

export const buildEmail = (input: string) => (input.trim() ? `mailto:${input.trim()}` : '');

/** 10 digits are a Mexican number: +52 is added. */
export function buildPhone(input: string): string {
  const d = digits(input);
  if (!d) return '';
  if (input.trim().startsWith('+')) return `tel:+${d}`;
  return d.length === 10 ? `tel:+52${d}` : `tel:${d}`;
}

export function buildWhatsApp(number: string, message = ''): string {
  let d = digits(number);
  if (!d) return '';
  if (d.length === 10) d = `52${d}`;
  return `https://wa.me/${d}${message.trim() ? `?text=${encodeURIComponent(message.trim())}` : ''}`;
}

export function parseWhatsApp(href: string): { number: string; message: string } {
  try {
    const u = new URL(href);
    const number = u.host === 'wa.me' ? u.pathname.slice(1) : (u.searchParams.get('phone') ?? '');
    return { number: digits(number), message: u.searchParams.get('text') ?? '' };
  } catch {
    return { number: '', message: '' };
  }
}

/** Markdown-style links inside a text: `[Texto](/ruta)` (the syntax pagos/plataformas notes render). */
export const MARK_LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/** hrefs inside sanitized rich text (`<a href="…">`). */
export function htmlHrefs(html: string): string[] {
  return Array.from(html.matchAll(/href=["']([^"']*)["']/gi), (m) => m[1]);
}
