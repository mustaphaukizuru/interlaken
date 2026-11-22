/**
 * Views shared by the Pagos and Plataformas sections (both pages are built
 * from the same hero, platform-card grid and info note). Each module
 * registers its own section types with its own defaults.
 */
import { Fragment } from 'react';
import { Coffee, CreditCard, GraduationCap, HeartHandshake, Info, Mail, Tablet } from 'lucide-react';
import { Section } from '@/components/ui/Section';
import { Reveal } from '@/components/ui/Reveal';
import { PlatformCard } from '@/components/public/PlatformCard';
import { iconResolver } from '../iconRuntime';
import { imageSrc, imageSrcSet, useTokens } from '../runtime';
import { asList, CmsAnchor, f, Lines } from './kit';
import type { FieldSpec } from '../blocks/registry';

/** The icons this module's defaults use; any other curated icon loads on demand. */
const cmsIcon = iconResolver({ GraduationCap, HeartHandshake, Mail, Tablet, Coffee, CreditCard });

// Icons these pages used that the curated CMS set does not include yet.

/* ── Portada ────────────────────────────────────────────────────────────── */
export interface HeroProps { label?: string; title?: string; subtitle?: string; image?: number | string }
export function PlatformsHeroView(p: HeroProps) {
  const t = useTokens();
  return (
    <section className="relative overflow-hidden bg-dark text-white">
      {p.image && (
        <img
          src={imageSrc(p.image)}
          srcSet={imageSrcSet(p.image, { full: true })}
          sizes="100vw"
          alt=""
          width={1600}
          height={900}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover opacity-30"
          loading="eager"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-dark/92 via-dark/75 to-dark/45" />
      <div className="relative mx-auto max-w-[1120px] px-4 py-14 sm:px-6 sm:py-16 lg:py-[72px]">
        {p.label && <span className="section-label-purple inline-flex">{t(p.label)}</span>}
        <h1 className="mt-3 font-head text-fluid-4xl font-black tracking-[-0.03em]">
          <Lines text={t(p.title)} />
        </h1>
        {p.subtitle && (
          <p className="mt-3 max-w-2xl text-[15.5px] leading-relaxed text-white/75 sm:text-base">
            {t(p.subtitle)}
          </p>
        )}
      </div>
    </section>
  );
}

export const heroFields: FieldSpec[] = [
  f.text('label', 'Etiqueta superior'), f.textarea('title', 'Título', { required: true }), f.textarea('subtitle', 'Texto'), f.image('image', 'Foto de fondo'),
];

/* ── Nota con enlaces ───────────────────────────────────────────────────── */
const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Text where `[Texto](/ruta)` becomes a link (router Link inside the site, <a> outside). */
function NoteText({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(<CmsAnchor key={at} link={{ label: m[1], href: m[2] }} className="font-medium text-green-dark underline" />);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out.map((n, i) => <Fragment key={i}>{n}</Fragment>)}</>;
}

/* ── Tarjetas de plataformas ────────────────────────────────────────────── */
export interface PlatformItem { name?: string; text?: string; icon?: string; href?: string; cta?: string }
export interface PlatformsProps {
  bg?: string; labelClass?: string; eyebrow?: string; title?: string; text?: string;
  columns?: string; items?: PlatformItem[]; note?: string;
}

const LABEL_STYLES = [
  { value: 'section-label-purple', label: 'Morado' },
  { value: 'section-label-pink', label: 'Rosa' },
  { value: 'section-label-green', label: 'Verde' },
];

export function PlatformsView(p: PlatformsProps) {
  const t = useTokens();
  const cols = p.columns === '2' ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3';
  return (
    <Section bg={p.bg === 'white' ? 'white' : 'cream'}>
      {(p.eyebrow || p.title || p.text) && (
        <Reveal className="mb-8">
          {p.eyebrow && <span className={`${p.labelClass || 'section-label-green'} inline-flex`}>{t(p.eyebrow)}</span>}
          {p.title && (
            <h2 className="mt-2 font-head text-fluid-3xl font-extrabold tracking-[-0.02em] text-ink">
              {t(p.title)}
            </h2>
          )}
          {p.text && (
            <p className="mt-2 max-w-xl text-[15px] text-muted">
              {t(p.text)}
            </p>
          )}
        </Reveal>
      )}
      <div className={`grid grid-cols-1 gap-5 ${cols}`}>
        {asList<PlatformItem>(p.items).map((it, i) => (
          <Reveal key={i} delay={i * 80}>
            <PlatformCard p={{ name: t(it.name), desc: t(it.text), href: (it.href ?? '').trim(), icon: cmsIcon(it.icon), cta: t(it.cta) }} />
          </Reveal>
        ))}
      </div>

      {p.note && (
        <Reveal delay={120} className="mt-8">
          <div className="flex items-start gap-3 rounded-md bg-white p-5 text-sm text-muted shadow-card">
            <Info size={18} className="mt-0.5 flex-shrink-0 text-purple" aria-hidden="true" />
            <p>
              <NoteText text={t(p.note)} />
            </p>
          </div>
        </Reveal>
      )}
    </Section>
  );
}

export const platformsFields: FieldSpec[] = [
  f.select('bg', 'Fondo', [{ value: 'white', label: 'Blanco' }, { value: 'cream', label: 'Crema' }]),
  f.select('labelClass', 'Color de la etiqueta', LABEL_STYLES),
  f.text('eyebrow', 'Etiqueta superior'),
  f.text('title', 'Título'),
  f.textarea('text', 'Texto'),
  f.select('columns', 'Columnas en computadora', [{ value: '2', label: '2' }, { value: '3', label: '3' }]),
  f.items('items', 'Plataformas', [
    f.text('name', 'Nombre', { required: true }),
    f.textarea('text', 'Descripción'),
    f.icon('icon'),
    f.href('href', 'Enlace', { required: true }),
    f.text('cta', 'Texto del botón', { required: true }),
  ]),
  f.textarea('note', 'Nota final (opcional)', { marks: ['link'] }),
];
