/**
 * Modelo educativo (/modelo-educativo): designed sections
 * (docs/CMS-COMPLETION-PLAN.md). The original markup of ModeloEducativoPage
 * with its copy, photo, pillars and level links as props.
 */
import { ArrowRight, BookOpenCheck, Globe2, type LucideIcon } from 'lucide-react';
import { Reveal } from '@/components/ui/Reveal';
import { cmsIcon } from '../icons';
import { imageSrc, imageSrcSet, useTokens, type CmsLink } from '../runtime';
import { asList, CmsAnchor, defineModule, f, Lines, sectionsOf } from './kit';

const section = sectionsOf('modelo');

// Icons this page used that the curated CMS set does not include yet.
const EXTRA_ICONS: Record<string, LucideIcon> = { BookOpenCheck, Globe2 };
const iconOf = (name: unknown): LucideIcon => (typeof name === 'string' && EXTRA_ICONS[name]) || cmsIcon(name);

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
interface Pillar { icon?: string; title?: string; text?: string }
interface PillarsProps { items?: Pillar[]; ctaTitle?: string; links?: CmsLink[] }
function ModeloPillarsView(p: PillarsProps) {
  const t = useTokens();
  const links = asList<CmsLink>(p.links).filter((l) => l?.href);
  return (
    <section className="bg-white py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {asList<Pillar>(p.items).map((it, i) => {
            const Icon = iconOf(it.icon);
            return (
              <Reveal key={i}>
                <div className="h-full rounded-xl2 border border-ink/10 bg-cream-2 p-6">
                  <Icon size={22} className="text-green-dark" aria-hidden="true" />
                  <h2 className="mt-3 font-head text-lg font-bold text-ink">{t(it.title)}</h2>
                  {it.text && <p className="mt-2 text-sm leading-relaxed text-muted">{t(it.text)}</p>}
                </div>
              </Reveal>
            );
          })}
        </div>

        {(p.ctaTitle || links.length > 0) && (
          <div className="mt-12 rounded-xl2 bg-dark p-8 text-center text-white sm:p-10">
            {p.ctaTitle && (
              <h2 className="font-head text-fluid-xl font-bold">
                {t(p.ctaTitle)}
              </h2>
            )}
            {links.length > 0 && (
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                {links.map((l, i) => (
                  <CmsAnchor key={i} link={l} className="btn-ghost capitalize">
                    {t(l.label)} <ArrowRight size={15} aria-hidden="true" />
                  </CmsAnchor>
                ))}
              </div>
            )}
          </div>
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
    type: 'pillars', label: 'Modelo educativo · Pilares', description: 'Tarjetas con los pilares del modelo y recuadro oscuro con enlaces a cada nivel.',
    component: ModeloPillarsView,
    fields: [
      f.items('items', 'Pilares', [f.icon('icon'), f.text('title', 'Título', { required: true }), f.textarea('text', 'Texto')]),
      f.text('ctaTitle', 'Título del recuadro final', { hint: 'Vacío y sin enlaces = sin recuadro.' }),
      f.items('links', 'Enlaces del recuadro', [f.text('label', 'Texto', { required: true }), f.text('href', 'Enlace', { required: true })]),
    ],
    defaults: {
      items: [
        { icon: 'Globe2', title: 'Educación bilingüe', text: 'Español–Inglés en los tres niveles, con preparación para el First Certificate de la Universidad de Cambridge en Secundaria.' },
        { icon: 'BookOpenCheck', title: 'Alto nivel académico', text: 'Planes y Programas de la SEP enriquecidos con horas clase adicionales, Proyecto de Activación a la Inteligencia y Taller de Lectura y Redacción.' },
        { icon: 'HeartHandshake', title: 'Educación en Valores', text: 'Formamos mejores seres humanos: valores en el quehacer diario, ayuda y servicio a la comunidad, ceremonias y convivencia.' },
        { icon: 'Laptop', title: 'Tecnología en el aula', text: 'iPad integrado al salón de clases (de 4º de Primaria en adelante) y Educación Tecnológica con certificación en Word, Excel y PowerPoint.' },
        { icon: 'Leaf', title: 'Cultura Ecológica', text: 'Conciencia ambiental transversal en actividades, campañas y proyectos escolares.' },
        { icon: 'Trophy', title: 'Actividades que complementan', text: 'Visitas, concursos, exposiciones, festivales, ExpoInterlaken · Maratón de Conocimientos y actividades extraescolares deportivas y culturales.' },
      ],
      ctaTitle: 'Conózcalo en acción, nivel por nivel',
      links: [
        { label: 'preescolar', href: '/niveles/preescolar' },
        { label: 'primaria', href: '/niveles/primaria' },
        { label: 'secundaria', href: '/niveles/secundaria' },
      ],
    },
  }),
];

export const templates = [{
  slug: 'modelo-educativo', path: '/modelo-educativo', title: 'Modelo educativo', group: 'modelo',
  seo: {
    title: 'Modelo Educativo',
    description: 'El modelo del Colegio Interlaken: educación bilingüe, alto nivel académico, valores, tecnología en el aula y cultura ecológica, de Preescolar a Secundaria.',
  },
  sections: ['modelo.hero', 'modelo.pillars'],
}];

export default defineModule(sections, templates);
