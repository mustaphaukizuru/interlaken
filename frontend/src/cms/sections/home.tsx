/**
 * Inicio (/): designed sections (docs/CMS-COMPLETION-PLAN.md). The hero and
 * the stat band render in this chunk (first paint); everything below the
 * fold comes from ./home.below, loaded lazily.
 */
import { ArrowRight, CalendarDays, GraduationCap, TrendingUp, Users } from 'lucide-react';
import type { Variants } from 'framer-motion';
import { m } from '@/lib/motion';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { Container } from '@/components/ui/Container';
import Logo from '@/components/ui/Logo';
import { HeroVideo } from '@/components/public/HeroVideo';
import { iconResolver } from '../iconRuntime';
import { cmsColor, useCmsImage, useTokens, type CmsLink } from '../runtime';
import { asLink, asList, CmsAnchor, defineModule, f, headingFields, grouped, INFORMES_CTA, lazySection, sectionsOf, VISIT_CTA } from './kit';
import { withMotion } from './motion';

/** The icons this module's defaults use; any other curated icon loads on demand. */
const cmsIcon = iconResolver({ Users, GraduationCap, CalendarDays, TrendingUp });

const below = () => import('./home.below');
const section = sectionsOf('home');

const VIEWPORT = { once: true, margin: '0px 0px -60px 0px' } as const;
// Motion standard (DESIGN.md §3.5): rise ≤ 12px, ≤ 300ms, stagger 60ms, standard ease.
// Reduced motion is honoured by SiteMotionProvider (MotionConfig reducedMotion="user").
const sectionReveal: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.4, 0, 0.2, 1] } },
};
const staggerGroup: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
/* Hero entrance: ONE orchestrated run on first mount (~480ms). Opacity/transform
 * only, and the hero IMAGE is deliberately not animated so the LCP paint is untouched. */
const heroGroup: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const heroItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.4, 0, 0.2, 1] } },
};

