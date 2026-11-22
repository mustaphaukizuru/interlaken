/**
 * Niveles (/niveles/:nivel): designed sections (docs/CMS-COMPLETION-PLAN.md).
 * The three level pages share these sections; each template passes its
 * level's content as props, built from lib/levels.ts and the school's own text
 * in lib/levelStories.ts (owner, 2026-11-08). The SEP box reads the
 * registrations edited in Ajustes (useSep).
 *
 * Media round (owner 2026-11-22): every titled part of the text sits beside
 * a 3D illustration or a photo, alternating sides; the programs are
 * illustrated cards and the side links are a row of cards at the end.
 */
import { Fragment, useId, type ReactNode } from 'react';
import { ArrowRight, CalendarCheck, CheckCircle2, MessageCircle, ShieldCheck, Users } from 'lucide-react';
import { Reveal } from '@/components/ui/Reveal';
import { BackgroundVideo } from '@/components/public/BackgroundVideo';
import { Illustration, IllustrationPanel, wash } from '@/components/ui/Illustration';
import type { IllustrationName } from '@/lib/illustrations';
import { illustrationFor, resolveIllustration } from '@/lib/illustrationTopics';
import { LEVELS, type LevelData } from '@/lib/levels';
import { LEVEL_STORIES, type StorySection } from '@/lib/levelStories';
import { useSep } from '@/hooks/useSep';
import { cmsColor, useCmsImage, useTokens, type CmsLink } from '../runtime';
import { asLink, asList, CmsAnchor, defineModule, f, grouped, INFORMES_CTA, sectionsOf, VISIT_CTA } from './kit';
import type { PageTemplate } from './types';

const section = sectionsOf('nivel');

const ACCENT = {
  green: { label: 'section-label-green', text: 'text-green-dark', soft: 'bg-green/5' },
  coral: { label: 'section-label-pink', text: 'text-coral-dark', soft: 'bg-coral/5' },
  purple: { label: 'section-label-purple', text: 'text-purple', soft: 'bg-purple/5' },
} as const;
type AccentKey = keyof typeof ACCENT;
const accentOf = (v: unknown) => ACCENT[(typeof v === 'string' && v in ACCENT ? v : 'green') as AccentKey];

const ACCENT_OPTIONS = [
  { value: 'green', label: 'Verde' },
  { value: 'coral', label: 'Coral' },
  { value: 'purple', label: 'Morado' },
];
const SEP_LEVELS = LEVELS.map((l) => ({ value: l.name, label: l.name }));

/** Each program's illustration (the editor still picks it as «Ícono»). */
const PROGRAM_ART: Record<string, IllustrationName> = { reading: 'lectura', speaking: 'oral', math: 'matematicas' };
const PROGRAM_ICON_OPTIONS = [
  { value: 'reading', label: 'Libro (lectura y escritura)' },
  { value: 'speaking', label: 'Micrófono (expresión oral)' },
  { value: 'math', label: 'Bloques y ábaco (matemáticas)' },
];
const programArt = (v: unknown): IllustrationName => PROGRAM_ART[typeof v === 'string' && v in PROGRAM_ART ? v : 'reading'];

