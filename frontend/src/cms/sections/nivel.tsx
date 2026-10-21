/**
 * Niveles (/niveles/:nivel): designed sections (docs/CMS-COMPLETION-PLAN.md).
 * The three level pages share these sections; each template passes its
 * level's content as props, built from lib/levels.ts (the original copy).
 * The SEP box reads the registrations edited in Ajustes (useSep).
 */
import { ArrowRight, CalendarCheck, CheckCircle2, ShieldCheck, Users } from 'lucide-react';
import { Reveal } from '@/components/ui/Reveal';
import { LEVELS, type LevelData } from '@/lib/levels';
import { useSep } from '@/hooks/useSep';
import { cmsColor, useCmsImage, useTokens, type CmsLink } from '../runtime';
import { asLink, asList, CmsAnchor, defineModule, f, sectionsOf } from './kit';
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

/* ── Portada ────────────────────────────────────────────────────────────── */
interface HeroProps { label?: string; title?: string; text?: string; image?: number | string; accent?: string; color?: string; primary?: CmsLink; secondary?: CmsLink }
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
        {p.text && (
          <p className="mt-4 max-w-2xl text-[15.5px] leading-relaxed text-white/80">
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

/* ── Contenido y barra lateral ──────────────────────────────────────────── */
interface TextItem { text?: string }
interface GroupItem { name?: string; detail?: string }
interface LinkItem { label?: string; href?: string }
interface ContentProps {
  accent?: string; color?: string;
  modelTitle?: string; model?: TextItem[];
  groupsTitle?: string; groups?: GroupItem[];
  extras?: TextItem[];
  sepLevel?: string; sepTitle?: string; sepNote?: string;
  sideTitle?: string; links?: LinkItem[];
}
function NivelContentView(p: ContentProps) {
  const t = useTokens();
  const sepRows = useSep();
  const accent = accentOf(p.accent);
  const model = asList<TextItem>(p.model);
  const groups = asList<GroupItem>(p.groups);
  const extras = asList<TextItem>(p.extras);
  const links = asList<LinkItem>(p.links);
  const sep = sepRows.find((r) => r.level === p.sepLevel);
  return (
    <section className="bg-white py-12 sm:py-16">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-10">
          {(p.modelTitle || model.length > 0) && (
            <Reveal>
              <div>
                {p.modelTitle && (
                  <h2 className={`font-head text-fluid-xl font-bold ${accent.text}`}>
                    {t(p.modelTitle)}
                  </h2>
                )}
                <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
                  {model.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-[15px] leading-snug text-ink/90">
                      <CheckCircle2 size={17} className={`mt-0.5 shrink-0 ${accent.text}`} aria-hidden="true" />
                      {t(item.text)}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          )}

          {(p.groupsTitle || groups.length > 0) && (
            <Reveal>
              <div>
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
              <div className="rounded-xl2 border border-line bg-cream-2 p-5" style={{ borderLeft: `4px solid ${cmsColor(p.color)}` }}>
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

/* ── Defaults per level (lib/levels.ts is the original copy) ────────────── */
const levelColor = (l: LevelData) => `var(--nivel-${l.slug})`;

const heroProps = (l: LevelData) => ({
  label: 'Niveles Educativos', title: l.name, text: l.intro, image: l.hero, accent: l.accent, color: levelColor(l),
  primary: { label: 'Iniciar pre-registro', href: '/pre-registro' },
  secondary: { label: 'Agendar visita', href: '/agendar-visita' },
});

const contentProps = (l: LevelData) => ({
  accent: l.accent, color: levelColor(l),
  modelTitle: l.modelTitle, model: l.model.map((text) => ({ text })),
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
});

const othersProps = (l: LevelData) => ({
  title: 'Conozca también',
  items: LEVELS.filter((o) => o.slug !== l.slug).map((o) => ({ name: o.name, href: `/niveles/${o.slug}` })),
});

const textItem = [f.text('text', 'Texto', { required: true })];

export const sections = [
  section({
    type: 'hero', label: 'Nivel · Portada', description: 'Foto del nivel con velo oscuro, nombre, presentación y dos botones.',
    component: NivelHeroView,
    fields: [
      f.text('label', 'Etiqueta superior'),
      f.text('title', 'Título', { required: true }),
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
    type: 'content', label: 'Nivel · Contenido e información útil',
    description: 'Modelo educativo, grupos, notas, incorporación SEP y enlaces laterales. El registro SEP se edita en Ajustes.',
    component: NivelContentView,
    fields: [
      f.select('accent', 'Color de títulos e íconos', ACCENT_OPTIONS),
      f.color('color', 'Color del nivel (borde del recuadro SEP)'),
      f.text('modelTitle', 'Título de la lista principal'),
      f.items('model', 'Lista principal', textItem),
      f.text('groupsTitle', 'Título de los grupos'),
      f.items('groups', 'Grupos', [f.text('name', 'Nombre', { required: true }), f.textarea('detail', 'Detalle')]),
      f.items('extras', 'Notas finales', textItem),
      f.select('sepLevel', 'Nivel SEP a mostrar', SEP_LEVELS, { hint: 'El registro se toma de Ajustes · Incorporación SEP.' }),
      f.text('sepTitle', 'Título del recuadro SEP'),
      f.text('sepNote', 'Nota del recuadro SEP'),
      f.text('sideTitle', 'Título de la barra lateral'),
      f.items('links', 'Enlaces de la barra lateral', [f.text('label', 'Texto', { required: true }), f.text('href', 'Enlace', { required: true })]),
    ],
    defaults: contentProps(LEVELS[0]),
  }),
  section({
    type: 'others', label: 'Nivel · Conozca también', description: 'Tarjetas que llevan a los otros niveles.',
    component: NivelOthersView,
    fields: [
      f.text('title', 'Título'),
      f.items('items', 'Tarjetas', [f.text('name', 'Nombre', { required: true }), f.text('href', 'Enlace', { required: true })]),
    ],
    defaults: othersProps(LEVELS[0]),
  }),
];

export const templates: PageTemplate[] = LEVELS.map((l) => ({
  slug: l.slug, path: `/niveles/${l.slug}`, title: l.name, group: 'nivel',
  seo: { title: `${l.name} — Niveles Educativos`, description: l.seoDescription },
  sections: [
    { type: 'nivel.hero', props: heroProps(l) },
    { type: 'nivel.content', props: contentProps(l) },
    { type: 'nivel.others', props: othersProps(l) },
  ],
}));

export default defineModule(sections, templates);
