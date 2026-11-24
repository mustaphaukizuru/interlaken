/**
 * Modelo educativo (/modelo-educativo): designed sections
 * (docs/CMS-COMPLETION-PLAN.md). The original markup of ModeloEducativoPage
 * with its copy, photo, pillars and level links as props.
 *
 * Media round (owner 2026-11-22): each pillar is an illustrated card (the
 * level pages' program cards) and the level links are photo cards in the
 * level colours. Every word of copy stays.
 */
import { ArrowRight, BookOpenCheck, Globe2, HeartHandshake, Laptop, Leaf, Trophy } from 'lucide-react';
import { Reveal } from '@/components/ui/Reveal';
import { Illustration, wash } from '@/components/ui/Illustration';
import { isIllustration, type IllustrationName } from '@/lib/illustrations';
import { resolveIllustration } from '@/lib/illustrationTopics';
import { iconResolver } from '../iconRuntime';
import { cmsColor, imageSrc, imageSrcSet, useMediaAlt, useTokens, type CmsLink } from '../runtime';
import { asList, CmsAnchor, defineModule, f, Lines, sectionsOf } from './kit';

/**
 * Level photos: a 112 px (w-28) thumbnail on phones; from sm a card in a 3-column
 * (2 with fewer links) grid inside the dark box (measured 2026-11-24: 220 px at 820,
 * 331 px from 1280 with 3 columns).
 */
const thumbSizes = (cols: number) =>
  cols === 3 ? '(min-width: 1024px) 340px, (min-width: 640px) 30vw, 112px' : '(min-width: 1024px) 500px, (min-width: 640px) 45vw, 112px';

/** The icons this module's defaults use; any other curated icon loads on demand. */
const cmsIcon = iconResolver({ BookOpenCheck, Globe2, HeartHandshake, Laptop, Leaf, Trophy });

const section = sectionsOf('modelo');

/** Pillars saved before the «Ilustración» field: their icon picks the art. */
const PILLAR_ART: Record<string, IllustrationName> = {
  Globe2: 'bilingue', BookOpenCheck: 'academico', HeartHandshake: 'valores', Laptop: 'tecnologia', Leaf: 'ecologia', Trophy: 'actividades',
};
/** …and their position picks the card colour. */
const PILLAR_COLORS = ['var(--purple)', 'var(--amber)', 'var(--pink)', 'var(--nivel-secundaria)', 'var(--green)', 'var(--purple-mid)'];

function pillarArt(it: Pillar, title: string): IllustrationName | undefined {
  if (it.illustration === 'none') return undefined;
  if (isIllustration(it.illustration)) return it.illustration;
  return (it.icon ? PILLAR_ART[it.icon] : undefined) ?? resolveIllustration(undefined, title);
}

/** Each level's campus photo and colour, for the level links (the level pages use the same ones). */
const LEVEL_MEDIA: Record<string, { image: string; color: string }> = {
  preescolar: { image: '/assets/hopscotch.webp', color: 'var(--nivel-preescolar)' },
  primaria: { image: '/assets/court-primaria.webp', color: 'var(--nivel-primaria)' },
  secundaria: { image: '/assets/secundaria.webp', color: 'var(--nivel-secundaria)' },
};
const levelOf = (href: string | undefined) => LEVEL_MEDIA[/\/niveles\/([\w-]+)/.exec(href ?? '')?.[1] ?? ''];