/* ── Hero ───────────────────────────────────────────────────────────────── */
interface HeroProps {
  showLogo?: boolean; title?: string; titleAccent?: string; subtitle?: string;
  primary?: CmsLink; secondary?: CmsLink; tertiary?: CmsLink;
  poster?: number | string; posterAlt?: string; video?: string; videoSound?: boolean;
}
function HomeHeroView(p: HeroProps) {
  const t = useTokens();
  const settings = useSiteSettings();
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const poster = useCmsImage(p.poster, t(p.posterAlt), { full: true });
  const primary = asLink(p.primary);
  const secondary = asLink(p.secondary);
  // Optional (2026-11-22, «Colegiaturas»): a page published before it existed,
  // or one that leaves it empty, keeps its two buttons.
  const tertiary = asLink(p.tertiary);
  return (
    <HeroVideo
      className="min-h-[min(92svh,820px)] sm:min-h-[min(88svh,760px)]"
      src={(p.video || settings.hero_video_url || '').trim()}
      poster={poster.src}
      posterSrcSet={poster.srcSet}
      posterAlt={poster.alt}
      reducedMotion={reducedMotion}
      // The hero's own video is a silent loop unless the editor says otherwise; the Ajustes video keeps its sound button.
      sound={p.video?.trim() ? p.videoSound === true : true}
    >
      <div
        className="pointer-events-none absolute -top-32 -left-24 hidden h-[420px] w-[420px] rounded-full sm:block"
        style={{ background: 'radial-gradient(circle, rgba(64,26,142,0.4), transparent 68%)' }}
      />
      {/* pb on phones clears the fixed "Agendar visita" bar, which otherwise
          sits on top of the secondary hero CTA at the fold. */}
      <Container className="relative w-full !pb-28 !pt-28 sm:!pb-16 sm:!pt-32 lg:!pb-[72px]">
        <m.div className="max-w-[640px]" variants={heroGroup} initial="hidden" animate="show">
          {p.showLogo !== false && <Logo variant="horizontal" theme="dark" size={56} eager className="mb-6 sm:mb-7" />}
          <m.h1 variants={heroItem} className="font-head font-black leading-[1.05] tracking-[-0.03em] text-fluid-5xl">
            {t(p.title)}
            {p.titleAccent && (
              <>
                <br />
                <span style={{ background: 'linear-gradient(100deg, var(--pink) 0%, var(--purple-mid) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                  {t(p.titleAccent)}
                </span>
              </>
            )}
          </m.h1>
          {p.subtitle && (
            <m.p variants={heroItem} className="mt-4 max-w-[480px] text-[16px] leading-relaxed text-white/75 sm:text-[17px]">
              {t(p.subtitle)}
            </m.p>
          )}
          <m.div variants={heroItem} className="mt-7 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:flex-wrap sm:gap-3.5">
            <CmsAnchor link={primary} className="btn-pink btn-lg justify-center focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-dark">
              {primary.label} <ArrowRight size={17} />
            </CmsAnchor>
            <CmsAnchor link={secondary} className="btn-ghost btn-lg justify-center focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-dark" />
            {tertiary.label && tertiary.href && (
              <CmsAnchor link={tertiary} className="btn-ghost btn-lg justify-center focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-dark" />
            )}
          </m.div>
        </m.div>
      </Container>
    </HeroVideo>
  );
}

/* ── Cifras ─────────────────────────────────────────────────────────────── */
interface StatItem { value?: string; label?: string; color?: string; icon?: string }
function HomeStatsView({ items }: { items?: StatItem[] }) {
  const t = useTokens();
  return (
    <section className="bg-dark-2 py-10 text-white">
      <Container>
        <m.div className="grid grid-cols-2 gap-5 sm:grid-cols-2 lg:grid-cols-4" variants={staggerGroup} initial="hidden" whileInView="show" viewport={VIEWPORT}>
          {asList<StatItem>(items).map((s, i) => {
            const color = cmsColor(s.color);
            const Icon = cmsIcon(s.icon);
            return (
              <m.div key={i} variants={sectionReveal} className="flex items-center gap-3 sm:gap-4">
                <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-md" style={{ background: `color-mix(in srgb, ${color} 13%, transparent)` }}>
                  <Icon size={24} color={color} />
                </div>
                <div>
                  <div className="font-head text-[32px] font-black leading-none tracking-[-0.03em]" style={{ color }}>{t(s.value)}</div>
                  <div className="mt-[3px] text-[13px] text-white/60">{t(s.label)}</div>
                </div>
              </m.div>
            );
          })}
        </m.div>
      </Container>
    </section>
  );
}

const levelItem = [f.text('name', 'Nombre', { required: true }), f.image('image', 'Foto'), f.color('color'), f.textarea('text', 'Descripción'), f.href('href', 'Enlace'), f.text('linkLabel', 'Texto del enlace', { hint: 'Vacío = «Conocer <nombre>».' })];

// The editor fills the illustration list (f.illustration), so the home chunk does not ship it.
const artField = f.illustration('illustration', 'Ilustración', { hint: 'Sin elegir, se toma la que corresponde al ícono.' });

export const sections = [
  section({
    type: 'hero', label: 'Inicio · Portada', description: 'Portada con video o foto, logo, título y dos botones.',
    component: withMotion(HomeHeroView),
    fields: [
      f.toggle('showLogo', 'Mostrar el logo'),
      f.text('title', 'Título', { required: true }),
      f.text('titleAccent', 'Título (segunda línea, en degradado)'),
      f.textarea('subtitle', 'Subtítulo', { hint: 'Puede usar {{ciclo}} y {{anios}}.' }),
      f.link('primary', 'Botón principal'),
      f.link('secondary', 'Botón secundario'),
      f.link('tertiary', 'Tercer botón', { hint: 'Opcional: vacío = no se muestra.' }),
      f.image('poster', 'Foto de portada', { hint: 'Se ve mientras carga el video, o siempre si no hay video.' }),
      f.text('posterAlt', 'Descripción de la foto (accesibilidad)'),
      f.url('video', 'Video de portada (MP4)', { hint: 'Vacío = el video de Ajustes.' }),
      f.toggle('videoSound', 'El video tiene sonido', { hint: 'Muestra el botón «Activar sonido». Déjelo apagado para un video en bucle sin audio.' }),
    ],
    defaults: {
      showLogo: true, title: 'Formando líderes', titleAccent: 'con excelencia',
      subtitle: 'Educación bilingüe en Tlalnepantla, de preescolar a secundaria — ciclo {{ciclo}}.',
      primary: VISIT_CTA,
      // Same three as the header (school, 2026-11-22).
      secondary: { label: 'Cafetería', href: '/login' },
      tertiary: { label: 'Colegiaturas', href: '/pagos' },
      // Media round 2026-11-22: the court photo animated (slow glide under the canopies, no people added), 10 s silent loop; the poster is its first frame.
      poster: '/assets/hero-home.webp', posterAlt: 'Campus Colegio Interlaken', video: '/assets/video/hero-home.mp4', videoSound: false,
    },
  }),
  section({
    type: 'stats', label: 'Inicio · Cifras', description: 'Banda oscura con cifras, íconos y colores.',
    component: withMotion(HomeStatsView),
    fields: [f.items('items', 'Cifras', [f.text('value', 'Valor', { required: true }), f.text('label', 'Etiqueta', { required: true }), f.icon('icon'), f.color('color')])],
    defaults: { items: [
      { value: '1,200+', label: 'Alumnos', color: 'var(--pink)', icon: 'Users' },
      { value: '80+', label: 'Maestros', color: 'var(--green)', icon: 'GraduationCap' },
      { value: '{{anios}}', label: 'Años', color: 'var(--purple-mid)', icon: 'CalendarDays' },
      { value: '95%', label: 'Aprovechamiento', color: 'var(--green-mid)', icon: 'TrendingUp' },
    ] },
  }),
  section({
    type: 'about', label: 'Inicio · Nuestra comunidad', description: 'Texto con botón y mosaico de tres fotos con insignia.',
    component: lazySection(below, 'HomeAbout'),
    fields: [...headingFields({ text: true }), f.link('cta', 'Botón'), f.image('image1', 'Foto grande'), f.image('image2', 'Foto superior'), f.image('image3', 'Foto inferior'), f.text('badgeValue', 'Insignia: cifra'), f.text('badgeLabel', 'Insignia: texto')],
    defaults: {
      eyebrow: 'Nuestra Comunidad', title: '{{anios}} años formando familias en Tlalnepantla',
      text: 'En Colegio Interlaken combinamos rigor académico, educación bilingüe y un ambiente cálido y seguro. Nuestros egresados destacan por su liderazgo, sus valores y su compromiso con la comunidad.',
      cta: { label: 'Conózcanos', href: '/nosotros' },
      image1: '/assets/classroom.webp', image2: '/assets/campus-mural.webp', image3: '/assets/interlaken-image (1).webp',
      badgeValue: '+2,500', badgeLabel: 'Egresados',
    },
  }),
  section({
    type: 'video', label: 'Inicio · Video institucional', description: 'Video con texto y botones. Se oculta solo si no hay video.',
    component: lazySection(below, 'HomeVideo'),
    fields: [...headingFields({ text: true }), f.url('video', 'Video (YouTube o Vimeo)', { hint: 'Vacío = el video de Ajustes.' }), f.link('primary', 'Botón principal'), f.link('secondary', 'Botón secundario')],
    defaults: {
      eyebrow: 'Conócenos', title: 'Interlaken en video', video: '',
      text: 'Nuestro video institucional. Y si quiere conocer el colegio en persona, agende una visita: le mostramos instalaciones, salones y patios.',
      primary: { label: 'Agendar una visita', href: '/agendar-visita' }, secondary: { label: 'Ver la galería', href: '/galeria' },
    },
  }),
  section({
    type: 'levels', label: 'Inicio · Niveles educativos', description: 'Tarjetas con foto por nivel y botón final.',
    component: lazySection(below, 'HomeLevels'),
    fields: [...headingFields({ text: true }), f.items('items', 'Niveles', levelItem), f.link('cta', 'Botón final')],
    defaults: {
      eyebrow: 'Niveles Educativos', title: 'Un camino de excelencia',
      text: 'De preescolar a secundaria, un mismo campus y un mismo compromiso con cada etapa.',
      items: [
        { name: 'Preescolar', href: '/niveles/preescolar', image: '/assets/hopscotch.webp', color: 'var(--nivel-preescolar)', text: 'Aprendizaje lúdico y desarrollo socioemocional en un entorno seguro y estimulante.', linkLabel: '' },
        { name: 'Primaria', href: '/niveles/primaria', image: '/assets/court-primaria.webp', color: 'var(--nivel-primaria)', text: 'Formación bilingüe sólida con énfasis en pensamiento crítico y valores.', linkLabel: '' },
        { name: 'Secundaria', href: '/niveles/secundaria', image: '/assets/secundaria.webp', color: 'var(--nivel-secundaria)', text: 'Preparación académica de excelencia orientada al liderazgo y la ciudadanía global.', linkLabel: '' },
      ],
      cta: { label: 'Conozca el modelo educativo', href: '/modelo-educativo' },
    },
  }),
  section({
    type: 'programs', label: 'Inicio · Programas', description: 'Círculos con foto, ícono y color.',
    component: lazySection(below, 'HomePrograms'),
    fields: [...headingFields(), f.items('items', 'Programas', [f.text('name', 'Nombre', { required: true }), f.image('image', 'Foto'), f.icon('icon'), f.color('color')]), f.text('footnote', 'Texto final')],
    defaults: {
      eyebrow: 'Nuestros Programas', title: 'Más allá del aula',
      items: [
        { name: 'Inglés', image: '/assets/foto-bilingue.webp', color: 'var(--purple)', icon: 'Languages' },
        { name: 'Deportes', image: '/assets/foto-deportes.webp', color: 'var(--green)', icon: 'Trophy' },
        { name: 'Arte y Música', image: '/assets/foto-arte.webp', color: 'var(--pink)', icon: 'Palette' },
        { name: 'Ciencia y Robótica', image: '/assets/foto-ciencia.webp', color: 'var(--green)', icon: 'FlaskConical' },
      ],
      footnote: 'Programas que complementan la formación académica todos los días.',
    },
  }),
  section({
    type: 'promos', label: 'Inicio · Tarjetas destacadas', description: 'Par de tarjetas de color con ilustración, texto y enlace.',
    component: lazySection(below, 'HomePromos'),
    fields: [f.items('items', 'Tarjetas', [f.text('label', 'Etiqueta'), f.text('title', 'Título', { required: true }), f.textarea('text', 'Texto'), f.link('link', 'Enlace'), artField, f.icon('icon', 'Ícono (sin ilustración)'), f.color('color', 'Color inicial'), f.color('color2', 'Color final')])],
    defaults: { items: [
      { label: 'Modelo Bilingüe', title: 'Inglés desde preescolar, todos los días', text: 'Un programa intensivo con certificaciones internacionales que prepara a nuestros alumnos para un mundo global.', link: { label: 'Conozca el modelo', href: '/modelo-educativo' }, color: 'var(--purple)', color2: 'var(--purple-mid)', icon: 'Languages', illustration: 'bilingue' },
      { label: 'Comunidad y Valores', title: 'Formamos personas íntegras y felices', text: 'Educación en valores, acompañamiento socioemocional y una comunidad cálida donde cada familia pertenece.', link: { label: 'Nuestra comunidad', href: '/nosotros' }, color: 'var(--pink)', color2: 'var(--pink-hot)', icon: 'Heart', illustration: 'comunidad' },
    ] },
  }),
  section({
    type: 'strengths', label: 'Inicio · Por qué Interlaken', description: 'Tarjetas de respaldo con ilustración.',
    component: lazySection(below, 'HomeStrengths'),
    fields: [...headingFields(), f.items('items', 'Tarjetas', [artField, f.icon('icon', 'Ícono (sin ilustración)'), f.color('color'), f.text('title', 'Título', { required: true }), f.textarea('text', 'Texto')])],
    defaults: {
      eyebrow: 'Por qué Interlaken', title: 'Respaldo que da certeza a su familia',
      items: [
        { icon: 'Award', illustration: 'academico', color: 'var(--purple)', title: 'Incorporación oficial SEP', text: 'Planes de estudio con reconocimiento y validez oficial ante la Secretaría de Educación Pública.' },
        { icon: 'Languages', illustration: 'mundo', color: 'var(--green)', title: 'Certificaciones internacionales', text: 'Programa bilingüe intensivo con exámenes de certificación de inglés reconocidos internacionalmente.' },
        { icon: 'Heart', illustration: 'logro', color: 'var(--pink)', title: '{{anios}} años de trayectoria', text: '{{anios}} años formando familias en Tlalnepantla, con más de 2,500 egresados en nuestra comunidad.' },
      ],
    },
  }),
  section({
    type: 'testimonials', label: 'Inicio · Testimonios', description: 'Testimonios publicados en Testimonios (automático; se oculta si no hay). Aquí, la etiqueta, el título y cuántos mostrar.',
    component: lazySection(below, 'HomeTestimonials', '0'),
    fields: [f.text('eyebrow', 'Etiqueta superior'), f.text('title', 'Título'), f.number('limit', 'Cuántos testimonios mostrar')],
    defaults: { eyebrow: 'Comunidad', title: 'Lo que dicen las familias', limit: 3 },
  }),
  section({
    type: 'gallery', label: 'Inicio · Franja de galería', description: 'Mosaico de fotos que lleva a la galería.',
    component: lazySection(below, 'HomeGallery'),
    fields: [...headingFields(), f.images('images', 'Fotos'), f.link('cta', 'Botón')],
    defaults: {
      eyebrow: 'Galería', title: 'Vida en Interlaken',
      images: ['/assets/interlaken-image (1).webp', '/assets/interlaken-image (2).webp', '/assets/interlaken-image (4).webp', '/assets/facade.webp', '/assets/classroom.webp', '/assets/hopscotch.webp', '/assets/court-wide.webp', '/assets/campus-mural.webp'].map((image) => ({ image, caption: '' })),
      cta: { label: 'Ver la galería completa', href: '/galeria' },
    },
  }),
  section({
    type: 'lead', label: 'Inicio · Solicite informes', description: 'Formulario corto (nombre y correo) que llega a Mensajes.',
    component: lazySection(below, 'HomeLead'),
    fields: [
      ...grouped('Textos', [f.text('title', 'Título'), f.textarea('text', 'Texto'), f.text('button', 'Texto del botón'), f.text('success', 'Mensaje al enviar')]),
      ...grouped('Formulario', [f.text('nameLabel', 'Etiqueta del nombre'), f.text('emailLabel', 'Etiqueta del correo'), f.text('sending', 'Botón mientras envía')]),
      ...grouped('Avisos', [f.text('sentToast', 'Aviso emergente al enviar'), f.text('errorToast', 'Aviso si falla (bajo el formulario)')]),
      ...grouped('Aviso de privacidad', [f.textarea('privacyText', 'Texto antes del enlace'), f.text('privacyLink', 'Texto del enlace')]),
      ...grouped('Lo que llega a Mensajes', [f.text('subject', 'Asunto en Mensajes'), f.text('message', 'Mensaje en Mensajes')]),
    ],
    defaults: {
      title: 'Solicite informes', text: 'Déjenos sus datos y un asesor le compartirá costos, fechas y todo lo que necesita saber sobre Interlaken.',
      button: 'Solicitar', success: '¡Solicitud recibida! Le contactaremos pronto.', subject: 'Solicitud de informes',
      nameLabel: 'Nombre completo', emailLabel: 'Correo electrónico', sending: 'Enviando…',
      sentToast: '¡Gracias! Le contactaremos muy pronto.', errorToast: 'No fue posible enviar su solicitud. Intente de nuevo.',
      privacyText: 'Protegemos sus datos conforme a la LFPDPPP y solo los usamos para atender su solicitud. Consulte el',
      privacyLink: 'Aviso de Privacidad',
      message: '{nombre} solicita informes desde la página de inicio.',
    },
  }),
  section({
    type: 'cta', label: 'Inicio · Llamado final', description: 'Franja en degradado con dos botones.',
    component: lazySection(below, 'HomeCta', '20vh'),
    fields: [f.text('title', 'Título'), f.textarea('text', 'Texto'), f.link('primary', 'Botón principal'), f.link('secondary', 'Botón secundario')],
    defaults: {
      title: 'Comience el futuro de su hijo hoy', text: 'Agende una visita para conocer el colegio o escríbanos para recibir informes. Le acompañamos en cada paso de la admisión.',
      primary: VISIT_CTA, secondary: INFORMES_CTA,
    },
  }),
];

export const templates = [{
  slug: 'inicio', path: '/', title: 'Inicio', group: 'home',
  seo: {},
  sections: ['home.hero', 'home.stats', 'home.about', 'home.video', 'home.levels', 'home.programs', 'home.promos', 'home.strengths', 'home.testimonials', 'home.gallery', 'home.lead', 'home.cta'],
}];

export default defineModule(sections, templates);
