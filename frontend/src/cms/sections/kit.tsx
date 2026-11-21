/**
 * Building blocks for section modules (cms/sections/<group>.tsx): spec
 * builders, field shorthands, a link that handles internal and external
 * hrefs, motion wrapping and lazily loaded section components.
 */
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { FieldSpec } from '../blocks/registry';
import { COLOR_OPTIONS, isExternal, useTokens, type CmsLink } from '../runtime';
import { registerModule } from './index';
import type { PageTemplate, SectionModule, SectionSpec } from './types';

type SpecInput = Omit<SectionSpec, 'group' | 'type'> & { type: string };

/** `const section = sectionsOf('home')` then `section({ type: 'hero', ... })` → type `home.hero`. */
export function sectionsOf(group: string) {
  return (spec: SpecInput): SectionSpec => ({ ...spec, group, type: `${group}.${spec.type}` });
}

/** Registers the module's sections and templates as soon as it is imported. */
export function defineModule(sections: SectionSpec[], templates: PageTemplate[]): SectionModule {
  const mod = { sections, templates };
  registerModule(mod);
  return mod;
}

/* ── Field shorthands ────────────────────────────────────────────────────── */
type Opt = Partial<Pick<FieldSpec, 'required' | 'hint' | 'group' | 'advanced' | 'slugFrom' | 'optionsFrom' | 'marks' | 'minWidth' | 'limits'>>;
export const f = {
  text: (key: string, label: string, o: Opt = {}): FieldSpec => ({ key, label, kind: 'text', ...o }),
  /** A link destination (page of the site, web address, e-mail, phone, WhatsApp) stored as a string. */
  href: (key: string, label: string, o: Opt = {}): FieldSpec => ({ key, label, kind: 'href', ...o }),
  textarea: (key: string, label: string, o: Opt = {}): FieldSpec => ({ key, label, kind: 'textarea', ...o }),
  richtext: (key: string, label: string, o: Opt = {}): FieldSpec => ({ key, label, kind: 'richtext', ...o }),
  image: (key: string, label: string, o: Opt = {}): FieldSpec => ({ key, label, kind: 'image', ...o }),
  images: (key: string, label: string, o: Opt = {}): FieldSpec => ({ key, label, kind: 'images', ...o }),
  link: (key: string, label: string, o: Opt = {}): FieldSpec => ({ key, label, kind: 'link', ...o }),
  url: (key: string, label: string, o: Opt = {}): FieldSpec => ({ key, label, kind: 'url', ...o }),
  number: (key: string, label: string, o: Opt = {}): FieldSpec => ({ key, label, kind: 'number', ...o }),
  toggle: (key: string, label: string, o: Opt = {}): FieldSpec => ({ key, label, kind: 'toggle', ...o }),
  // Options come from cms/icons in the editor, so section chunks do not ship the icon set.
  icon: (key: string, label = 'Ícono', o: Opt = {}): FieldSpec => ({ key, label, kind: 'icon', ...o }),
  color: (key: string, label = 'Color', o: Opt = {}): FieldSpec => ({ key, label, kind: 'color', options: COLOR_OPTIONS, ...o }),
  select: (key: string, label: string, options: { value: string; label: string }[], o: Opt = {}): FieldSpec => ({ key, label, kind: 'select', options, ...o }),
  items: (key: string, label: string, item: FieldSpec[], o: Opt = {}): FieldSpec => ({ key, label, kind: 'items', item, ...o }),
  /** A button to a console screen (opens in a new tab); `hint` says what is edited there. */
  action: (key: string, label: string, actionHref: string, o: Opt = {}): FieldSpec => ({ key, label, kind: 'action', actionHref, ...o }),
};

/**
 * Field groups (C4) are one key, FieldSpec.group: set it per field through
 * `Opt` (`f.text(k, l, { group })`) or for a run of fields with
 * `grouped('Mensajes', [f.text(...), ...])`. Both write the same key; the
 * editor shows consecutive fields of a group as one collapsible group.
 */
