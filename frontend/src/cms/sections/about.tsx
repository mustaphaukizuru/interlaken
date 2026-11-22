/**
 * Nosotros (/nosotros): designed sections (docs/CMS-COMPLETION-PLAN.md). The
 * hero is the shared page.hero; every other section is the original markup
 * of AboutPage with its copy, photos, icons and colours as props.
 *
 * Media round (owner 2026-11-22): the same words with more to look at. Misión,
 * visión, values and credentials carry 3D illustrations (lib/illustrations),
 * the timeline sits beside an illustration panel, and the levels are photo
 * cards in the level colours.
 */
import { createElement } from 'react';
import { ArrowRight, Award, Cake, Eye, Globe2, GraduationCap, Heart, Sparkles, Target, Users } from 'lucide-react';
import { Section } from '@/components/ui/Section';
import { Reveal } from '@/components/ui/Reveal';
import { Blob, Accent } from '@/components/ui/Blob';
import { Illustration, IllustrationPanel, wash } from '@/components/ui/Illustration';
import { HistoryTimeline, type Milestone } from '@/components/public/HistoryTimeline';
import { CARD_SIZES } from '@/lib/images';
import { isIllustration, type IllustrationName } from '@/lib/illustrations';
import { resolveIllustration } from '@/lib/illustrationTopics';
import { iconResolver } from '../iconRuntime';
import { cmsColor, imageSrc, imageSrcSet, useCmsImage, useMediaAlt, useTokens, type CmsLink } from '../runtime';
import { asLink, asList, CmsAnchor, defineModule, f, headingFields, INFORMES_CTA, sectionsOf, VISIT_CTA } from './kit';
import './page';

/** The icons this module's defaults use; any other curated icon loads on demand. */
const cmsIcon = iconResolver({ Award, Eye, Globe2, Heart, Sparkles, Target, Users });

const section = sectionsOf('about');

function hideOnError(e: React.SyntheticEvent<HTMLImageElement>) {
  (e.target as HTMLImageElement).style.display = 'none';
}

/* ── Ilustraciones de las tarjetas ──────────────────────────────────────── */
type ArtMap = Record<string, IllustrationName>;
/** Content saved before the «Ilustración» field: each section maps its icons to the art that fits it. */
const MISSION_ART: ArtMap = { Target: 'proposito', Eye: 'brujula' };
const VALUES_ART: ArtMap = { Award: 'academico', Globe2: 'bilingue', Heart: 'valores', Sparkles: 'ideas', Users: 'comunidad', Target: 'convivir' };
const CREDENTIALS_ART: ArtMap = { Award: 'academico', Globe2: 'mundo', Users: 'logro' };

/** The chosen illustration; «none» keeps the icon; nothing chosen: by icon, then by title. */
function cardArt(it: CardItem, title: string, byIcon: ArtMap): IllustrationName | undefined {
  if (it.illustration === 'none') return undefined;
  if (isIllustration(it.illustration)) return it.illustration;
  return (it.icon ? byIcon[it.icon] : undefined) ?? resolveIllustration(undefined, title);
}

/** The small icon tile a card shows when it has no illustration (cmsIcon returns a stable component per name). */
function IconTile({ icon, color, size = 46 }: { icon?: string; color: string; size?: number }) {
  return (
    <div className="flex shrink-0 items-center justify-center rounded-md" style={{ width: size, height: size, background: `color-mix(in srgb, ${color} 10%, transparent)` }}>
      {createElement(cmsIcon(icon), { size: Math.round(size / 2), color })}
    </div>
  );
}

