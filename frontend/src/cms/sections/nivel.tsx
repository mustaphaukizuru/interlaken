/**
 * Niveles (/niveles/:nivel): designed sections (docs/CMS-COMPLETION-PLAN.md).
 * The three level pages share these sections; each template passes its
 * level's content as props, built from lib/levels.ts and the school's own text
 * in lib/levelStories.ts (owner, 2026-11-08). The SEP box reads the
 * registrations edited in Ajustes (useSep).
 */
import { Fragment, useId, type ReactNode } from 'react';
import { ArrowRight, BookOpenText, Calculator, CalendarCheck, CheckCircle2, MessageCircle, ShieldCheck, Users } from 'lucide-react';
import { Reveal } from '@/components/ui/Reveal';
import { LEVELS, type LevelData } from '@/lib/levels';
import { LEVEL_STORIES, type StorySection } from '@/lib/levelStories';
import { useSep } from '@/hooks/useSep';
import { cmsColor, useCmsImage, useTokens, type CmsLink } from '../runtime';
import { asLink, asList, CmsAnchor, defineModule, f, grouped, sectionsOf } from './kit';
import type { PageTemplate } from './types';

const section = sectionsOf('nivel');

const ACCENT = {
  green: { label: 'section-label-green', text: 'text-green-dark', ring: 'border-green/30', soft: 'bg-green/5' },
  coral: { label: 'section-label-pink', text: 'text-coral-dark', ring: 'border-coral/30', soft: 'bg-coral/5' },
  purple: { label: 'section-label-purple', text: 'text-purple', ring: 'border-purple/30', soft: 'bg-purple/5' },
} as const;
type AccentKey = keyof typeof ACCENT;
const accentOf = (v: unknown) => ACCENT[(typeof v === 'string' && v in ACCENT ? v : 'green') as AccentKey];

const ACCENT_OPTIONS = [
  { value: 'green', label: 'Verde' },
  { value: 'coral', label: 'Coral' },
  { value: 'purple', label: 'Morado' },
];
const SEP_LEVELS = LEVELS.map((l) => ({ value: l.name, label: l.name }));

const PROGRAM_ICONS = { reading: BookOpenText, speaking: MessageCircle, math: Calculator } as const;
const PROGRAM_ICON_OPTIONS = [
  { value: 'reading', label: 'Libro (lectura y escritura)' },
  { value: 'speaking', label: 'Globo de diálogo (expresión oral)' },
  { value: 'math', label: 'Calculadora (matemáticas)' },
];
const programIcon = (v: unknown) => PROGRAM_ICONS[(typeof v === 'string' && v in PROGRAM_ICONS ? v : 'reading') as keyof typeof PROGRAM_ICONS];

/* ── Portada ────────────────────────────────────────────────────────────── */
interface HeroProps { label?: string; title?: string; headline?: string; text?: string; image?: number | string; accent?: string; color?: string; primary?: CmsLink; secondary?: CmsLink }
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
        className="absolute inset-0 h-full w-full object-cover opacity-35"
        onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
      />
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
              <CalendarCheck size={16} aria-hidden="true" /> {t(secondary.label)}
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
interface StoryItem { title?: string; text?: string; programs?: ProgramItem[]; quote?: string }

