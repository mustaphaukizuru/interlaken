/**
 * Nosotros (/nosotros): designed sections (docs/CMS-COMPLETION-PLAN.md). The
 * hero is the shared page.hero; every other section is the original markup
 * of AboutPage with its copy, photos, icons and colours as props.
 */
import { ArrowRight, Award, Eye, Globe2, Heart, Sparkles, Target, Users } from 'lucide-react';
import { Section } from '@/components/ui/Section';
import { Reveal } from '@/components/ui/Reveal';
import { Blob, Accent } from '@/components/ui/Blob';
import { HistoryTimeline, type Milestone } from '@/components/public/HistoryTimeline';
import { CARD_SIZES } from '@/lib/images';
import { iconResolver } from '../iconRuntime';
import { cmsColor, imageSrc, imageSrcSet, useMediaAlt, useTokens, type CmsLink } from '../runtime';
import { asLink, asList, CmsAnchor, defineModule, f, headingFields, sectionsOf } from './kit';
import './page';

/** The icons this module's defaults use; any other curated icon loads on demand. */
const cmsIcon = iconResolver({ Award, Eye, Globe2, Heart, Sparkles, Target, Users });

const section = sectionsOf('about');

// Icons this page used that the curated CMS set does not include yet.

function hideOnError(e: React.SyntheticEvent<HTMLImageElement>) {
  (e.target as HTMLImageElement).style.display = 'none';
}

