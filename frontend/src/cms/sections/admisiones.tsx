/**
 * Admisiones (/admisiones): designed sections (docs/CMS-COMPLETION-PLAN.md).
 * Testimonials, SEP registrations and the cost estimator stay data-driven
 * (Testimonios, Ajustes, Costos); their headings and every other text,
 * photo, step and question are props.
 */
import { type ElementType, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Award, FileText, CheckCircle, ArrowRight, ArrowUpRight, CalendarDays, ClipboardList, ShieldCheck } from 'lucide-react';
import { useSep } from '@/hooks/useSep';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { waHref } from '@/lib/siteContact';
import { waMessage } from '@/lib/whatsapp';
import { docsSummary, useAdmissionDocs } from '@/lib/admisionesDocs';
import { Testimonials } from '@/components/public/Testimonials';
import { Section } from '@/components/ui/Section';
import { Reveal } from '@/components/ui/Reveal';
import { Blob } from '@/components/ui/Blob';
import { WhatsAppIcon } from '@/components/icons/WhatsAppIcon';
import { CostEstimator } from '@/components/admissions/CostEstimator';
import { trackEvent, ConversionEvent } from '@/services/analytics';
import { iconResolver } from '../iconRuntime';
import { cmsColor, imageSrc, imageSrcSet, isExternal, useCmsImage, useTokens, type CmsLink } from '../runtime';
import { asLink, asList, CmsAnchor, defineModule, f, headingFields, inGroup, lazySection, sectionsOf } from './kit';

/** The icons this module's defaults use; any other curated icon loads on demand. */
const cmsIcon = iconResolver({ CalendarDays, ClipboardList, FileText });

const section = sectionsOf('admisiones');

