/**
 * Views shared by the Pagos and Plataformas sections (both pages are built
 * from the same hero, platform-card grid and info note). Each module
 * registers its own section types with its own defaults.
 *
 * Media round (owner 2026-11-22): each platform card opens on its 3D
 * illustration (or a photo) over a wash of the section colour; a lone card
 * and the two-column grid lie wide, media beside the text.
 */
import { createElement, Fragment } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Coffee, CreditCard, GraduationCap, HeartHandshake, Info, Mail, Tablet } from 'lucide-react';
import { Section } from '@/components/ui/Section';
import { Reveal } from '@/components/ui/Reveal';
import { Illustration, wash } from '@/components/ui/Illustration';
import { isIllustration, type IllustrationName } from '@/lib/illustrations';
import { illustrationFor } from '@/lib/illustrationTopics';
import { iconResolver } from '../iconRuntime';
import { imageSrc, imageSrcSet, useCmsImage, useTokens } from '../runtime';
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
      <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16 lg:py-[72px]">
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
export interface PlatformItem {
  name?: string; text?: string; icon?: string; href?: string; cta?: string;
  illustration?: string; photo?: number | string; photoAlt?: string;
}
export interface PlatformsProps {
  bg?: string; labelClass?: string; eyebrow?: string; title?: string; text?: string;
  columns?: string; items?: PlatformItem[]; note?: string;
}

const LABEL_STYLES = [
  { value: 'section-label-purple', label: 'Morado' },
  { value: 'section-label-pink', label: 'Rosa' },
  { value: 'section-label-green', label: 'Verde' },
];

/** The colour behind the illustrations: the colour of the section's label. */
const ACCENT: Record<string, string> = {
  'section-label-purple': 'var(--purple)',
  'section-label-pink': 'var(--pink)',
  'section-label-green': 'var(--green)',
};

/** Content saved before the «Ilustración» field: the art that matches the card's icon, else its name. */
const ICON_ART: Record<string, IllustrationName> = {
  CreditCard: 'pagos', Coffee: 'cafeteria', GraduationCap: 'tareas', Mail: 'mensaje', Tablet: 'tecnologia', HeartHandshake: 'comunidad',
};
function platformArt(it: PlatformItem, name: string): IllustrationName | undefined {
  if (it.illustration === 'none') return undefined;
  if (isIllustration(it.illustration)) return it.illustration;
  return ICON_ART[it.icon ?? ''] ?? illustrationFor(name);
}

const hasPhoto = (v: unknown) => v !== undefined && v !== null && v !== '' && v !== 0;

/** Card shapes: stacked; wide (media beside the text) from sm for a lone card, from lg in the two-column grid. */
const SHAPE = {
  stack: { card: '', media: '', photo: 'aspect-[16/10]', body: '', art: 136, artW: 'w-[112px] sm:w-[136px]' },
  sm: { card: 'sm:flex-row', media: 'sm:w-[42%] sm:shrink-0', photo: 'aspect-[16/10] sm:aspect-auto', body: 'sm:p-8 sm:justify-center', art: 176, artW: 'w-[120px] sm:w-[176px]' },
  lg: { card: 'lg:flex-row', media: 'lg:w-[42%] lg:shrink-0', photo: 'aspect-[16/10] lg:aspect-auto', body: 'lg:p-7 lg:justify-center', art: 160, artW: 'w-[120px] sm:w-[136px] lg:w-[160px]' },
} as const;
type Shape = keyof typeof SHAPE;

const CTA =
  'mt-5 inline-flex min-h-[44px] items-center gap-1.5 self-start rounded-sm border-2 border-green px-5 text-sm font-semibold text-green-dark transition-colors hover:bg-green-strong hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green/40';