function StoryPart({ item, color, first, id }: { item: StoryItem; color: string; first: boolean; id?: string }): ReactNode {
  const t = useTokens();
  const paras = paragraphs(t(item.text));
  const programs = asList<ProgramItem>(item.programs);
  return (
    <section aria-labelledby={id} className="space-y-5">
      {item.title && (
        <header>
          <span aria-hidden="true" className="mb-4 block h-1 w-10 rounded-full" style={{ background: color }} />
          <h2 id={id} className="text-balance font-head text-fluid-2xl font-bold leading-tight text-ink">{t(item.title)}</h2>
        </header>
      )}
      {paras.map((para, j) => (
        <p key={j} className={first && j === 0 ? 'text-lg leading-[1.7] text-ink sm:text-xl' : PARAGRAPH}>
          <Rich text={para} />
        </p>
      ))}
      {programs.length > 0 && (
        <ul className="space-y-3" aria-label="Programas">
          {programs.map((pr, k) => {
            const Icon = programIcon(pr.icon);
            const name = t(pr.name);
            const text = t(pr.text);
            // "**Lee y Produce** impulsa…" reads as a run-in under the card title, so the name is not said twice.
            const lead = `**${name}** `;
            const body = name && text.startsWith(lead) ? text.slice(lead.length) : text;
            return (
              <li key={k} className="flex gap-4 rounded-xl2 border border-line bg-cream-2 p-5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink" style={{ background: `color-mix(in srgb, ${color} 14.9%, transparent)` }}>
                  <Icon size={20} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  {name && <h3 className="font-head text-base font-bold text-ink">{name}</h3>}
                  <p className="mt-1 text-[16px] leading-relaxed text-ink/80"><Rich text={body} /></p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {item.quote && (
        <blockquote className="border-l-4 py-1 pl-5 sm:pl-6" style={{ borderColor: color }}>
          <p className="text-balance font-head text-fluid-xl font-bold leading-snug text-ink">{t(item.quote)}</p>
        </blockquote>
      )}
    </section>
  );
}

function Story({ items, color, photo, photoAlt, photoAfter }: { items: StoryItem[]; color: string; photo?: number | string; photoAlt?: string; photoAfter?: number }) {
  const t = useTokens();
  const uid = useId();
  const img = useCmsImage(photo, t(photoAlt));
  const after = typeof photoAfter === 'number' ? photoAfter - 1 : -1;
  if (items.length === 0) return null;
  return (
    <div className="max-w-[68ch] space-y-14 sm:space-y-16">
      {items.map((item, i) => (
        <Fragment key={i}>
          <Reveal>
            <StoryPart item={item} color={color} first={i === 0} id={item.title ? `${uid}-${i}` : undefined} />
          </Reveal>
          {img.src && after === i && (
            <Reveal>
              <figure className="overflow-hidden rounded-xl2 bg-cream-2">
                <img
                  src={img.src}
                  srcSet={img.srcSet}
                  sizes="(min-width: 1024px) 680px, 100vw"
                  alt={img.alt}
                  width={1600}
                  height={900}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[16/9] w-full object-cover"
                />
              </figure>
            </Reveal>
          )}
        </Fragment>
      ))}
    </div>
  );
}

/* ── Contenido y barra lateral ──────────────────────────────────────────── */
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
  return (
    <section className="bg-white py-12 sm:py-16">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-10">
          <Story items={story} color={color} photo={p.photo} photoAlt={p.photoAlt} photoAfter={p.photoAfter} />

          {(p.groupsTitle || groups.length > 0) && (
            <Reveal>
              <div className={story.length > 0 ? 'max-w-[68ch] border-t border-line pt-12' : 'max-w-[68ch]'}>
                {p.groupsTitle && <h2 className="font-head text-fluid-xl font-bold text-ink">{t(p.groupsTitle)}</h2>}
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {groups.map((g, i) => (
                    <div key={i} className={`rounded-xl2 border ${accent.ring} ${accent.soft} p-5`}>
                      <p className="flex items-center gap-2 font-head font-bold text-ink">
                        <Users size={17} className={accent.text} aria-hidden="true" /> {t(g.name)}
                      </p>
                      {g.detail && <p className="mt-2 text-sm leading-relaxed text-muted">{t(g.detail)}</p>}
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          )}

          {extras.length > 0 && (
            <Reveal>
              <ul className="space-y-2.5">
                {extras.map((e, i) => (
                  <li key={i} className="flex items-start gap-2 text-[15px] leading-snug text-ink/90">
                    <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-green-dark" aria-hidden="true" />
                    {t(e.text)}
                  </li>
                ))}
              </ul>
            </Reveal>
          )}

          {/* Incorporación SEP de este nivel (moved here from the footer, school instruction 2026-08-21) */}
          {sep && (
            <Reveal>
              <div className="rounded-xl2 border border-line bg-cream-2 p-5" style={{ borderLeft: `4px solid ${color}` }}>
                <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[1.2px] text-subtle">
                  <ShieldCheck size={14} aria-hidden="true" /> {t(p.sepTitle)}
                </p>
                <p className="mt-1.5 text-sm font-medium text-ink">{sep.label}</p>
                {p.sepNote && <p className="mt-1 text-xs text-muted">{t(p.sepNote)}</p>}
              </div>
            </Reveal>
          )}
        </div>

        {/* Sidebar de acciones (paralela al menú del sitio anterior) */}
        <aside className="h-fit rounded-xl2 border border-ink/10 bg-cream-2 p-5 lg:sticky lg:top-24">
          {p.sideTitle && (
            <p className="font-head text-sm font-bold uppercase tracking-wide text-subtle">
              {t(p.sideTitle)}
            </p>
          )}
          <ul className="mt-3 divide-y divide-ink/10 text-[15px]">
            {links.map((l, i) => (
              <li key={i}>
                <CmsAnchor
                  link={l}
                  className="flex min-h-[44px] items-center justify-between gap-2 py-2 text-ink hover:text-green-dark"
                >
                  {t(l.label)} <ArrowRight size={14} aria-hidden="true" />
                </CmsAnchor>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}

/* ── Conozca también ────────────────────────────────────────────────────── */
interface OtherItem { name?: string; href?: string }
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
          {asList<OtherItem>(p.items).map((o, i) => (
            <CmsAnchor
              key={i}
              link={{ label: o.name, href: o.href }}
              className="group flex items-center justify-between rounded-xl2 border border-ink/10 bg-white p-5 hover:border-green/40"
            >
              <span className="font-head text-lg font-bold text-ink group-hover:text-green-dark">
                {t(o.name)}
              </span>
              <ArrowRight size={18} className="text-green-dark" aria-hidden="true" />
            </CmsAnchor>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Defaults per level (lib/levels.ts + lib/levelStories.ts) ───────────── */
const levelColor = (l: LevelData) => `var(--nivel-${l.slug})`;

const heroProps = (l: LevelData) => ({
  label: 'Niveles Educativos', title: l.name, headline: l.headline, text: l.intro, image: l.hero, accent: l.accent, color: levelColor(l),
  primary: { label: 'Llenar la ficha de inscripción', href: '/pre-registro' },
  secondary: { label: 'Agendar visita', href: '/agendar-visita' },
});

/** The school's text as editable parts: subtitle, paragraphs (a blank line between them), program cards, closing quote. */
const storyItems = (story: StorySection[]): StoryItem[] => story.map((s) => {
  const item: StoryItem = { title: s.title ?? '', text: '', programs: [], quote: '' };
  const paras: string[] = [];
  for (const b of s.blocks) {
    if ('p' in b) paras.push(b.p);
    else if ('quote' in b) item.quote = b.quote;
    else item.programs = b.programs.map((pr) => ({ name: pr.name, icon: pr.icon, text: pr.text }));
  }
  item.text = paras.join('\n\n');
  return item;
});

const contentProps = (l: LevelData) => {
  const { story, photo } = LEVEL_STORIES[l.slug];
  return {
    accent: l.accent, color: levelColor(l),
    story: storyItems(story),
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
  items: LEVELS.filter((o) => o.slug !== l.slug).map((o) => ({ name: o.name, href: `/niveles/${o.slug}` })),
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
      f.select('accent', 'Color de la etiqueta', ACCENT_OPTIONS),
      f.color('color', 'Color del nivel'),
      f.link('primary', 'Botón principal'),
      f.link('secondary', 'Botón secundario'),
    ],
    defaults: heroProps(LEVELS[0]),
  }),
  section({
    type: 'content', label: 'Nivel · Texto e información útil',
    description: 'El texto del nivel por apartados, una foto, los grupos, notas, incorporación SEP y enlaces laterales. El registro SEP se edita en Ajustes.',
    component: NivelContentView,
    fields: [
      ...grouped('Texto del nivel', [
        f.items('story', 'Texto del nivel (apartados)', [
          f.text('title', 'Subtítulo'),
          f.textarea('text', 'Párrafos', { marks: ['bold'] }),
          f.items('programs', 'Programas (tarjetas)', [
            f.text('name', 'Nombre', { required: true }),
            f.select('icon', 'Ícono', PROGRAM_ICON_OPTIONS),
            f.textarea('text', 'Descripción', { marks: ['bold'] }),
          ]),
          f.textarea('quote', 'Frase destacada al final', { hint: 'Opcional. Se muestra grande, con una línea del color del nivel.' }),
        ]),
      ]),
      ...grouped('Foto dentro del texto', [
        f.image('photo', 'Foto dentro del texto', { minWidth: 1200 }),
        f.text('photoAlt', 'Descripción de la foto', { hint: 'Qué se ve en la foto, para quien no puede verla y para Google.' }),
        f.number('photoAfter', 'Mostrar la foto después del apartado n.º'),
      ]),
      ...grouped('Colores', [
        f.select('accent', 'Color de títulos e íconos', ACCENT_OPTIONS),
        f.color('color', 'Color del nivel (subtítulos, frases y recuadro SEP)'),
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
      ...grouped('Barra lateral', [
        f.text('sideTitle', 'Título de la barra lateral'),
        f.items('links', 'Enlaces de la barra lateral', [f.text('label', 'Texto', { required: true }), f.href('href', 'Enlace', { required: true })]),
      ]),
    ],
    defaults: contentProps(LEVELS[0]),
  }),
  section({
    type: 'others', label: 'Nivel · Conozca también', description: 'Tarjetas que llevan a los otros niveles.',
    component: NivelOthersView,
    fields: [
      f.text('title', 'Título'),
      f.items('items', 'Tarjetas', [f.text('name', 'Nombre', { required: true }), f.href('href', 'Enlace', { required: true })]),
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