/* ── Portada ────────────────────────────────────────────────────────────── */
interface HeroProps { label?: string; title?: string; subtitle?: string; image?: number | string }
function AdmHeroView(p: HeroProps) {
  const t = useTokens();
  return (
    <section className="relative overflow-hidden bg-dark text-white">
      {p.image && <img src={imageSrc(p.image)} srcSet={imageSrcSet(p.image, { full: true })} sizes="100vw" alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" loading="eager" />}
      <div className="absolute inset-0 bg-gradient-to-r from-dark/90 via-dark/70 to-dark/45" />
      <Blob tone="green" opacity={0.42} size={480} shape={2} className="hidden sm:block" style={{ top: -160, left: -120 }} />
      <Blob tone="pink" opacity={0.16} size={400} shape={1} className="hidden sm:block" style={{ bottom: -150, right: -110 }} />
      <div className="relative mx-auto w-full max-w-[1120px] px-6 py-14 sm:py-[72px]">
        {p.label && <span className="section-label-pink inline-flex">{t(p.label)}</span>}
        <h1 className="mt-3 font-head text-fluid-4xl font-black leading-[1.08] tracking-tight">
          {t(p.title)}
        </h1>
        {p.subtitle && (
          <p className="mt-4 max-w-[560px] text-base leading-relaxed text-white/60 sm:text-[17px]">
            {t(p.subtitle)}
          </p>
        )}
      </div>
    </section>
  );
}

/* ── Testimonios (BACKLOG P2-15) ────────────────────────────────────────── */
function AdmTestimonialsView(p: { eyebrow?: string; title?: string; limit?: number }) {
  const t = useTokens();
  return (
    <Section bg="white">
      <Testimonials eyebrow={t(p.eyebrow)} title={t(p.title)} limit={typeof p.limit === 'number' && p.limit > 0 ? p.limit : 3} />
    </Section>
  );
}

/* ── Incorporación SEP: señales de confianza (flyer institucional) ──────── */
function AdmSepView(p: { title?: string; text?: string }) {
  const t = useTokens();
  const sepRows = useSep();
  return (
    <Section bg="white" spacing="sm">
      <Reveal>
        <div className="rounded-[20px] border border-ink/10 bg-cream-2/60 px-5 py-5 shadow-card sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-purple/10 text-purple">
                <Award className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-head text-[17px] font-bold text-ink">{t(p.title)}</h2>
                {p.text && <p className="text-xs text-muted">{t(p.text)}</p>}
              </div>
            </div>
            <ul className="grid gap-2.5 text-xs leading-relaxed text-ink/80 sm:grid-cols-3 lg:max-w-[660px]">
              {sepRows.map((r) => (
                <li key={r.level} className="flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-green-dark" aria-hidden="true" />
                  <span>{r.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}

/* ── Proceso de admisión: 4 pasos, cada uno con su CTA directo ──────────── */
interface StepItem { icon?: string; step?: string; key?: string; title?: string; text?: string; color?: string; link?: CmsLink }
interface StepsProps { eyebrow?: string; title?: string; items?: StepItem[]; waLabel?: string; contact?: CmsLink }

/** `WhatsApp` is the WhatsApp mark (not in the shared icon set); anything else comes from cms/icons. */
const stepIcon = (name: unknown): ElementType => (name === 'WhatsApp' ? WhatsAppIcon : cmsIcon(name));
/** admissions_step_cta `step` value: the stored key, else the title as snake_case («Visita guiada» → visita_guiada). */
const stepKey = (s: StepItem) =>
  s.key || (s.title ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, '_');

const STEP_LINK = 'mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-purple transition-colors hover:bg-purple/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40';

/** Like CmsAnchor, with the analytics click handler the step CTAs need. */
function TrackedLink({ href, onClick, children }: { href: string; onClick: () => void; children: ReactNode }) {
  if (isExternal(href)) {
    const newTab = href.startsWith('http');
    return <a href={href} onClick={onClick} className={STEP_LINK} {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{children}</a>;
  }
  return <Link to={href} onClick={onClick} className={STEP_LINK}>{children}</Link>;
}

function AdmStepsView(p: StepsProps) {
  const t = useTokens();
  // WhatsApp number is admin-editable; CTA hidden (fallback to /contacto)
  // when it's empty, per site convention.
  const { whatsapp_number, chrome } = useSiteSettings();
  const steps = asList<StepItem>(p.items);
  const contact = asLink(p.contact);
  return (
    <Section bg="white">
      {(p.eyebrow || p.title) && (
        <Reveal className="mb-10 text-center sm:mb-12">
          {p.eyebrow && <span className="section-label-purple inline-flex">{t(p.eyebrow)}</span>}
          <h2 className="font-head text-fluid-3xl font-extrabold tracking-tight text-ink">{t(p.title)}</h2>
        </Reveal>
      )}

      <div className="relative">
        {/* Connecting line (desktop only) */}
        <div
          aria-hidden="true"
          className="absolute left-[12.5%] right-[12.5%] top-7 hidden h-0.5 opacity-35 lg:block"
          style={{ background: 'var(--grad-bar)' }}
        />
        <ol className="m-0 flex list-none flex-col p-0 lg:grid lg:grid-cols-4 lg:gap-7">
          {steps.map((s, i) => {
            const Icon = stepIcon(s.icon);
            const color = cmsColor(s.color);
            const link = asLink(s.link);
            const key = stepKey(s);
            const last = i === steps.length - 1;
            return (
              <Reveal key={i} as="li" delay={i * 100} direction="up" className="relative flex gap-4 lg:block lg:text-center">
                <div className="contents">
                  {/* Numbered node + vertical connector (phones/tablets) */}
                  <div className="flex flex-col items-center lg:block">
                    <div
                      className="relative z-[1] flex h-[58px] w-[58px] flex-shrink-0 items-center justify-center rounded-full border-[3px] bg-white lg:mx-auto"
                      style={{ borderColor: color, boxShadow: `0 12px 26px -12px color-mix(in srgb, ${color} 53%, transparent)` }}
                    >
                      <Icon className="h-6 w-6" style={{ color }} aria-hidden="true" />
                      {s.step && (
                        <span
                          className="absolute -right-2 -top-2 flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 font-head text-xs font-bold text-white"
                          style={{ background: color }}
                        >
                          {t(s.step)}
                        </span>
                      )}
                    </div>
                    {!last && (
                      <div className="mt-2 w-0.5 flex-1 rounded-full bg-ink/10 lg:hidden" aria-hidden="true" />
                    )}
                  </div>

                  <div className={`min-w-0 pt-2 lg:pt-0 ${!last ? 'pb-9 lg:pb-0' : ''}`}>
                    <h3 className="font-head text-lg font-bold text-ink lg:mt-4">{t(s.title)}</h3>
                    {s.text && (
                      <p className="mt-1.5 max-w-[280px] text-[13.5px] leading-relaxed text-muted lg:mx-auto lg:mt-2 lg:max-w-[240px]">
                        {t(s.text)}
                      </p>
                    )}
                    {link.href?.trim() && link.label ? (
                      <TrackedLink href={link.href.trim()} onClick={() => trackEvent(ConversionEvent.AdmissionsStepCta, { step: key })}>
                        {t(link.label)} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </TrackedLink>
                    ) : whatsapp_number ? (
                      <a
                        href={waHref(whatsapp_number, waMessage(chrome, 'wa_admissions'))}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => {
                          trackEvent(ConversionEvent.AdmissionsStepCta, { step: key });
                          trackEvent(ConversionEvent.WhatsappCta, { context: 'admisiones_informes' });
                        }}
                        className="btn-green mt-3"
                      >
                        <WhatsAppIcon className="h-4 w-4" /> {t(p.waLabel)}
                      </a>
                    ) : contact.href?.trim() ? (
                      <TrackedLink href={contact.href.trim()} onClick={() => trackEvent(ConversionEvent.AdmissionsStepCta, { step: key })}>
                        {t(contact.label)} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </TrackedLink>
                    ) : null}
                  </div>
                </div>
              </Reveal>
            );
          })}
        </ol>
      </div>
    </Section>
  );
}

/* ── Estimador de costos (linkable: /admisiones#estimador) ──────────────── */
function AdmEstimatorView(p: { eyebrow?: string; title?: string; text?: string }) {
  const t = useTokens();
  return (
    <Section bg="cream" id="estimador">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,380px)_1fr] lg:items-start">
        <Reveal>
          {p.eyebrow && <span className="section-label-coral inline-flex">{t(p.eyebrow)}</span>}
          <h2 className="font-head text-fluid-3xl font-extrabold tracking-tight text-ink">
            {t(p.title)}
          </h2>
          {p.text && (
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
              {t(p.text)}
            </p>
          )}
        </Reveal>
        <Reveal delay={100}>
          <CostEstimator />
        </Reveal>
      </div>
    </Section>
  );
}

/* ── Documentos + llamado al pre-registro ───────────────────────────────── */
interface DocsCtaProps {
  docsTitle?: string; docsSummary?: string; docsNote?: string;
  image?: number | string; imageAlt?: string; badge?: string; title?: string; text?: string; primary?: CmsLink; secondary?: CmsLink;
}
function AdmDocsCtaView(p: DocsCtaProps) {
  const t = useTokens();
  // One list for the whole site: the one edited in the Documentación page.
  const docs = useAdmissionDocs();
  const img = useCmsImage(p.image, t(p.imageAlt));
  const primary = asLink(p.primary);
  const secondary = asLink(p.secondary);
  return (
    <Section bg="cream">
      <div className="grid gap-8 md:grid-cols-2">
        {/* Documentos: tarjeta con encabezado, conteo y enlaces oficiales */}
        <Reveal direction="right">
          <div className="flex h-full flex-col overflow-hidden rounded-[20px] border border-ink/10 bg-white shadow-card">
            <div className="flex items-center gap-3 border-b border-ink/10 bg-green/5 px-5 py-4 sm:px-6">
              <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-green/15 text-green-dark">
                <FileText className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h3 className="font-head text-[19px] font-bold text-ink">{t(p.docsTitle)}</h3>
                {p.docsSummary && <p className="text-xs text-muted">{docsSummary(t(p.docsSummary), docs)}</p>}
              </div>
            </div>
            <ul className="flex-1 divide-y divide-ink/5 px-5 sm:px-6">
              {docs.map((d, i) => (
                <li key={i} className="flex items-start gap-3 py-3 text-sm">
                  <CheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" aria-hidden="true" />
                  <span className="text-ink/90">
                    {t(d.label)}
                    {d.href && (
                      <>
                        {' '}
                        <a
                          href={d.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 whitespace-nowrap font-semibold text-green-dark underline decoration-green/40 underline-offset-2 hover:decoration-green"
                        >
                          {t(d.linkLabel)} <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                        </a>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {p.docsNote && (
              <p className="m-5 mt-2 rounded-lg bg-cream px-3.5 py-2.5 text-xs leading-relaxed text-muted sm:mx-6">
                {t(p.docsNote)}
              </p>
            )}
          </div>
        </Reveal>

        {/* CTA con foto del salón: llena el espacio y motiva el pre-registro */}
        <Reveal direction="left">
          <div className="group relative flex h-full min-h-[440px] flex-col justify-end overflow-hidden rounded-[20px] shadow-card">
            {img.src && (
              <img
                src={img.src}
                // Library photos get their variants; the built-in photo keeps today's single file.
                srcSet={typeof p.image === 'number' ? img.srcSet : undefined}
                alt={img.alt}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-dark via-dark/85 to-dark/25" />
            <div className="absolute inset-0 bg-gradient-to-br from-purple/45 via-transparent to-transparent" />
            <div className="relative p-6 text-white sm:p-8">
              {p.badge && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                  {t(p.badge)}
                </span>
              )}
              <h3 className="mt-4 font-head text-fluid-2xl font-extrabold leading-tight tracking-tight">
                {t(p.title)}
              </h3>
              {p.text && (
                <p className="mt-2 max-w-md text-sm leading-relaxed text-white/85">
                  {t(p.text)}
                </p>
              )}
              {(primary.href || secondary.href) && (
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <CmsAnchor link={primary} className="btn-pink flex-1 justify-center">
                    {t(primary.label)} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </CmsAnchor>
                  <CmsAnchor
                    link={{ ...secondary, label: t(secondary.label) }}
                    className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-full border-2 border-white/50 px-5 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  />
                </div>
              )}
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

/* ── Preguntas frecuentes (objection handling) ──────────────────────────── */
// The explorer (search, topic filter, accordion) is the last section of the
// page: it loads from its own chunk (./admisiones.faq) so the first paint of
// /admisiones does not wait for it. Its defaults and fields stay here.
interface FaqItem { cat?: string; q?: string; a?: string }
const faqChunk = () => import('./admisiones.faq');

/* ── Defaults ───────────────────────────────────────────────────────────── */

/** Objection-handling FAQ. `cat` feeds the explorer's topic filter. */
const FAQS: FaqItem[] = [
  { cat: 'Niveles', q: '¿Qué niveles educativos ofrece Colegio Interlaken?', a: 'Ofrecemos preescolar, primaria y secundaria, con un modelo bilingüe (español–inglés) en cada nivel.' },
  { cat: 'Niveles', q: '¿En qué consiste el modelo bilingüe?', a: 'Inglés intensivo desde el nivel inicial, con preparación para certificaciones internacionales de la Universidad de Cambridge en secundaria.' },
  { cat: 'Inscripción', q: '¿Cuánto tarda el pre-registro en línea?', a: 'Menos de 5 minutos. Recibirá confirmación inmediata y un asesor le contactará en un plazo de 2 días hábiles.' },
  { cat: 'Inscripción', q: '¿Cómo es el proceso de admisión?', a: 'Pre-registro en línea, entrega de documentos, examen de valoración y confirmación de lugar. Un asesor le guía en cada paso.' },
  { cat: 'Documentos', q: '¿Qué documentos necesito para inscribir a mi hijo?', a: 'Acta de nacimiento, CURP del alumno y de los tutores, INE del tutor, comprobante de domicilio, boletas del ciclo anterior, entre otros. Consulte la lista completa con enlaces oficiales en la sección de Documentación.' },
  { cat: 'Costos', q: '¿Cómo están estructurados los costos?', a: 'Las colegiaturas se pagan en 11 mensualidades, de agosto a junio. Consulte el desglose por sección en la página de Costos.' },
  { cat: 'Costos', q: '¿Ofrecen becas o descuentos?', a: 'Contamos con apoyos para hermanos y casos especiales. Escríbanos desde la sección de Contacto para conocer las opciones vigentes.' },
  { cat: 'Oficial', q: '¿El colegio cuenta con incorporación oficial ante la SEP?', a: 'Sí. Nuestros planes de estudio tienen reconocimiento y validez oficial ante la Secretaría de Educación Pública.' },
  { cat: 'Privacidad', q: '¿Cómo protege el colegio los datos de mi familia?', a: 'Tratamos sus datos personales conforme a la LFPDPPP. Consulte nuestro Aviso de Privacidad para conocer y ejercer sus derechos ARCO.' },
];

/** Funnel timeline: from any step a parent reaches a human, a visit or the pre-registro in one tap. */
const STEPS: StepItem[] = [
  { icon: 'WhatsApp', step: '01', key: 'informes', title: 'Informes', text: 'Escríbanos por WhatsApp y un asesor de admisiones resuelve sus dudas.', color: 'var(--green)', link: { label: '', href: '' } },
  { icon: 'CalendarDays', step: '02', key: 'visita_guiada', title: 'Visita guiada', text: 'Conozca las instalaciones y al equipo docente en un recorrido personalizado.', color: 'var(--purple)', link: { label: 'Agendar visita', href: '/agendar-visita' } },
  { icon: 'FileText', step: '03', key: 'documentacion', title: 'Documentación', text: 'Consulte la lista de documentos requeridos, con enlaces a trámites oficiales.', color: 'var(--pink)', link: { label: 'Ver documentación', href: '/admisiones/documentacion' } },
  { icon: 'ClipboardList', step: '04', key: 'inscripcion', title: 'Inscripción', text: 'Complete el pre-registro en línea en menos de 5 minutos y asegure su lugar.', color: 'var(--green)', link: { label: 'Iniciar pre-registro', href: '/pre-registro' } },
];

export const sections = [
  section({
    type: 'hero', label: 'Admisiones · Portada', description: 'Foto con velo oscuro, manchas de color, etiqueta, título y texto.',
    component: AdmHeroView,
    fields: [
      f.text('label', 'Etiqueta superior', { hint: '{{ciclo}} muestra el ciclo escolar vigente.' }),
      f.text('title', 'Título', { required: true }),
      f.textarea('subtitle', 'Texto'),
      f.image('image', 'Foto'),
    ],
    defaults: {
      label: 'Ciclo Escolar {{ciclo}} · Inscripciones Abiertas', title: 'Admisiones',
      subtitle: 'Un proceso simple, transparente y completamente en línea. Le acompañamos en cada paso.',
      image: '/assets/primaria-gate.webp',
    },
  }),
  section({
    type: 'testimonials', label: 'Admisiones · Testimonios', description: 'Testimonios publicados en Testimonios (automático; se oculta si no hay). Aquí, la etiqueta, el título y cuántos mostrar.',
    component: AdmTestimonialsView,
    fields: [f.text('eyebrow', 'Etiqueta superior'), f.text('title', 'Título'), f.number('limit', 'Cuántos testimonios mostrar')],
    defaults: { eyebrow: 'Comunidad', title: 'Familias que ya son Interlaken', limit: 3 },
  }),
  section({
    type: 'sep', label: 'Admisiones · Incorporación SEP', description: 'Franja con las claves de incorporación SEP de cada nivel. Las claves se editan en Ajustes.',
    component: AdmSepView,
    fields: [f.text('title', 'Título'), f.text('text', 'Texto', { hint: 'Puede usar {{anios}}.' })],
    defaults: { title: 'Incorporación oficial SEP', text: '{{anios}} años de trayectoria con reconocimiento y validez oficial.' },
  }),
  section({
    type: 'steps', label: 'Admisiones · Proceso de admisión', description: 'Pasos numerados con ícono, color y un botón cada uno.',
    component: AdmStepsView,
    fields: [
      ...headingFields(),
      f.items('items', 'Pasos', [
        f.text('step', 'Número'),
        f.text('title', 'Título', { required: true }),
        f.textarea('text', 'Texto'),
        f.icon('icon', 'Ícono', { hint: 'WhatsApp = logo de WhatsApp.' }),
        f.color('color'),
        f.link('link', 'Botón', { hint: 'Vacío = botón de WhatsApp (o el enlace de contacto si no hay WhatsApp en Ajustes).' }),
      ]),
      f.text('waLabel', 'Texto del botón de WhatsApp'),
      f.link('contact', 'Enlace de contacto (si no hay WhatsApp)'),
    ],
    defaults: {
      eyebrow: 'Cómo funciona', title: 'Proceso de admisión', items: STEPS,
      waLabel: 'WhatsApp', contact: { label: 'Contáctenos', href: '/contacto' },
    },
  }),
  section({
    type: 'estimator', label: 'Admisiones · Estimador de costos', description: 'Calculadora de cuotas por sección y modalidad. Las cifras se editan en Ajustes, Costos; aquí solo el texto de la izquierda.',
    component: AdmEstimatorView,
    fields: [...headingFields({ text: true })],
    defaults: {
      eyebrow: 'Costos {{ciclo}}', title: 'Estime su inversión',
      text: 'Elija la sección y la modalidad para ver las cuotas del ciclo. Las cifras son publicadas por la administración del colegio y el desglose completo está en la página de Costos.',
    },
  }),
  section({
    type: 'docs_cta', label: 'Admisiones · Documentos y pre-registro', description: 'Tarjeta con los documentos requeridos y, a su lado, una foto con el llamado al pre-registro. La lista se edita en la página Documentación.',
    component: AdmDocsCtaView,
    fields: [
      f.text('docsTitle', 'Documentos: título'),
      f.text('docsSummary', 'Documentos: resumen', { hint: '{total} = número de documentos; {online} = cuántos tienen enlace a un trámite en línea.' }),
      f.textarea('docsNote', 'Documentos: nota al pie'),
      f.image('image', 'Foto del llamado'),
      f.text('imageAlt', 'Descripción de la foto (accesibilidad)'),
      f.text('badge', 'Insignia', { hint: 'Puede usar {{ciclo}}.' }),
      f.text('title', 'Título del llamado'),
      f.textarea('text', 'Texto del llamado'),
      f.link('primary', 'Botón principal'),
      f.link('secondary', 'Botón secundario'),
    ],
    defaults: {
      docsTitle: 'Documentos requeridos', docsSummary: '{total} documentos · {online} con trámite oficial en línea',
      docsNote: 'Los enlaces llevan a los portales oficiales del gobierno (gob.mx / INE) para obtener o consultar cada documento en línea.',
      image: '/assets/classroom.webp', imageAlt: 'Salón de clases del Colegio Interlaken',
      badge: 'Inscripciones abiertas · Ciclo {{ciclo}}', title: '¿Listo para comenzar?',
      text: 'El pre-registro toma menos de 5 minutos. Recibirá confirmación inmediata y le contactaremos para coordinar los siguientes pasos.',
      primary: { label: 'Inicie su pre-registro', href: '/pre-registro' },
      secondary: { label: 'Agendar una visita', href: '/agendar-visita' },
    },
  }),
  section({
    type: 'faq', label: 'Admisiones · Preguntas frecuentes', description: 'Buscador y filtro por tema sobre la lista de preguntas; también se publican para Google.',
    component: lazySection(faqChunk, 'AdmFaqView', '60vh'),
    fields: [
      ...headingFields(),
      f.items('items', 'Preguntas', [f.text('cat', 'Tema', { hint: 'Las preguntas con el mismo tema se agrupan en el filtro.' }), f.text('q', 'Pregunta', { required: true }), f.textarea('a', 'Respuesta')]),
      ...inGroup('Buscador y filtro', [
        f.text('search', 'Buscador'), f.text('searchLabel', 'Buscador (lectores de pantalla)'),
        f.text('filterTitle', 'Título del filtro'), f.text('all', 'Filtro «todas»'),
        f.text('count', 'Contador'),
        f.text('empty', 'Sin resultados'), f.link('emptyLink', 'Sin resultados: enlace'), f.text('emptyAfter', 'Sin resultados: final'),
      ]),
    ],
    defaults: {
      eyebrow: 'Preguntas frecuentes', title: 'Resolvemos sus dudas', items: FAQS,
      search: 'Buscar…', searchLabel: 'Buscar en preguntas frecuentes', filterTitle: 'Filtrar por tema', all: 'Todas',
      count: '{n} de {total} preguntas', empty: 'No encontramos preguntas para su búsqueda.',
      emptyLink: { label: 'Contáctenos', href: '/contacto' }, emptyAfter: 'y con gusto le ayudamos.',
    },
  }),
];

export const templates = [{
  slug: 'admisiones', path: '/admisiones', title: 'Admisiones', group: 'admisiones',
  seo: {},
  sections: ['admisiones.hero', 'admisiones.testimonials', 'admisiones.sep', 'admisiones.steps', 'admisiones.estimator', 'admisiones.docs_cta', 'admisiones.faq'],
}];

export default defineModule(sections, templates);