/* ── Misión y visión ────────────────────────────────────────────────────── */
interface CardItem { icon?: string; color?: string; title?: string; text?: string }
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
          <Blob tone="pink" opacity={0.1} size={280} shape={1} className="hidden sm:block" style={{ top: -40, left: -50 }} />
          <div className="relative">
            {p.title && (
              <h2 className="font-head text-fluid-3xl font-extrabold leading-tight tracking-[-0.02em] text-ink">
                {t(p.title)}
              </h2>
            )}
            {asList<CardItem>(p.items).map((it, i) => {
              const color = cmsColor(it.color);
              const Icon = cmsIcon(it.icon);
              return (
                <div key={i} className={`${i === 0 ? 'mt-6' : 'mt-5'} flex gap-4`}>
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl" style={{ background: `color-mix(in srgb, ${color} 10%, transparent)` }}>
                    <Icon size={22} color={color} />
                  </div>
                  <div>
                    <h3 className="font-head text-[17px] font-bold text-ink">{t(it.title)}</h3>
                    {it.text && <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{t(it.text)}</p>}
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
            {p.image1 && <img src={imageSrc(p.image1, 'md')} srcSet={imageSrcSet(p.image1)} sizes={CARD_SIZES} alt={altOf(p.image1, t(p.alt1))} width={520} height={240} loading="lazy" className="row-span-2 h-60 w-full max-w-full rounded-2xl object-cover" onError={hideOnError} />}
            {p.image2 && <img src={imageSrc(p.image2, 'md')} srcSet={imageSrcSet(p.image2)} sizes={CARD_SIZES} alt={altOf(p.image2, t(p.alt2))} width={260} height={113} loading="lazy" className="h-[113px] w-full max-w-full rounded-2xl object-cover" onError={hideOnError} />}
            {p.image3 && <img src={imageSrc(p.image3, 'md')} srcSet={imageSrcSet(p.image3)} sizes={CARD_SIZES} alt={altOf(p.image3, t(p.alt3))} width={260} height={113} loading="lazy" className="h-[113px] w-full max-w-full rounded-2xl object-cover" onError={hideOnError} />}
          </div>
          {/* Floating mini-stat card */}
          {p.badgeValue && (
            <div className="absolute -bottom-5 -left-2.5 flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3.5 shadow-purple sm:-left-2.5">
              <div className="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-pink/10">
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
interface TimelineProps { eyebrow?: string; title?: string; items?: MilestoneItem[] }
function AboutTimelineView(p: TimelineProps) {
  const t = useTokens();
  const items = asList<MilestoneItem>(p.items).map((it): Milestone => ({ year: t(it.year), title: t(it.title), desc: t(it.text) }));
  return (
    <Section bg="white">
      <Reveal className="mb-8 text-center sm:mb-10">
        {p.eyebrow && <span className="section-label-green inline-flex">{t(p.eyebrow)}</span>}
        <h2 className="font-head text-fluid-3xl font-extrabold tracking-[-0.025em] text-ink">{t(p.title)}</h2>
      </Reveal>
      {/* An empty list renders nothing (HistoryTimeline would fall back to its built-in milestones). */}
      {items.length > 0 && (
        <div className="mx-auto max-w-3xl">
          <HistoryTimeline items={items} />
        </div>
      )}
    </Section>
  );
}

/* ── Valores ────────────────────────────────────────────────────────────── */
interface CardsProps { eyebrow?: string; title?: string; items?: CardItem[] }
function AboutValuesView(p: CardsProps) {
  const t = useTokens();
  return (
    <Section bg="cream">
      <Reveal className="mb-10 text-center sm:mb-11">
        {p.eyebrow && <span className="section-label-purple inline-flex">{t(p.eyebrow)}</span>}
        <h2 className="font-head text-fluid-3xl font-extrabold tracking-[-0.025em] text-ink">{t(p.title)}</h2>
      </Reveal>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {asList<CardItem>(p.items).map((v, i) => {
          const color = cmsColor(v.color);
          const Icon = cmsIcon(v.icon);
          return (
            <Reveal key={i} delay={i * 70}>
              <div className="card hover-lift h-full">
                <div
                  className="flex h-[46px] w-[46px] items-center justify-center rounded-xl2"
                  style={{ background: `color-mix(in srgb, ${color} 9%, transparent)` }}
                >
                  <Icon size={22} color={color} />
                </div>
                <h3 className="mt-4 font-head text-[17px] font-bold text-ink">{t(v.title)}</h3>
                {v.text && <p className="mt-2 text-sm leading-relaxed text-muted">{t(v.text)}</p>}
              </div>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}

/* ── Niveles ────────────────────────────────────────────────────────────── */
// Levels use brand scales/tokens (green/brand/coral have numeric ramps).
// Mirrors the levels offered in the pre-registro grade picker.
const LEVEL_TONES: Record<string, string> = {
  green: 'bg-green-50 border-green-200 text-green-700',
  brand: 'bg-brand-50 border-brand-200 text-brand-700',
  coral: 'bg-coral-50 border-coral-200 text-coral-700',
};
const LEVEL_TONE_OPTIONS = [
  { value: 'green', label: 'Verde' },
  { value: 'brand', label: 'Morado' },
  { value: 'coral', label: 'Coral' },
];
interface LevelItem { name?: string; grades?: string; age?: string; tone?: string }
function AboutLevelsView(p: { eyebrow?: string; title?: string; items?: LevelItem[] }) {
  const t = useTokens();
  return (
    <Section bg="white">
      <Reveal className="mb-9 text-center">
        {p.eyebrow && <span className="section-label-green inline-flex">{t(p.eyebrow)}</span>}
        <h2 className="font-head text-fluid-3xl font-extrabold tracking-[-0.025em] text-ink">{t(p.title)}</h2>
      </Reveal>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {asList<LevelItem>(p.items).map((l, i) => (
          <Reveal key={i} delay={i * 80}>
            <div className={`rounded-2xl border-2 p-5 ${LEVEL_TONES[l.tone ?? ''] ?? LEVEL_TONES.green}`}>
              <h4 className="font-bold text-lg mb-1">{t(l.name)}</h4>
              {l.grades && <p className="text-sm opacity-80">{t(l.grades)}</p>}
              {l.age && <p className="text-xs opacity-60 mt-1">{t(l.age)}</p>}
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ── Respaldo ───────────────────────────────────────────────────────────── */
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
          const Icon = cmsIcon(c.icon);
          return (
            <Reveal key={i} delay={i * 90}>
              <div className="card hover-lift flex h-full flex-col gap-[18px]">
                <div className="flex h-[52px] w-[52px] items-center justify-center rounded-[14px]" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
                  <Icon size={26} color={color} />
                </div>
                <h3 className="font-head text-[19px] font-bold text-ink">{t(c.title)}</h3>
                {c.text && <p className="flex-1 text-[15px] leading-relaxed text-muted">{t(c.text)}</p>}
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

const cardItem = [f.icon('icon'), f.color('color'), f.text('title', 'Título', { required: true }), f.textarea('text', 'Texto')];

export const sections = [
  section({
    type: 'mission', label: 'Nosotros · Misión y visión', description: 'Misión y visión con ícono, mosaico de tres fotos e insignia de egresados.',
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
        { icon: 'Target', color: 'var(--purple)', title: 'Misión', text: 'Formar personas íntegras, críticas y comprometidas con su entorno, capaces de afrontar los retos del siglo XXI con confianza y habilidades globales.' },
        { icon: 'Eye', color: 'var(--green)', title: 'Visión', text: 'Ser la comunidad educativa de referencia en la zona, reconocida por la excelencia académica, el bilingüismo y la formación humana de sus egresados.' },
      ],
      image1: '/assets/facade.webp', alt1: 'Fachada del Colegio Interlaken',
      image2: '/assets/classroom.webp', alt2: 'Aula del colegio',
      image3: '/assets/campus-mural.webp', alt3: 'Mural del campus',
      badgeValue: '+2,500', badgeLabel: 'Egresados',
    },
  }),
  section({
    type: 'timeline', label: 'Nosotros · Trayectoria', description: 'Línea de tiempo con los momentos importantes del colegio.',
    component: AboutTimelineView,
    fields: [
      ...headingFields(),
      f.items('items', 'Momentos', [f.text('year', 'Año', { required: true, hint: 'Puede usar {{fundacion}} y {{anio}}.' }), f.text('title', 'Título', { required: true }), f.textarea('text', 'Texto')]),
    ],
    defaults: {
      eyebrow: 'Trayectoria', title: '{{anios}} años formando líderes',
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
    type: 'values', label: 'Nosotros · Valores', description: 'Tarjetas de valores con ícono y color.',
    component: AboutValuesView,
    fields: [...headingFields(), f.items('items', 'Valores', cardItem)],
    defaults: {
      eyebrow: 'Lo que nos define', title: 'Nuestros valores',
      items: [
        { icon: 'Award', color: 'var(--purple)', title: 'Excelencia académica', text: 'Formación rigurosa con enfoque humanista y pensamiento crítico.' },
        { icon: 'Globe2', color: 'var(--green)', title: 'Bilingüismo real', text: 'Inglés intensivo desde el nivel inicial con certificaciones internacionales.' },
        { icon: 'Heart', color: 'var(--pink)', title: 'Formación en valores', text: 'Ciudadanía, empatía y responsabilidad como parte de la vida diaria.' },
        { icon: 'Sparkles', color: 'var(--green)', title: 'Innovación educativa', text: 'Tecnología, ciencia y creatividad integradas al aula.' },
        { icon: 'Users', color: 'var(--purple-mid)', title: 'Comunidad integrada', text: 'Un ambiente cálido e inclusivo donde cada familia pertenece.' },
        { icon: 'Target', color: 'var(--amber)', title: 'Acompañamiento', text: 'Apoyo psicopedagógico personalizado para cada alumno.' },
      ],
    },
  }),
  section({
    type: 'levels', label: 'Nosotros · Niveles educativos', description: 'Recuadros de color con grados y edades de cada nivel.',
    component: AboutLevelsView,
    fields: [
      ...headingFields(),
      f.items('items', 'Niveles', [f.text('name', 'Nivel', { required: true }), f.text('grades', 'Grados'), f.text('age', 'Edades'), f.select('tone', 'Color', LEVEL_TONE_OPTIONS)]),
    ],
    defaults: {
      eyebrow: 'Oferta educativa', title: 'Niveles educativos',
      items: [
        { name: 'Preescolar', grades: '1°–3°', age: '3–6 años', tone: 'green' },
        { name: 'Primaria', grades: '1°–6°', age: '6–12 años', tone: 'brand' },
        { name: 'Secundaria', grades: '1°–3°', age: '12–15 años', tone: 'coral' },
      ],
    },
  }),
  section({
    type: 'credentials', label: 'Nosotros · Respaldo', description: 'Tarjetas con certificaciones y trayectoria del colegio.',
    component: AboutCredentialsView,
    fields: [...headingFields(), f.items('items', 'Tarjetas', cardItem)],
    defaults: {
      eyebrow: 'Nuestro respaldo', title: 'Certificaciones y trayectoria que dan certeza',
      items: [
        { icon: 'Award', color: 'var(--purple)', title: 'Incorporación oficial SEP', text: 'Estudios con reconocimiento y validez oficial ante la Secretaría de Educación Pública.' },
        { icon: 'Globe2', color: 'var(--green)', title: 'Certificaciones de inglés', text: 'Preparamos a los alumnos para exámenes de certificación internacional de inglés.' },
        { icon: 'Users', color: 'var(--pink)', title: 'Más de 2,500 egresados', text: 'Cuatro décadas de comunidad que respaldan nuestra trayectoria en Tlalnepantla.' },
      ],
    },
  }),
  section({
    type: 'cta', label: 'Nosotros · Llamado final', description: 'Franja en degradado con dos botones.',
    component: AboutCtaView,
    fields: [f.text('title', 'Título'), f.textarea('text', 'Texto'), f.link('primary', 'Botón principal'), f.link('secondary', 'Botón secundario')],
    defaults: {
      title: '¿Desea conocernos de cerca?', text: 'Agende una visita o inicie su pre-registro en línea en solo unos minutos.',
      primary: { label: 'Inicie su pre-registro', href: '/pre-registro' }, secondary: { label: 'Agendar visita', href: '/agendar-visita' },
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
