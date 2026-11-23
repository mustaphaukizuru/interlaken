/**
 * Runtime helpers for designed sections (docs/CMS-COMPLETION-PLAN.md):
 * text tokens, image refs (media-library id or a built-in /assets photo),
 * and the curated icon and colour palettes the editor offers.
 */
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { announcedCycleStart, cycleLabel, FOUNDED_YEAR, SCHOOL_YEARS } from '@/lib/siteMeta';
import { imageSrc, imageSrcSet, rememberMedia } from './media';
import { useSiteSettings } from '@/hooks/useSiteSettings';

/* ── Text tokens ─────────────────────────────────────────────────────────── */

/** Tokens usable in any section text; they keep years, cycle and contact data current. */
export const TEXT_TOKENS = ['ciclo', 'anios', 'fundacion', 'anio', 'telefono', 'correo', 'direccion', 'horario', 'whatsapp'] as const;
const TOKEN_RE = /\{\{\s*(ciclo|anios|fundacion|anio|telefono|correo|direccion|horario|whatsapp)\s*\}\}/g;

type TokenSettings = { phone_display?: string; contact_email?: string; address?: string; office_hours?: string; whatsapp_number?: string; admissions_next_from_month?: number };

/** `over` replaces a token's value in one place (Costos: {{ciclo}} is the cycle of the published prices). */
export function applyTokens(text: string, s: TokenSettings, over?: Partial<Record<string, string>>): string {
  if (!text || !text.includes('{{')) return text;
  const map: Record<string, string> = {
    ciclo: cycleLabel(announcedCycleStart(new Date(), s.admissions_next_from_month ?? 1)),
    anios: String(SCHOOL_YEARS),
    fundacion: String(FOUNDED_YEAR),
    anio: String(new Date().getFullYear()),
    telefono: s.phone_display ?? '',
    correo: s.contact_email ?? '',
    direccion: s.address ?? '',
    horario: s.office_hours ?? '',
    whatsapp: s.whatsapp_number ?? '',
    ...over,
  };
  return text.replace(TOKEN_RE, (_, k: string) => map[k] ?? '');
}

/** `t(text)` replaces tokens; tolerant of undefined/non-string props. `over` as in applyTokens. */
export function useTokens(over?: Partial<Record<string, string>>): (text: unknown) => string {
  const s = useSiteSettings();
  const ciclo = over?.ciclo;
  return useCallback(
    (text: unknown) => (typeof text === 'string' ? applyTokens(text, s, ciclo ? { ciclo } : undefined) : text == null ? '' : String(text)),
    [s, ciclo],
  );
}

/* ── Images ──────────────────────────────────────────────────────────────── */

type MediaMeta = Record<string, { alt?: string; width?: number | null; height?: number | null; variants?: string[] }>;
const MediaMetaContext = createContext<MediaMeta>({});

/** Alt text, sizes and existing variants of the library images on a published page (served with the page). */
export function CmsMediaProvider({ media, children }: { media?: MediaMeta; children: ReactNode }) {
  // Idempotent: URLs built below (imageSrc/imageSrcSet) then ask only for sizes that exist.
  rememberMedia(media);
  return <MediaMetaContext.Provider value={media ?? {}}>{children}</MediaMetaContext.Provider>;
}

export { imageSrc, imageSrcSet, isImageRef } from './media';

/** src/srcSet/alt for an image prop; `fallbackAlt` is used when the library has none. */
export function useCmsImage(ref: unknown, fallbackAlt = '', opts: { full?: boolean; variant?: 'thumb' | 'md' | 'lg' } = {}) {
  const meta = useContext(MediaMetaContext);
  const alt = typeof ref === 'number' ? meta[String(ref)]?.alt || fallbackAlt : fallbackAlt;
  return { src: imageSrc(ref, opts.variant), srcSet: imageSrcSet(ref, opts), alt };
}

/** Alt lookup for lists of images (one hook call per list instead of per item). */
export function useMediaAlt(): (ref: unknown, fallback?: string) => string {
  const meta = useContext(MediaMetaContext);
  return useCallback((ref: unknown, fallback = '') => (typeof ref === 'number' ? meta[String(ref)]?.alt || fallback : fallback), [meta]);
}

/* ── Colours (icons: ./icons, so pages without icons do not ship the set) ── */

/** Brand colours (docs/DESIGN-TOKENS.md). Values are CSS custom properties. */
export const COLOR_OPTIONS = [
  { value: 'var(--purple)', label: 'Morado' },
  { value: 'var(--purple-mid)', label: 'Morado medio' },
  { value: 'var(--pink)', label: 'Rosa' },
  { value: 'var(--pink-hot)', label: 'Rosa intenso' },
  { value: 'var(--green)', label: 'Verde' },
  { value: 'var(--green-mid)', label: 'Verde medio' },
  { value: 'var(--coral)', label: 'Coral' },
  { value: 'var(--amber)', label: 'Ámbar' },
  { value: 'var(--nivel-preescolar)', label: 'Preescolar (aqua)' },
  { value: 'var(--nivel-primaria)', label: 'Primaria (rosa)' },
  { value: 'var(--nivel-secundaria)', label: 'Secundaria (amarillo)' },
];
export const cmsColor = (v: unknown, fallback = 'var(--purple)'): string =>
  typeof v === 'string' && /^(var\(--[a-z0-9-]+\)|#[0-9a-fA-F]{3,8})$/.test(v) ? v : fallback;

/* ── Links ───────────────────────────────────────────────────────────────── */

export interface CmsLink { label?: string; href?: string }
export const isExternal = (href: string) => /^(https?:|mailto:|tel:)/.test(href);