/* ── Portada ────────────────────────────────────────────────────────────── */
interface HeroProps { label?: string; title?: string; headline?: string; text?: string; image?: number | string; video?: string; accent?: string; color?: string; primary?: CmsLink; secondary?: CmsLink }
function NivelHeroView(p: HeroProps) {
  const t = useTokens();
  const accent = accentOf(p.accent);
  const image = useCmsImage(p.image, '', { full: true });
  const primary = asLink(p.primary);
  const secondary = asLink(p.secondary);
  return (
    <section className="relative overflow-hidden bg-dark text-white">
      <img
        src={image.src}
        srcSet={image.srcSet}
        sizes="100vw"
        alt=""
        width={1600}
        height={900}
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
        onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
      />
      {/* A silent loop of the same photo (media round 2026-11-22); the photo stays as poster and fallback. */}
      {p.video?.trim() && <BackgroundVideo src={p.video.trim()} poster={image.src} />}
      {/* One veil over photo and video alike (they used to be dimmed separately, which stacked to a washed-out look):
          dark where the text sits, lighter to the right; an even veil on phones, where the text spans the width. */}
      <div aria-hidden="true" className="absolute inset-0 bg-dark/70 sm:bg-transparent sm:bg-gradient-to-r sm:from-dark/90 sm:via-dark/70 sm:to-dark/30" />
      <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        {p.label && <span className={`${accent.label} inline-flex`} style={{ borderLeft: `4px solid ${cmsColor(p.color)}`, paddingLeft: 10 }}>{t(p.label)}</span>}
        <h1 className="mt-3 font-head text-fluid-3xl font-black leading-tight tracking-[-0.02em]">
          {t(p.title)}
        </h1>
        {p.headline && (
          <p className="mt-3 max-w-2xl text-balance font-head text-fluid-2xl font-bold leading-snug text-white">
            {t(p.headline)}
          </p>
        )}
        {p.text && (
          <p className="mt-4 max-w-2xl text-[16.5px] leading-relaxed text-white/85">
            {t(p.text)}
          </p>
        )}
        {(primary.href || secondary.href) && (
          <div className="mt-7 flex flex-wrap gap-3">
            <CmsAnchor link={primary} className="btn-pink">
              {t(primary.label)} <ArrowRight size={16} aria-hidden="true" />
            </CmsAnchor>
            <CmsAnchor link={secondary} className="btn-ghost">
              {/wa\.me\//.test(secondary.href ?? '')
                ? <MessageCircle size={16} aria-hidden="true" />
                : <CalendarCheck size={16} aria-hidden="true" />} {t(secondary.label)}
            </CmsAnchor>
          </div>
        )}
      </div>
    </section>
  );
}

/* ── El texto del nivel (LevelStory, owner 2026-11-08) ──────────────────── */

/** **Negritas** as <strong>; everything else as written. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return <>{parts.map((part, i) => (i % 2 ? <strong key={i} className="font-semibold text-ink">{part}</strong> : <Fragment key={i}>{part}</Fragment>))}</>;
}

/** A section's text: paragraphs separated by a blank line. */
const paragraphs = (text: string): string[] => text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);

const PARAGRAPH = 'text-[17px] leading-[1.75] text-ink/80';

interface ProgramItem { name?: string; icon?: string; text?: string }
interface StoryItem { title?: string; text?: string; programs?: ProgramItem[]; quote?: string; illustration?: string; photo?: number | string; photoAlt?: string }

const ArtPanel = ({ name, color }: { name: IllustrationName; color: string }) => <IllustrationPanel name={name} tint={color} />;

/** A photo in place of the illustration (school photography first; licensed stock with no faces). */
function PhotoPanel({ photo, alt }: { photo: number | string; alt: string }) {
  const img = useCmsImage(photo, alt);
  if (!img.src) return null;
  return (
    <figure className="overflow-hidden rounded-md bg-cream-2 shadow-card">
      <img
        src={img.src}
        srcSet={img.srcSet}
        sizes="(min-width: 1024px) 460px, 100vw"
        alt={img.alt}
        width={1200}
        height={960}
        loading="lazy"
        decoding="async"
        className="aspect-[5/4] w-full object-cover"
      />
    </figure>
  );
}