export const grouped = (group: string, fields: FieldSpec[]): FieldSpec[] => fields.map((x) => ({ ...x, group }));

/**
 * Fills `{name}` placeholders of an editable text with values the page
 * computes (a count, a grade, an e-mail). Unknown names stay as written.
 * Site tokens ({{ciclo}}, {{correo}}...) are a different syntax and are
 * replaced by useTokens before this runs.
 */
export function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

/** The usual heading trio of a section. */
export const headingFields = (o: { eyebrow?: boolean; text?: boolean } = {}): FieldSpec[] => [
  ...(o.eyebrow === false ? [] : [f.text('eyebrow', 'Etiqueta superior')]),
  f.text('title', 'Título'),
  ...(o.text ? [f.textarea('text', 'Texto')] : []),
];

/* ── Links ───────────────────────────────────────────────────────────────── */

/*
 * The admission CTAs of the public pages. The ficha de inscripción is private
 * (the school sends it to each admitted family after the exam), so no public
 * page links to /pre-registro: the first step is a visit or a question.
 * backend/apps/content/migrations/0033 mirrors these two values.
 */
/** «Agendar visita»: the first step of the admission process. */
export const VISIT_CTA = { label: 'Agendar visita', href: '/agendar-visita' } as const satisfies CmsLink;
/** «Solicitar informes» by WhatsApp: `{{whatsapp}}` is the number in Ajustes (no number = no button). */
export const INFORMES_CTA = {
  label: 'Solicitar informes',
  href: 'https://wa.me/{{whatsapp}}?text=Hola%2C%20me%20gustar%C3%ADa%20recibir%20informes%20de%20admisi%C3%B3n%20del%20Colegio%20Interlaken.',
} as const satisfies CmsLink;

type AnchorProps = { link: CmsLink | undefined; className?: string; children?: ReactNode; ariaLabel?: string };

/** Renders a CMS link prop as a router Link (internal) or <a> (external); nothing without href. */
export function CmsAnchor(props: AnchorProps) {
  const href = props.link?.href?.trim();
  if (!href) return null;
  // Site tokens in an href ({{whatsapp}}) need the settings: only those links read them.
  if (href.includes('{{')) return <TokenAnchor {...props} href={href} />;
  return <Anchor {...props} href={href} />;
}

function TokenAnchor({ href, ...props }: AnchorProps & { href: string }) {
  const t = useTokens();
  const resolved = t(href);
  // A WhatsApp link without the school's number would open an empty chat.
  if (/^https:\/\/wa\.me\/(\?|$)/.test(resolved)) return null;
  return <Anchor {...props} href={resolved} />;
}

function Anchor({ link, href, className, children, ariaLabel }: AnchorProps & { href: string }) {
  const content = children ?? link?.label;
  if (isExternal(href)) {
    const newTab = href.startsWith('http');
    return <a href={href} className={className} aria-label={ariaLabel} {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{content}</a>;
  }
  return <Link to={href} className={className} aria-label={ariaLabel}>{content}</Link>;
}

/** Text with line breaks: each newline in the prop becomes a <br />. */
export function Lines({ text }: { text: string }) {
  const parts = text.split('\n');
  return <>{parts.map((line, i) => <span key={i}>{i > 0 && <br />}{line}</span>)}</>;
}

export const asLink = (v: unknown): CmsLink => (v && typeof v === 'object' ? (v as CmsLink) : {});
export const asList = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/* ── Lazy components (motion wrapping: ./motion, so pages without framer do not ship it) ── */

/** A section component from a lazily loaded chunk (below-the-fold sections keep the first paint light). */
export function lazySection(load: () => Promise<Record<string, unknown>>, name: string, minHeight = '40vh'): ComponentType<any> {
  const L = lazy(async () => ({ default: (await load())[name] as ComponentType<any> }));
  const Wrapped = (props: Record<string, unknown>) => <Suspense fallback={<div style={{ minHeight }} />}><L {...props} /></Suspense>;
  Wrapped.displayName = `lazySection(${name})`;
  return Wrapped;
}