/* ── Portada ────────────────────────────────────────────────────────────── */
function ModeloHeroView(p: { label?: string; title?: string; subtitle?: string; image?: number | string }) {
  const t = useTokens();
  return (
    <section className="relative overflow-hidden bg-dark text-white">
      {p.image && <img src={imageSrc(p.image)} srcSet={imageSrcSet(p.image, { full: true })} sizes="100vw" alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" loading="eager" />}
      <div className="absolute inset-0 bg-gradient-to-r from-dark/90 via-dark/70 to-dark/40" />
      <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        {p.label && <span className="section-label-green inline-flex">{t(p.label)}</span>}
        <h1 className="mt-3 font-head text-fluid-3xl font-black leading-tight tracking-[-0.02em]">
          <Lines text={t(p.title)} />
        </h1>
        {p.subtitle && (
          <p className="mt-4 max-w-2xl text-[15.5px] leading-relaxed text-white/80">
            {t(p.subtitle)}
          </p>
        )}
      </div>
    </section>
  );
}

/* ── Pilares y niveles ──────────────────────────────────────────────────── */
interface Pillar { icon?: string; title?: string; text?: string; illustration?: string; color?: string }
type LevelLink = CmsLink & { image?: number | string };
interface PillarsProps { items?: Pillar[]; ctaTitle?: string; links?: LevelLink[] }
function ModeloPillarsView(p: PillarsProps) {
  const t = useTokens();
  const altOf = useMediaAlt();
  const links = asList<LevelLink>(p.links).filter((l) => l?.href);
  return (
    <section className="bg-cream-2 py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {asList<Pillar>(p.items).map((it, i) => {
            const Icon = cmsIcon(it.icon);
            const title = t(it.title);
            const art = pillarArt(it, title);
            const color = cmsColor(it.color, PILLAR_COLORS[i % PILLAR_COLORS.length]);
            return (
              <Reveal key={i} delay={(i % 3) * 60} className="h-full">
                {/* Phones: the art in a tile beside the text, so six pillars stay short; from sm a header band above it. */}
                <div className="flex h-full items-start gap-4 rounded-md bg-white p-5 shadow-card sm:flex-col sm:items-stretch sm:gap-0 sm:overflow-hidden sm:p-0">
                  {art ? (
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md sm:h-auto sm:w-auto sm:rounded-none sm:py-6" style={{ background: wash(color, 14) }}>
                      <Illustration name={art} size={136} fluid className="w-[84%] sm:w-[136px]" />
                    </div>
                  ) : (
                    <div className="sm:px-6 sm:pt-6"><Icon size={22} className="text-green-dark" aria-hidden="true" /></div>
                  )}
                  <div className="flex-1 sm:p-6">
                    <h2 className="font-head text-lg font-bold text-ink">{title}</h2>
                    {it.text && <p className="mt-2 text-base leading-relaxed text-muted">{t(it.text)}</p>}
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>

        {(p.ctaTitle || links.length > 0) && (
          <Reveal className="mt-12 sm:mt-14">
            <div className="rounded-md bg-dark p-6 text-white sm:p-10">
              {p.ctaTitle && (
                <h2 className="text-center font-head text-fluid-xl font-bold">
                  {t(p.ctaTitle)}
                </h2>
              )}
              {links.length > 0 && (
                <ul className={`mt-6 grid gap-4 sm:mt-7 ${links.length >= 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                  {links.map((l, i) => {
                    const level = levelOf(l.href);
                    const image = l.image || level?.image;
                    const color = level?.color ?? 'var(--purple-mid)';
                    return (
                      <li key={i}>
                        {/* Phones: a photo thumbnail beside the name; from sm the photo above it. The level colour is the rule between them. */}
                        <CmsAnchor
                          link={l}
                          className="group flex h-full overflow-hidden rounded-md bg-dark-3 transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:flex-col"
                        >
                          {image && (
                            <span className="relative block w-28 shrink-0 overflow-hidden sm:aspect-[16/9] sm:w-auto">
                              <img src={imageSrc(image, 'md')} srcSet={imageSrcSet(image)} sizes={thumbSizes(links.length >= 3 ? 3 : 2)} alt={altOf(image)} width={400} height={225} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100" />
                            </span>
                          )}
                          <span className="flex min-h-[88px] flex-1 items-center justify-between gap-3 border-l-4 px-5 py-4 sm:min-h-0 sm:border-l-0 sm:border-t-4" style={{ borderColor: color }}>
                            <span className="font-head text-lg font-bold capitalize">{t(l.label)}</span>
                            <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${level ? 'text-ink' : 'text-white'} transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none`} style={{ background: color }}>
                              <ArrowRight size={16} />
                            </span>
                          </span>
                        </CmsAnchor>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Reveal>
        )}
      </div>
    </section>
  );
}

export const sections = [
  section({
    type: 'hero', label: 'Modelo educativo · Portada', description: 'Foto del campus con velo oscuro, etiqueta, título y texto.',
    component: ModeloHeroView,
    fields: [f.text('label', 'Etiqueta superior'), f.textarea('title', 'Título', { required: true }), f.textarea('subtitle', 'Texto'), f.image('image', 'Foto de fondo')],
    defaults: {
      label: 'El Colegio', title: 'Modelo Educativo', image: '/assets/campus-mural.webp',
      subtitle: 'Un modelo propio orientado a una formación de calidad: los alumnos adquieren conocimientos y desarrollan habilidades y actitudes que los hacen competentes en la vida diaria y los preparan para su siguiente nivel educativo.',
    },
  }),
  section({
    type: 'pillars', label: 'Modelo educativo · Pilares', description: 'Tarjetas ilustradas con los pilares del modelo y recuadro oscuro con una tarjeta con foto para cada nivel.',
    component: ModeloPillarsView,
    fields: [
      f.items('items', 'Pilares', [
        f.illustration('illustration', 'Ilustración', { hint: 'Se muestra en lugar del ícono. Sin elegir, se toma la que corresponde al ícono.' }),
        f.icon('icon', 'Ícono (sin ilustración)'), f.color('color', 'Color de fondo de la ilustración'),
        f.text('title', 'Título', { required: true }), f.textarea('text', 'Texto'),
      ]),
      f.text('ctaTitle', 'Título del recuadro final', { hint: 'Vacío y sin enlaces = sin recuadro.' }),
      f.items('links', 'Enlaces del recuadro', [
        f.text('label', 'Texto', { required: true }), f.href('href', 'Enlace', { required: true }),
        f.image('image', 'Foto', { hint: 'Vacía = la foto del nivel al que lleva el enlace.' }),
      ]),
    ],
    defaults: {
      items: [
        { icon: 'Globe2', illustration: 'bilingue', color: PILLAR_COLORS[0], title: 'Educación bilingüe', text: 'Español–Inglés en los tres niveles, con preparación para el First Certificate de la Universidad de Cambridge en Secundaria.' },
        { icon: 'BookOpenCheck', illustration: 'academico', color: PILLAR_COLORS[1], title: 'Alto nivel académico', text: 'Planes y Programas de la SEP enriquecidos con horas clase adicionales, Proyecto de Activación a la Inteligencia y Taller de Lectura y Redacción.' },
        { icon: 'HeartHandshake', illustration: 'valores', color: PILLAR_COLORS[2], title: 'Educación en Valores', text: 'Formamos mejores seres humanos: valores en el quehacer diario, ayuda y servicio a la comunidad, ceremonias y convivencia.' },
        { icon: 'Laptop', illustration: 'tecnologia', color: PILLAR_COLORS[3], title: 'Tecnología en el aula', text: 'iPad integrado al salón de clases (de 4º de Primaria en adelante) y Educación Tecnológica con certificación en Word, Excel y PowerPoint.' },
        { icon: 'Leaf', illustration: 'ecologia', color: PILLAR_COLORS[4], title: 'Cultura Ecológica', text: 'Conciencia ambiental transversal en actividades, campañas y proyectos escolares.' },
        { icon: 'Trophy', illustration: 'actividades', color: PILLAR_COLORS[5], title: 'Actividades que complementan', text: 'Visitas, concursos, exposiciones, festivales, ExpoInterlaken · Maratón de Conocimientos y actividades extraescolares deportivas y culturales.' },
      ],
      ctaTitle: 'Conózcalo en acción, nivel por nivel',
      links: [
        { label: 'preescolar', href: '/niveles/preescolar', image: LEVEL_MEDIA.preescolar.image },
        { label: 'primaria', href: '/niveles/primaria', image: LEVEL_MEDIA.primaria.image },
        { label: 'secundaria', href: '/niveles/secundaria', image: LEVEL_MEDIA.secundaria.image },
      ],
    },
  }),
];

export const templates = [{
  slug: 'modelo-educativo', path: '/modelo-educativo', title: 'Modelo educativo', group: 'modelo',
  seo: {}, // title and description: lib/routeMeta.ts ROUTE_META
  sections: ['modelo.hero', 'modelo.pillars'],
}];

export default defineModule(sections, templates);
