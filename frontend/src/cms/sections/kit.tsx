/**
 * Building blocks for section modules (cms/sections/<group>.tsx): spec
 * builders, field shorthands, a link that handles internal and external
 * hrefs, motion wrapping and lazily loaded section components.
 */
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { FieldSpec } from '../blocks/registry';
import { COLOR_OPTIONS, isExternal, type CmsLink } from '../runtime';
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
type Opt = Partial<Pick<FieldSpec, 'required' | 'hint' | 'group'>>;
export const f = {
  text: (key: string, label: string, o: Opt = {}): FieldSpec => ({ key, label, kind: 'text', ...o }),
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
  action: (key: string, label: string, href: string, o: Opt = {}): FieldSpec => ({ key, label, kind: 'action', href, ...o }),
};

/** The usual heading trio of a section. */
export const headingFields = (o: { eyebrow?: boolean; text?: boolean } = {}): FieldSpec[] => [
  ...(o.eyebrow === false ? [] : [f.text('eyebrow', 'Etiqueta superior')]),
  f.text('title', 'Título'),
  ...(o.text ? [f.textarea('text', 'Texto')] : []),
];

/* ── Links ───────────────────────────────────────────────────────────────── */

/** Renders a CMS link prop as a router Link (internal) or <a> (external); nothing without href. */
export function CmsAnchor({ link, className, children, ariaLabel }: { link: CmsLink | undefined; className?: string; children?: ReactNode; ariaLabel?: string }) {
  const href = link?.href?.trim();
  if (!href) return null;
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