function ProgramCards({ programs, color }: { programs: ProgramItem[]; color: string }) {
  const t = useTokens();
  return (
    <ul className="grid gap-5 sm:grid-cols-3" aria-label="Programas">
      {programs.map((pr, k) => {
        const name = t(pr.name);
        const text = t(pr.text);
        // "**Lee y Produce** impulsa…" reads as a run-in under the card title, so the name is not said twice.
        const lead = `**${name}** `;
        const body = name && text.startsWith(lead) ? text.slice(lead.length) : text;
        return (
          <li key={k} className="flex flex-col overflow-hidden rounded-md bg-white shadow-card">
            <div className="flex items-center justify-center py-6" style={{ background: wash(color, 12) }}>
              <Illustration name={programArt(pr.icon)} size={136} />
            </div>
            <div className="flex-1 p-5">
              {name && <h3 className="font-head text-lg font-bold text-ink">{name}</h3>}
              <p className="mt-1.5 text-[16px] leading-relaxed text-ink/80"><Rich text={body} /></p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Quote({ text, color }: { text: string; color: string }) {
  return (
    <blockquote className="rounded-md px-6 py-5 sm:px-8 sm:py-6" style={{ background: wash(color, 12) }}>
      <span aria-hidden="true" className="mb-3 block h-1 w-8 rounded-full" style={{ background: color }} />
      <p className="text-balance font-head text-fluid-xl font-bold leading-snug text-ink">{text}</p>
    </blockquote>
  );
}

/**
 * One part of the text. Untitled opening: a wide lead. Programs: the text then
 * a row of illustrated cards. Otherwise: text beside its illustration or photo,
 * on alternating sides from lg up (media first on phones, smaller).
 */
function StoryPart({ item, color, index, flip, id }: { item: StoryItem; color: string; index: number; flip: boolean; id?: string }): ReactNode {
  const t = useTokens();
  const title = t(item.title);
  const paras = paragraphs(t(item.text));
  const programs = asList<ProgramItem>(item.programs);
  const quote = t(item.quote);
  const art = resolveIllustration(item.illustration, title);
  const hasPhoto = item.photo !== undefined && item.photo !== '' && item.photo !== 0;

  const heading = title && (
    <header>
      <span aria-hidden="true" className="mb-4 block h-1 w-10 rounded-full" style={{ background: color }} />
      <h2 id={id} className="text-balance font-head text-fluid-2xl font-bold leading-tight text-ink">{title}</h2>
    </header>
  );
  const body = paras.map((para, j) => (
    <p key={j} className={index === 0 && j === 0 ? 'text-lg leading-[1.7] text-ink sm:text-xl' : PARAGRAPH}>
      <Rich text={para} />
    </p>
  ));

  // The opening runs straight from the hero: a wide lead, no media.
  if (!title) {
    return (
      <section className="max-w-[72ch] space-y-5">
        {body}
        {quote && <Quote text={quote} color={color} />}
      </section>
    );
  }

  if (programs.length > 0) {
    return (
      <section aria-labelledby={id} className="space-y-8">
        <div className="grid items-center gap-8 lg:grid-cols-12 lg:gap-12">
          <div className="space-y-5 lg:col-span-7">{heading}{body}</div>
          {art && <div className="hidden lg:col-span-5 lg:block"><ArtPanel name={art} color={color} /></div>}
        </div>
        <ProgramCards programs={programs} color={color} />
        {quote && <Quote text={quote} color={color} />}
      </section>
    );
  }

  const media = hasPhoto
    ? <PhotoPanel photo={item.photo!} alt={t(item.photoAlt)} />
    : art ? <ArtPanel name={art} color={color} /> : null;

  return (
    <section aria-labelledby={id} className="grid items-center gap-8 lg:grid-cols-12 lg:gap-14">
      {media && (
        <div className={`max-w-[360px] lg:col-span-5 lg:max-w-none ${flip ? 'lg:order-1' : 'lg:order-2'}`}>{media}</div>
      )}
      <div className={`space-y-5 ${media ? 'lg:col-span-7' : 'lg:col-span-12 lg:max-w-[72ch]'} ${flip ? 'lg:order-2' : 'lg:order-1'}`}>
        {heading}
        {body}
        {quote && <Quote text={quote} color={color} />}
      </div>
    </section>
  );
}

function Story({ items, color, photo, photoAlt, photoAfter }: { items: StoryItem[]; color: string; photo?: number | string; photoAlt?: string; photoAfter?: number }) {
  const t = useTokens();
  const uid = useId();
  const img = useCmsImage(photo, t(photoAlt));
  const after = typeof photoAfter === 'number' ? photoAfter - 1 : -1;
  if (items.length === 0) return null;
  let side = 0;
  return (
    <div className="space-y-16 sm:space-y-24">
      {items.map((item, i) => {
        // Only text-beside-media parts alternate, so the zig-zag stays regular.
        const zig = !!item.title && asList(item.programs).length === 0;
        const flip = zig ? side++ % 2 === 1 : false;
        return (
          <Fragment key={i}>
            <Reveal>
              <StoryPart item={item} color={color} index={i} flip={flip} id={item.title ? `${uid}-${i}` : undefined} />
            </Reveal>
            {img.src && after === i && (
              <Reveal>
                <figure className="overflow-hidden rounded-md bg-cream-2">
                  <img
                    src={img.src}
                    srcSet={img.srcSet}
                    sizes="(min-width: 1152px) 1104px, 100vw"
                    alt={img.alt}
                    width={1600}
                    height={685}
                    loading="lazy"
                    decoding="async"
                    className="aspect-[16/9] w-full object-cover sm:aspect-[21/9]"
                  />
                </figure>
              </Reveal>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

/* ── Contenido e información útil ───────────────────────────────────────── */
interface TextItem { text?: string }
interface GroupItem { name?: string; detail?: string }
interface LinkItem { label?: string; href?: string }
interface ContentProps {
  accent?: string; color?: string;
  story?: StoryItem[]; photo?: number | string; photoAlt?: string; photoAfter?: number;
  groupsTitle?: string; groups?: GroupItem[];
  extras?: TextItem[];
  sepLevel?: string; sepTitle?: string; sepNote?: string;
  sideTitle?: string; links?: LinkItem[];
}
function NivelContentView(p: ContentProps) {
  const t = useTokens();
  const sepRows = useSep();
  const accent = accentOf(p.accent);
  const color = cmsColor(p.color);
  const story = asList<StoryItem>(p.story);
  const groups = asList<GroupItem>(p.groups);
  const extras = asList<TextItem>(p.extras);
  const links = asList<LinkItem>(p.links);
  const sep = sepRows.find((r) => r.level === p.sepLevel);
  const hasFacts = !!p.groupsTitle || groups.length > 0 || extras.length > 0 || !!sep;
  return (
    <section className="bg-white py-14 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Story items={story} color={color} photo={p.photo} photoAlt={p.photoAlt} photoAfter={p.photoAfter} />

        {/* El nivel en datos: grupos, notas e incorporación SEP */}
        {hasFacts && (
          <Reveal>
            <div className={`${story.length > 0 ? 'mt-20 sm:mt-24' : ''} rounded-md p-6 sm:p-10`} style={{ background: wash(color, 9) }}>
              <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
                <div className="lg:col-span-7">
                  {p.groupsTitle && <h2 className="font-head text-fluid-xl font-bold text-ink">{t(p.groupsTitle)}</h2>}
                  {groups.length > 0 && (
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      {groups.map((g, i) => (
                        <div key={i} className="rounded-md bg-white p-5 shadow-card">
                          <p className="flex items-center gap-2 font-head font-bold text-ink">
                            <Users size={17} className={accent.text} aria-hidden="true" /> {t(g.name)}
                          </p>
                          {g.detail && <p className="mt-2 text-sm leading-relaxed text-muted">{t(g.detail)}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                  {extras.length > 0 && (
                    <ul className="mt-6 space-y-2.5">
                      {extras.map((e, i) => (
                        <li key={i} className="flex items-start gap-2 text-[15px] leading-snug text-ink/90">
                          <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-green-dark" aria-hidden="true" />
                          {t(e.text)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {/* Incorporación SEP de este nivel (moved here from the footer, school instruction 2026-08-21) */}
                {sep && (
                  <div className="flex flex-col justify-between gap-6 rounded-md bg-white p-6 shadow-card lg:col-span-5">
                    <div>
                      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[1.2px] text-subtle">
                        <ShieldCheck size={14} aria-hidden="true" /> {t(p.sepTitle)}
                      </p>
                      <p className="mt-2 font-head text-base font-bold text-ink">{sep.label}</p>
                      {p.sepNote && <p className="mt-1 text-sm text-muted">{t(p.sepNote)}</p>}
                    </div>
                    <Illustration name="academico" size={112} className="self-end" />
                  </div>
                )}
              </div>
            </div>
          </Reveal>
        )}

        {/* Información útil (antes barra lateral): una fila de tarjetas */}
        {links.length > 0 && (
          <nav aria-label={t(p.sideTitle) || 'Información útil'} className="mt-14">
            {p.sideTitle && (
              <p className="font-head text-sm font-bold uppercase tracking-wide text-subtle">{t(p.sideTitle)}</p>
            )}
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {links.map((l, i) => (
                <li key={i}>
                  <CmsAnchor
                    link={l}
                    className="group flex min-h-[56px] items-center justify-between gap-2 rounded-md bg-cream-2 px-4 py-3 text-[15px] font-medium text-ink transition-colors hover:bg-white hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green/40"
                  >
                    {t(l.label)} <ArrowRight size={15} className="shrink-0 text-subtle transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </CmsAnchor>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </section>
  );
}

/* ── Conozca también ────────────────────────────────────────────────────── */
interface OtherItem { name?: string; href?: string; image?: number | string; text?: string }

/** The level a card links to (its /niveles/<slug> link, else its name): photo, colour and line for content saved before those fields. */
const levelOf = (o: OtherItem) => LEVELS.find((l) => o.href?.replace(/\/$/, '').endsWith(`/niveles/${l.slug}`) || l.name === o.name);

const hasRef = (v: unknown) => v !== undefined && v !== null && v !== '' && v !== 0;

function OtherCard({ item }: { item: OtherItem }) {
  const t = useTokens();
  const level = levelOf(item);
  // Decorative: the card's name says where it goes.
  const img = useCmsImage(hasRef(item.image) ? item.image : level?.hero, '');
  const color = level ? levelColor(level) : 'var(--purple)';
  const line = t(item.text) || level?.headline || '';
  return (
    <CmsAnchor
      link={{ label: item.name, href: item.href }}
      className="group flex items-center gap-4 rounded-md bg-white p-3 pr-5 shadow-card transition-shadow hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green/40 sm:gap-5"
    >
      {img.src && (
        <span className="relative h-[72px] w-24 shrink-0 overflow-hidden rounded-sm bg-cream-2 sm:h-20 sm:w-28">
          <img
            src={img.src}
            srcSet={img.srcSet}
            sizes="112px"
            alt=""
            width={224}
            height={160}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
          <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1" style={{ background: color }} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block font-head text-lg font-bold text-ink group-hover:text-green-dark">{t(item.name)}</span>
        {line && <span className="mt-0.5 block text-[15px] leading-snug text-muted">{line}</span>}
      </span>
      <ArrowRight size={20} className="shrink-0 text-green-dark transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
    </CmsAnchor>
  );
}

function NivelOthersView(p: { title?: string; items?: OtherItem[] }) {
  const t = useTokens();
  return (
    <section className="bg-cream-2 py-10">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {p.title && (
          <p className="font-head text-sm font-bold uppercase tracking-wide text-subtle">
            {t(p.title)}
          </p>
        )}
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {asList<OtherItem>(p.items).map((o, i) => <OtherCard key={i} item={o} />)}
        </div>
      </div>
    </section>
  );
}

/* ── Defaults per level (lib/levels.ts + lib/levelStories.ts) ───────────── */
const levelColor = (l: LevelData) => `var(--nivel-${l.slug})`;

/**
 * Hero loops (media round 2026-11-22): each level's own photo animated with a
 * slow camera move (Freepik Kling 2.5, no people added), played forward then
 * backward as a 10 s loop. The poster is the clip's first frame, so the photo
 * and the video line up exactly.
 */
const HERO_MEDIA: Record<LevelData['slug'], { poster: string; video: string }> = {
  preescolar: { poster: '/assets/hero-preescolar.webp', video: '/assets/video/hero-preescolar.mp4' },
  primaria: { poster: '/assets/hero-primaria.webp', video: '/assets/video/hero-primaria.mp4' },
  secundaria: { poster: '/assets/hero-secundaria.webp', video: '/assets/video/hero-secundaria.mp4' },
};

const heroProps = (l: LevelData) => ({
  label: 'Niveles Educativos', title: l.name, headline: l.headline, text: l.intro, image: HERO_MEDIA[l.slug].poster, video: HERO_MEDIA[l.slug].video, accent: l.accent, color: levelColor(l),
  primary: VISIT_CTA,
  secondary: INFORMES_CTA,
});

/**
 * Photos beside some parts, so photo and illustration alternate down the page
 * (media round 2026-11-22). Licensed Freepik stock with no recognisable faces
 * (D16): hands, materials and places, never presented as Interlaken students.
 */
const STORY_PHOTOS: Record<LevelData['slug'], Record<string, { src: string; alt: string }>> = {
  preescolar: {
    'Menos memorizar. Más experimentar.': { src: '/assets/foto-experimentar.webp', alt: 'Manos de un niño encajando figuras de madera de colores' },
    'Saber convivir también se aprende': { src: '/assets/foto-convivir.webp', alt: 'Manos de varios niños unidas al centro' },
    'Niños felices que descubren todo lo que pueden lograr': { src: '/assets/foto-manualidades.webp', alt: 'Manos de un niño moldeando plastilina con cortadores de colores' },
  },
  primaria: {
    'Menos memorizar. Más comprender, pensar y hacer.': { src: '/assets/foto-matematicas.webp', alt: 'Manos de un niño contando con un ábaco de colores' },
    'Aprender también es prepararse para la vida': { src: '/assets/foto-finanzas.webp', alt: 'Niño echando una moneda en una alcancía junto a pilas de monedas' },
    'Hay aprendizajes que necesitan salir del salón': { src: '/assets/foto-campamento.webp', alt: 'Casas de campaña entre pinos junto a un lago' },
  },
  secundaria: {
    'Aprender haciendo, preguntando y descubriendo': { src: '/assets/foto-ciencia.webp', alt: 'Tubos de ensayo con líquido azul en el laboratorio' },
    'Tecnología sí. Habilidades fundamentales, también.': { src: '/assets/foto-tecnologia.webp', alt: 'Alumna escribiendo en su cuaderno junto a una tableta' },
    'El arte también forma': { src: '/assets/foto-arte.webp', alt: 'Manos de alumnos pintando con acuarelas' },
  },
};

/** The school's text as editable parts: subtitle, paragraphs (a blank line between them), program cards, closing quote, illustration or photo. */
const storyItems = (story: StorySection[], photos: Record<string, { src: string; alt: string }> = {}): StoryItem[] => story.map((s) => {
  const item: StoryItem = { title: s.title ?? '', text: '', programs: [], quote: '' };
  const paras: string[] = [];
  for (const b of s.blocks) {
    if ('p' in b) paras.push(b.p);
    else if ('quote' in b) item.quote = b.quote;
    else item.programs = b.programs.map((pr) => ({ name: pr.name, icon: pr.icon, text: pr.text }));
  }
  item.text = paras.join('\n\n');
  const art = illustrationFor(s.title);
  if (art) item.illustration = art;
  const photo = s.title ? photos[s.title] : undefined;
  if (photo) { item.photo = photo.src; item.photoAlt = photo.alt; }
  return item;
});

const contentProps = (l: LevelData) => {
  const { story, photo } = LEVEL_STORIES[l.slug];
  return {
    accent: l.accent, color: levelColor(l),
    story: storyItems(story, STORY_PHOTOS[l.slug]),
    photo: photo.src, photoAlt: photo.alt, photoAfter: photo.after + 1,
    groupsTitle: l.groupsTitle, groups: l.groups.map((g) => ({ name: g.name, detail: g.detail })),
    extras: l.extras.map((text) => ({ text })),
    sepLevel: l.name, sepTitle: 'Incorporación oficial SEP', sepNote: 'Estudios con reconocimiento de validez oficial.',
    sideTitle: 'Información útil',
    links: [
      { label: 'Proceso de inscripción', href: '/admisiones' },
      { label: 'Documentación', href: '/admisiones/documentacion' },
      { label: 'Costos y colegiaturas', href: '/admisiones/costos' },
      { label: 'Agendar visita', href: '/agendar-visita' },
      { label: 'Contacto por nivel', href: '/contacto' },
    ],
  };
};

const othersProps = (l: LevelData) => ({
  title: 'Conozca también',
  items: LEVELS.filter((o) => o.slug !== l.slug).map((o) => ({ name: o.name, href: `/niveles/${o.slug}`, image: o.hero, text: o.headline })),
});

const textItem = [f.text('text', 'Texto', { required: true })];

export const sections = [
  section({
    type: 'hero', label: 'Nivel · Portada', description: 'Foto del nivel con velo oscuro, nombre, frase, presentación y dos botones.',
    component: NivelHeroView,
    fields: [
      f.text('label', 'Etiqueta superior'),
      f.text('title', 'Título', { required: true }),
      f.text('headline', 'Frase principal', { hint: 'La línea grande bajo el nombre del nivel.' }),
      f.textarea('text', 'Presentación'),
      f.image('image', 'Foto'),
      f.url('video', 'Video de portada (MP4)', { hint: 'Opcional. Video corto, sin sonido, en bucle sobre la foto. Vacío = solo la foto.' }),
      f.select('accent', 'Color de la etiqueta', ACCENT_OPTIONS),
      f.color('color', 'Color del nivel'),
      f.link('primary', 'Botón principal'),
      f.link('secondary', 'Botón secundario'),
    ],
    defaults: heroProps(LEVELS[0]),
  }),
  section({
    type: 'content', label: 'Nivel · Texto e información útil',
    description: 'El texto del nivel por apartados, cada uno con su ilustración o foto, los grupos, notas, incorporación SEP y enlaces útiles. El registro SEP se edita en Ajustes.',
    component: NivelContentView,
    fields: [
      ...grouped('Texto del nivel', [
        f.items('story', 'Texto del nivel (apartados)', [
          f.text('title', 'Subtítulo'),
          f.textarea('text', 'Párrafos', { marks: ['bold'] }),
          f.illustration('illustration', 'Ilustración', { hint: 'Se muestra junto al texto. Sin elegir, se toma la que corresponde al subtítulo.' }),
          f.image('photo', 'Foto en lugar de la ilustración', { hint: 'Opcional. Fotos del colegio o con permiso; sin rostros de alumnos sin consentimiento.' }),
          f.text('photoAlt', 'Descripción de la foto', { hint: 'Qué se ve en la foto, para quien no puede verla y para Google.' }),
          f.items('programs', 'Programas (tarjetas)', [
            f.text('name', 'Nombre', { required: true }),
            f.select('icon', 'Ilustración', PROGRAM_ICON_OPTIONS),
            f.textarea('text', 'Descripción', { marks: ['bold'] }),
          ]),
          f.textarea('quote', 'Frase destacada al final', { hint: 'Opcional. Se muestra grande, sobre el color del nivel.' }),
        ]),
      ]),
      ...grouped('Foto ancha dentro del texto', [
        f.image('photo', 'Foto ancha dentro del texto', { minWidth: 1200 }),
        f.text('photoAlt', 'Descripción de la foto', { hint: 'Qué se ve en la foto, para quien no puede verla y para Google.' }),
        f.number('photoAfter', 'Mostrar la foto después del apartado n.º'),
      ]),
      ...grouped('Colores', [
        f.select('accent', 'Color de títulos e íconos', ACCENT_OPTIONS),
        f.color('color', 'Color del nivel (subtítulos, frases, fondos y recuadro SEP)'),
      ]),
      ...grouped('Grupos y notas', [
        f.text('groupsTitle', 'Título de los grupos'),
        f.items('groups', 'Grupos', [f.text('name', 'Nombre', { required: true }), f.textarea('detail', 'Detalle')]),
        f.items('extras', 'Notas finales', textItem),
      ]),
      ...grouped('Incorporación SEP', [
        f.select('sepLevel', 'Nivel SEP a mostrar', SEP_LEVELS, { hint: 'El número de registro se toma de Ajustes, Incorporación SEP.' }),
        f.text('sepTitle', 'Título del recuadro SEP'),
        f.text('sepNote', 'Nota del recuadro SEP'),
      ]),
      ...grouped('Información útil', [
        f.text('sideTitle', 'Título de los enlaces útiles'),
        f.items('links', 'Enlaces útiles', [f.text('label', 'Texto', { required: true }), f.href('href', 'Enlace', { required: true })]),
      ]),
    ],
    defaults: contentProps(LEVELS[0]),
  }),
  section({
    type: 'others', label: 'Nivel · Conozca también', description: 'Tarjetas con foto que llevan a los otros niveles.',
    component: NivelOthersView,
    fields: [
      f.text('title', 'Título'),
      f.items('items', 'Tarjetas', [
        f.text('name', 'Nombre', { required: true }),
        f.href('href', 'Enlace', { required: true }),
        f.image('image', 'Foto pequeña', { hint: 'Sin elegir, la foto de la portada de ese nivel.' }),
        f.text('text', 'Frase', { hint: 'Una línea bajo el nombre. Sin escribir, la frase principal de ese nivel.' }),
      ]),
    ],
    defaults: othersProps(LEVELS[0]),
  }),
];

export const templates: PageTemplate[] = LEVELS.map((l) => ({
  slug: l.slug, path: `/niveles/${l.slug}`, title: l.name, group: 'nivel',
  seo: {}, // title and description: lib/routeMeta.ts ROUTE_META
  sections: [
    { type: 'nivel.hero', props: heroProps(l) },
    { type: 'nivel.content', props: contentProps(l) },
    { type: 'nivel.others', props: othersProps(l) },
  ],
}));

export default defineModule(sections, templates);