function PlatformTile({ it, accent, shape }: { it: PlatformItem; accent: string; shape: Shape }) {
  const t = useTokens();
  const name = t(it.name);
  const href = (it.href ?? '').trim();
  const art = platformArt(it, name);
  const photo = useCmsImage(hasPhoto(it.photo) ? it.photo : '', t(it.photoAlt));
  const s = SHAPE[shape];
  return (
    <article className={`group flex h-full flex-col overflow-hidden rounded-md bg-white shadow-card transition-shadow duration-300 hover:shadow-raised ${s.card}`}>
      {photo.src ? (
        <div className={`relative overflow-hidden bg-cream-2 ${s.photo} ${s.media}`}>
          <img
            src={photo.src}
            srcSet={photo.srcSet}
            sizes="(min-width: 1024px) 480px, 100vw"
            alt={photo.alt}
            width={960}
            height={720}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        </div>
      ) : (
        <div
          aria-hidden="true"
          className={`relative flex items-center justify-center overflow-hidden py-5 sm:py-7 ${s.media}`}
          style={{ background: `radial-gradient(120% 100% at 50% 35%, ${wash(accent, 20)} 0%, ${wash(accent, 7)} 72%)` }}
        >
          <span className="absolute -right-10 -top-12 h-36 w-36 rounded-full" style={{ background: wash(accent, 26), opacity: 0.45 }} />
          <span className="absolute -bottom-12 -left-8 h-28 w-28 rounded-full" style={{ background: wash(accent, 26), opacity: 0.35 }} />
          {art ? (
            <Illustration
              name={art}
              size={s.art}
              fluid
              className={`relative ${s.artW} transition-transform duration-300 group-hover:-translate-y-1 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0`}
            />
          ) : (
            <span className="relative flex h-16 w-16 items-center justify-center rounded-md bg-white text-green-dark shadow-card">
              {createElement(cmsIcon(it.icon), { className: 'h-7 w-7', 'aria-hidden': true })}
            </span>
          )}
        </div>
      )}
      <div className={`flex flex-1 flex-col p-6 ${s.body}`}>
        <h3 className="font-head text-lg font-bold text-ink sm:text-xl">{name}</h3>
        <p className={`mt-2 text-base leading-relaxed text-muted ${shape === 'stack' ? 'flex-1' : ''}`}>{t(it.text)}</p>
        {href && (href.startsWith('/') ? (
          <Link to={href} className={CTA}>
            {t(it.cta)} <ArrowRight size={15} aria-hidden="true" />
          </Link>
        ) : (
          <a href={href} target="_blank" rel="noopener noreferrer" className={CTA}>
            {t(it.cta)} <ArrowUpRight size={15} aria-hidden="true" />
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        ))}
      </div>
    </article>
  );
}

export function PlatformsView(p: PlatformsProps) {
  const t = useTokens();
  const items = asList<PlatformItem>(p.items);
  const accent = ACCENT[p.labelClass || 'section-label-green'] ?? 'var(--green)';
  const solo = items.length === 1;
  const cols = solo ? '' : p.columns === '2' ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3';
  const shape: Shape = solo ? 'sm' : p.columns === '2' ? 'lg' : 'stack';
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
            <p className="mt-2 max-w-xl text-base text-muted">
              {t(p.text)}
            </p>
          )}
        </Reveal>
      )}
      <div className={`grid grid-cols-1 gap-5 lg:gap-6 ${cols}`}>
        {items.map((it, i) => (
          <Reveal key={i} delay={i * 80} className="h-full">
            <PlatformTile it={it} accent={accent} shape={shape} />
          </Reveal>
        ))}
      </div>

      {p.note && (
        <Reveal delay={120} className="mt-8">
          <div className="flex items-start gap-3 rounded-md bg-white p-5 text-base leading-relaxed text-muted shadow-card">
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-sm bg-purple/[0.07] text-purple">
              <Info size={17} aria-hidden="true" />
            </span>
            <p className="pt-0.5">
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
    f.illustration('illustration', 'Ilustración', { hint: 'Arriba de la tarjeta, sobre el color de la etiqueta. Sin elegir, la que corresponde al ícono.' }),
    f.image('photo', 'Foto en lugar de la ilustración', { hint: 'Opcional. Fotos del colegio o con permiso; sin rostros de alumnos sin consentimiento.' }),
    f.text('photoAlt', 'Descripción de la foto', { hint: 'Qué se ve en la foto, para quien no puede verla y para Google.' }),
  ]),
  f.textarea('note', 'Nota final (opcional)', { marks: ['link'] }),
];