/* ── Misión y visión ────────────────────────────────────────────────────── */
interface CardItem { icon?: string; color?: string; title?: string; text?: string; illustration?: string }
interface MissionProps {
  title?: string; items?: CardItem[];
  image1?: number | string; alt1?: string; image2?: number | string; alt2?: string; image3?: number | string; alt3?: string;
  badgeValue?: string; badgeLabel?: string;
}
function AboutMissionView(p: MissionProps) {
  const t = useTokens();
  const altOf = useMediaAlt();
  return (
    <Section bg="white">
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-11">
        <Reveal direction="right" className="relative">
          <Blob tone="pink" opacity={0.08} size={200} shape={1} className="hidden sm:block" style={{ top: -56, left: -64 }} />
          <div className="relative">
            {p.title && (
              <h2 className="font-head text-fluid-3xl font-extrabold leading-tight tracking-[-0.02em] text-ink">
                {t(p.title)}
              </h2>
            )}
            {asList<CardItem>(p.items).map((it, i) => {
              const color = cmsColor(it.color);
              const title = t(it.title);
              const art = cardArt(it, title, MISSION_ART);
              return (
                <div key={i} className={`${i === 0 ? 'mt-7' : 'mt-4'} flex items-start gap-4 rounded-md p-4 sm:gap-5 sm:p-5`} style={{ background: wash(color, 7) }}>
                  {art ? (
                    <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-md bg-white shadow-card sm:h-20 sm:w-20">
                      <Illustration name={art} size={64} />
                    </div>
                  ) : (
                    <IconTile icon={it.icon} color={color} size={48} />
                  )}
                  <div>
                    <h3 className="font-head text-lg font-bold text-ink">{title}</h3>
                    {it.text && <p className="mt-1.5 text-base leading-relaxed text-muted">{t(it.text)}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </Reveal>

        {/* Image collage + floating mini-stat card */}
        <Reveal direction="left" className="relative">
          <Accent tone="green" variant="ring" size={64} opacity={0.4} className="hidden sm:block" style={{ top: -24, right: 20 }} />
          <div className="relative grid grid-cols-2 gap-3.5">
            {p.image1 && <img src={imageSrc(p.image1, 'md')} srcSet={imageSrcSet(p.image1)} sizes={CARD_SIZES} alt={altOf(p.image1, t(p.alt1))} width={520} height={240} loading="lazy" className="row-span-2 h-full min-h-60 w-full max-w-full rounded-md object-cover shadow-card" onError={hideOnError} />}
            {p.image2 && <img src={imageSrc(p.image2, 'md')} srcSet={imageSrcSet(p.image2)} sizes={CARD_SIZES} alt={altOf(p.image2, t(p.alt2))} width={260} height={113} loading="lazy" className="h-[124px] w-full max-w-full rounded-md object-cover shadow-card sm:h-[168px]" onError={hideOnError} />}
            {p.image3 && <img src={imageSrc(p.image3, 'md')} srcSet={imageSrcSet(p.image3)} sizes={CARD_SIZES} alt={altOf(p.image3, t(p.alt3))} width={260} height={113} loading="lazy" className="h-[124px] w-full max-w-full rounded-md object-cover shadow-card sm:h-[168px]" onError={hideOnError} />}
          </div>
          {/* Floating mini-stat card */}
          {p.badgeValue && (
            <div className="absolute -bottom-5 -left-2.5 flex items-center gap-3 rounded-md bg-white px-4 py-3.5 shadow-purple sm:-left-2.5">
              <div className="flex h-[42px] w-[42px] items-center justify-center rounded-md bg-pink/10">
                <Award size={20} color="var(--pink)" />
              </div>
              <div>
                <div className="font-head text-xl font-extrabold leading-none text-ink">{t(p.badgeValue)}</div>
                <div className="text-[11.5px] text-muted">{t(p.badgeLabel)}</div>
              </div>
            </div>
          )}
        </Reveal>
      </div>
    </Section>
  );
}

/* ── Línea de tiempo (BACKLOG P2-8) ─────────────────────────────────────── */
interface MilestoneItem { year?: string; title?: string; text?: string }
interface TimelineProps { eyebrow?: string; title?: string; items?: MilestoneItem[]; illustration?: string; image?: number | string; imageAlt?: string }
function AboutTimelineView(p: TimelineProps) {
  const t = useTokens();
  const items = asList<MilestoneItem>(p.items).map((it): Milestone => ({ year: t(it.year), title: t(it.title), desc: t(it.text) }));
  const photo = useCmsImage(p.image, t(p.imageAlt));
  // Saved before the field existed: the stepping-stones path, a journey to a flag.
  const art: IllustrationName | undefined = p.illustration === 'none' ? undefined : isIllustration(p.illustration) ? p.illustration : 'ritmo';
  const media = photo.src ? (
    <figure className="overflow-hidden rounded-md bg-cream-2 shadow-card">
      <img src={photo.src} srcSet={photo.srcSet} sizes="(min-width: 1024px) 440px, 100vw" alt={photo.alt} width={1200} height={960} loading="lazy" decoding="async" className="aspect-[5/4] w-full object-cover" />
    </figure>
  ) : art ? <IllustrationPanel name={art} tint="var(--purple)" /> : null;
  return (
    <Section bg="white">
      <div className="grid gap-8 lg:grid-cols-12 lg:gap-14">
        <div className="lg:col-span-5">
          <div className="lg:sticky lg:top-28">
            <Reveal>
              {p.eyebrow && <span className="section-label-green inline-flex">{t(p.eyebrow)}</span>}
              <h2 className="font-head text-fluid-3xl font-extrabold tracking-[-0.025em] text-ink">{t(p.title)}</h2>
            </Reveal>
            {media && <Reveal className="mt-8 max-w-[360px] lg:max-w-none">{media}</Reveal>}
          </div>
        </div>
        {/* An empty list renders nothing (HistoryTimeline would fall back to its built-in milestones). */}
        {items.length > 0 && (
          <div className="lg:col-span-7 lg:pt-3">
            <HistoryTimeline items={items} />
          </div>
        )}
      </div>
    </Section>
  );
}

/* ── Valores: illustrated cards (art tile beside the text on phones, above it from sm) ── */
interface CardsProps { eyebrow?: string; title?: string; items?: CardItem[] }
function AboutValuesView(p: CardsProps) {
  const t = useTokens();
  return (
    <Section bg="cream">
      <Reveal className="mb-10 text-center sm:mb-11">
        {p.eyebrow && <span className="section-label-purple inline-flex">{t(p.eyebrow)}</span>}
        <h2 className="font-head text-fluid-3xl font-extrabold tracking-[-0.025em] text-ink">{t(p.title)}</h2>
      </Reveal>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
        {asList<CardItem>(p.items).map((v, i) => {
          const color = cmsColor(v.color);
          const title = t(v.title);
          const art = cardArt(v, title, VALUES_ART);
          return (
            <Reveal key={i} delay={i * 60} className="h-full">
              <div className="flex h-full items-start gap-4 rounded-md bg-white p-5 shadow-card sm:flex-col sm:gap-0 sm:p-6">
                {art ? (
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md sm:h-[104px] sm:w-[104px]" style={{ background: wash(color, 13) }}>
                    <Illustration name={art} size={92} fluid className="w-[84%]" />
                  </div>
                ) : (
                  <IconTile icon={v.icon} color={color} />
                )}
                <div>
                  <h3 className="font-head text-lg font-bold text-ink sm:mt-5">{title}</h3>
                  {v.text && <p className="mt-1.5 text-base leading-relaxed text-muted">{t(v.text)}</p>}
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}

/* ── Niveles: photo cards in the level colours ──────────────────────────── */
// Mirrors the levels offered in the ficha de inscripción grade picker.
/** The colour picked in the editor, used when the level is not one of the three known by name. */
const LEVEL_TONES: Record<string, string> = { green: 'var(--green)', brand: 'var(--purple)', coral: 'var(--coral)' };
const LEVEL_TONE_OPTIONS = [
  { value: 'green', label: 'Verde' },
  { value: 'brand', label: 'Morado' },
  { value: 'coral', label: 'Coral' },
];
/** Each level's campus photo and colour (the level pages use the same ones). */
const LEVEL_MEDIA: Record<string, { image: string; alt: string; color: string }> = {
  preescolar: { image: '/assets/hopscotch.webp', alt: 'Patio de preescolar con un avión pintado en el piso', color: 'var(--nivel-preescolar)' },
  primaria: { image: '/assets/court-primaria.webp', alt: 'Cancha de primaria con el letrero del nivel', color: 'var(--nivel-primaria)' },
  secundaria: { image: '/assets/secundaria.webp', alt: 'Entrada al edificio de secundaria', color: 'var(--nivel-secundaria)' },
};
const levelMedia = (name: string) => LEVEL_MEDIA[name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()];

interface LevelItem { name?: string; grades?: string; age?: string; tone?: string; image?: number | string; imageAlt?: string }
function AboutLevelsView(p: { eyebrow?: string; title?: string; items?: LevelItem[] }) {
  const t = useTokens();
  const altOf = useMediaAlt();
  const items = asList<LevelItem>(p.items);
  return (
    <Section bg="white">
      <Reveal className="mb-9 text-center sm:mb-10">
        {p.eyebrow && <span className="section-label-green inline-flex">{t(p.eyebrow)}</span>}
        <h2 className="font-head text-fluid-3xl font-extrabold tracking-[-0.025em] text-ink">{t(p.title)}</h2>
      </Reveal>
      <div className={`grid grid-cols-1 gap-5 sm:grid-cols-2 ${items.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        {items.map((l, i) => {
          const name = t(l.name);
          const known = levelMedia(name);
          const color = known?.color ?? LEVEL_TONES[l.tone ?? ''] ?? LEVEL_TONES.green;
          const image = l.image || known?.image;
          return (
            <Reveal key={i} delay={i * 80} className="h-full">
              <div className="flex h-full flex-col overflow-hidden rounded-md bg-white shadow-card">
                <div className="relative aspect-[16/10] overflow-hidden" style={{ background: wash(color, 16) }}>
                  {image && (
                    <img src={imageSrc(image, 'md')} srcSet={imageSrcSet(image)} sizes={CARD_SIZES} alt={altOf(image, t(l.imageAlt) || known?.alt || '')} width={400} height={250} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" onError={hideOnError} />
                  )}
                  <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-dark/75 via-dark/10 to-transparent" />
                  <div className="absolute inset-x-5 bottom-4">
                    <span aria-hidden="true" className="mb-2 block h-1 w-10 rounded-full" style={{ background: color }} />
                    <h3 className="font-head text-[24px] font-extrabold leading-none text-white">{name}</h3>
                  </div>
                </div>
                <div className="flex flex-1 flex-wrap items-center gap-2.5 p-5" style={{ borderTop: `4px solid ${color}` }}>
                  {l.grades && (
                    <p className="inline-flex items-center gap-2 rounded-sm px-3 py-1.5 text-base font-semibold text-ink" style={{ background: wash(color, 16) }}>
                      <GraduationCap size={17} aria-hidden="true" className="text-ink/70" /> {t(l.grades)}
                    </p>
                  )}
                  {l.age && (
                    <p className="inline-flex items-center gap-2 rounded-sm bg-cream-2 px-3 py-1.5 text-base text-ink/80">
                      <Cake size={17} aria-hidden="true" className="text-ink/60" /> {t(l.age)}
                    </p>
                  )}
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}

/* ── Respaldo: illustrated cards (the level pages' program cards) ───────── */
function AboutCredentialsView(p: CardsProps) {
  const t = useTokens();
  return (
    <Section bg="cream">
      <Reveal className="mb-10 text-center sm:mb-11">
        {p.eyebrow && <span className="section-label-pink inline-flex">{t(p.eyebrow)}</span>}
        <h2 className="font-head text-fluid-3xl font-extrabold tracking-[-0.025em] text-ink">{t(p.title)}</h2>
      </Reveal>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {asList<CardItem>(p.items).map((c, i) => {
          const color = cmsColor(c.color);
          const title = t(c.title);
          const art = cardArt(c, title, CREDENTIALS_ART);
          return (
            <Reveal key={i} delay={i * 90} className="h-full">
              {/* Phones: the art in a tile beside the text; from sm a header band above it. */}
              <div className="flex h-full items-start gap-4 rounded-md bg-white p-5 shadow-card sm:flex-col sm:items-stretch sm:gap-0 sm:overflow-hidden sm:p-0">
                {art ? (
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md sm:h-auto sm:w-auto sm:rounded-none sm:py-6" style={{ background: wash(color, 12) }}>
                    <Illustration name={art} size={136} fluid className="w-[84%] sm:w-[136px]" />
                  </div>
                ) : (
                  <div className="sm:px-6 sm:pt-6"><IconTile icon={c.icon} color={color} size={52} /></div>
                )}
                <div className="flex-1 sm:p-6">
                  <h3 className="font-head text-[19px] font-bold text-ink">{title}</h3>
                  {c.text && <p className="mt-2 text-base leading-relaxed text-muted">{t(c.text)}</p>}
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}

/* ── Llamado final ──────────────────────────────────────────────────────── */
function AboutCtaView(p: { title?: string; text?: string; primary?: CmsLink; secondary?: CmsLink }) {
  const t = useTokens();
  const primary = asLink(p.primary);
  const secondary = asLink(p.secondary);
  return (
    <Section bg="gradient" spacing="sm" className="text-center">
      <h2 className="font-head text-fluid-3xl font-black tracking-[-0.025em]">{t(p.title)}</h2>
      {p.text && <p className="mx-auto mt-3 max-w-xl text-fluid-base opacity-90">{t(p.text)}</p>}
      {(primary.href || secondary.href) && (
        <div className="mt-7 flex flex-wrap justify-center gap-3.5">
          <CmsAnchor link={primary} className="btn btn-lg bg-white text-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">{t(primary.label)} <ArrowRight size={17} /></CmsAnchor>
          <CmsAnchor link={secondary} className="btn-ghost btn-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">{t(secondary.label)}</CmsAnchor>
        </div>
      )}
    </Section>
  );
}

const cardItem = [
  f.illustration('illustration', 'Ilustración', { hint: 'Se muestra en lugar del ícono. Sin elegir, se toma la que corresponde al ícono.' }),
  f.icon('icon', 'Ícono (sin ilustración)'), f.color('color'), f.text('title', 'Título', { required: true }), f.textarea('text', 'Texto'),
];

export const sections = [
  section({
    type: 'mission', label: 'Nosotros · Misión y visión', description: 'Misión y visión con ilustración, mosaico de tres fotos e insignia de egresados.',
    component: AboutMissionView,
    fields: [
      f.text('title', 'Título'),
      f.items('items', 'Bloques (misión, visión...)', cardItem),
      f.image('image1', 'Foto grande'), f.text('alt1', 'Descripción de la foto grande'),
      f.image('image2', 'Foto superior'), f.text('alt2', 'Descripción de la foto superior'),
      f.image('image3', 'Foto inferior'), f.text('alt3', 'Descripción de la foto inferior'),
      f.text('badgeValue', 'Insignia: cifra', { hint: 'Vacío = sin insignia.' }), f.text('badgeLabel', 'Insignia: texto'),
    ],
    defaults: {
      title: 'Nuestra misión y visión',
      items: [
        { icon: 'Target', illustration: 'proposito', color: 'var(--purple)', title: 'Misión', text: 'Formar personas íntegras, críticas y comprometidas con su entorno, capaces de afrontar los retos del siglo XXI con confianza y habilidades globales.' },
        { icon: 'Eye', illustration: 'brujula', color: 'var(--green)', title: 'Visión', text: 'Ser la comunidad educativa de referencia en la zona, reconocida por la excelencia académica, el bilingüismo y la formación humana de sus egresados.' },
      ],
      image1: '/assets/facade.webp', alt1: 'Fachada del Colegio Interlaken',
      image2: '/assets/classroom.webp', alt2: 'Aula del colegio',
      image3: '/assets/campus-mural.webp', alt3: 'Mural del campus',
      badgeValue: '+2,500', badgeLabel: 'Egresados',
    },
  }),
  section({
    type: 'timeline', label: 'Nosotros · Trayectoria', description: 'Línea de tiempo con los momentos importantes del colegio, junto a una ilustración o una foto.',
    component: AboutTimelineView,
    fields: [
      ...headingFields(),
      f.items('items', 'Momentos', [f.text('year', 'Año', { required: true, hint: 'Puede usar {{fundacion}} y {{anio}}.' }), f.text('title', 'Título', { required: true }), f.textarea('text', 'Texto')]),
      f.illustration('illustration', 'Ilustración', { hint: 'Se muestra junto a la línea de tiempo.' }),
      f.image('image', 'Foto en lugar de la ilustración', { hint: 'Opcional. Fotos del colegio o con permiso; sin rostros de alumnos sin consentimiento.' }),
      f.text('imageAlt', 'Descripción de la foto', { hint: 'Qué se ve en la foto, para quien no puede verla y para Google.' }),
    ],
    defaults: {
      eyebrow: 'Trayectoria', title: '{{anios}} años formando líderes', illustration: 'ritmo',
      items: [
        { year: '{{fundacion}}', title: 'Fundación', text: 'Nace Colegio Interlaken en Tlalnepantla con preescolar y primaria, y una vocación bilingüe desde el primer día.' },
        { year: '1990', title: 'Secundaria', text: 'Se abre la secundaria incorporada a la SEP, completando la formación básica en un solo campus.' },
        { year: '2006', title: 'Campus y deportes', text: 'Ampliación de instalaciones deportivas y talleres: canchas, laboratorio y espacios de arte.' },
        { year: '2019', title: 'Tecnología en el aula', text: 'iPad de 4° a 6° de primaria, Google Classroom y plataformas para familias.' },
        { year: '{{anio}}', title: '{{anios}} años', text: 'Portal de Familias con cafetería digital, comunicados y admisiones en línea. La misma comunidad, nuevas herramientas.' },
      ],
    },
  }),
  section({
    type: 'values', label: 'Nosotros · Valores', description: 'Tarjetas de valores con ilustración y color.',
    component: AboutValuesView,
    fields: [...headingFields(), f.items('items', 'Valores', cardItem)],
    defaults: {
      eyebrow: 'Lo que nos define', title: 'Nuestros valores',
      items: [
        { icon: 'Award', illustration: 'academico', color: 'var(--purple)', title: 'Excelencia académica', text: 'Formación rigurosa con enfoque humanista y pensamiento crítico.' },
        { icon: 'Globe2', illustration: 'bilingue', color: 'var(--green)', title: 'Bilingüismo real', text: 'Inglés intensivo desde el nivel inicial con certificaciones internacionales.' },
        { icon: 'Heart', illustration: 'valores', color: 'var(--pink)', title: 'Formación en valores', text: 'Ciudadanía, empatía y responsabilidad como parte de la vida diaria.' },
        { icon: 'Sparkles', illustration: 'ideas', color: 'var(--green)', title: 'Innovación educativa', text: 'Tecnología, ciencia y creatividad integradas al aula.' },
        { icon: 'Users', illustration: 'comunidad', color: 'var(--purple-mid)', title: 'Comunidad integrada', text: 'Un ambiente cálido e inclusivo donde cada familia pertenece.' },
        { icon: 'Target', illustration: 'convivir', color: 'var(--amber)', title: 'Acompañamiento', text: 'Apoyo psicopedagógico personalizado para cada alumno.' },
      ],
    },
  }),
  section({
    type: 'levels', label: 'Nosotros · Niveles educativos', description: 'Tarjetas con la foto, el color, los grados y las edades de cada nivel.',
    component: AboutLevelsView,
    fields: [
      ...headingFields(),
      f.items('items', 'Niveles', [
        f.text('name', 'Nivel', { required: true }), f.text('grades', 'Grados'), f.text('age', 'Edades'),
        f.select('tone', 'Color', LEVEL_TONE_OPTIONS, { hint: 'Preescolar, Primaria y Secundaria usan el color de su nivel.' }),
        f.image('image', 'Foto', { hint: 'Vacía = la foto del nivel.' }),
        f.text('imageAlt', 'Descripción de la foto', { hint: 'Qué se ve en la foto, para quien no puede verla y para Google.' }),
      ]),
    ],
    defaults: {
      eyebrow: 'Oferta educativa', title: 'Niveles educativos',
      items: [
        { name: 'Preescolar', grades: '1°–3°', age: '3–6 años', tone: 'green', image: LEVEL_MEDIA.preescolar.image, imageAlt: LEVEL_MEDIA.preescolar.alt },
        { name: 'Primaria', grades: '1°–6°', age: '6–12 años', tone: 'brand', image: LEVEL_MEDIA.primaria.image, imageAlt: LEVEL_MEDIA.primaria.alt },
        { name: 'Secundaria', grades: '1°–3°', age: '12–15 años', tone: 'coral', image: LEVEL_MEDIA.secundaria.image, imageAlt: LEVEL_MEDIA.secundaria.alt },
      ],
    },
  }),
  section({
    type: 'credentials', label: 'Nosotros · Respaldo', description: 'Tarjetas ilustradas con certificaciones y trayectoria del colegio.',
    component: AboutCredentialsView,
    fields: [...headingFields(), f.items('items', 'Tarjetas', cardItem)],
    defaults: {
      eyebrow: 'Nuestro respaldo', title: 'Certificaciones y trayectoria que dan certeza',
      items: [
        { icon: 'Award', illustration: 'academico', color: 'var(--purple)', title: 'Incorporación oficial SEP', text: 'Estudios con reconocimiento y validez oficial ante la Secretaría de Educación Pública.' },
        { icon: 'Globe2', illustration: 'mundo', color: 'var(--green)', title: 'Certificaciones de inglés', text: 'Preparamos a los alumnos para exámenes de certificación internacional de inglés.' },
        { icon: 'Users', illustration: 'logro', color: 'var(--pink)', title: 'Más de 2,500 egresados', text: 'Cuatro décadas de comunidad que respaldan nuestra trayectoria en Tlalnepantla.' },
      ],
    },
  }),
  section({
    type: 'cta', label: 'Nosotros · Llamado final', description: 'Franja en degradado con dos botones.',
    component: AboutCtaView,
    fields: [f.text('title', 'Título'), f.textarea('text', 'Texto'), f.link('primary', 'Botón principal'), f.link('secondary', 'Botón secundario')],
    defaults: {
      title: '¿Desea conocernos de cerca?', text: 'Agende una visita para conocer el colegio o escríbanos para recibir informes. Le acompañamos en cada paso de la admisión.',
      primary: VISIT_CTA, secondary: INFORMES_CTA,
    },
  }),
];

export const templates = [{
  slug: 'nosotros', path: '/nosotros', title: 'Nosotros', group: 'about',
  seo: {},
  sections: [
    { type: 'page.hero', props: {
      label: 'Nuestra Historia', labelClass: 'section-label-pink', image: '/assets/facade-sign.webp', focus: 'center 40%',
      title: '{{anios}} años formando\nlíderes en Tlalnepantla',
      subtitle: 'Colegio Interlaken es una institución educativa privada con más de cuatro décadas de trayectoria, ofreciendo educación bilingüe de calidad desde preescolar hasta secundaria.',
    } },
    'about.mission', 'about.timeline', 'about.values', 'about.levels', 'about.credentials', 'about.cta',
  ],
}];

export default defineModule(sections, templates);
