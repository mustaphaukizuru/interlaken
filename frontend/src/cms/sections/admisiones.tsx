/**
 * Admisiones (/admisiones): designed sections (docs/CMS-COMPLETION-PLAN.md).
 * Testimonials, SEP registrations and the cost estimator stay data-driven
 * (Testimonios, Ajustes, Costos); their headings and every other text,
 * photo, step and question are props.
 *
 * Media round (owner 2026-11-22): every word stays; the steps are illustrated
 * cards, the SEP strip, the estimator, the documents card and the questions
 * carry a 3D illustration (chosen in the editor, «Ilustración»).
 */
import { lazy, Suspense, type ElementType, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Award, FileText, CheckCircle, ArrowRight, ArrowUpRight, CalendarDays, ClipboardList, ShieldCheck } from 'lucide-react';
import { Illustration, IllustrationPanel, wash } from '@/components/ui/Illustration';
import { isIllustration, type IllustrationName } from '@/lib/illustrations';
import { useSep } from '@/hooks/useSep';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { waHref } from '@/lib/siteContact';
import { waMessage } from '@/lib/whatsapp';
import { cycleLabel, priceCycleStartOf } from '@/lib/siteMeta';
import { usePublicRequiredDocs } from '@/hooks/queries/requiredDocsPublic';
import { docsSummary, levelsLabel, LEVELS } from '@/lib/requiredDocs';
import { Testimonials } from '@/components/public/Testimonials';
import { testimonialsQuery } from '@/components/public/testimonialsQuery';
import { Section } from '@/components/ui/Section';
import { Reveal } from '@/components/ui/Reveal';
import { Blob } from '@/components/ui/Blob';
import { WhatsAppIcon } from '@/components/icons/WhatsAppIcon';
import { ESTIMATOR_COPY, type EstimatorCopy } from '@/components/admissions/estimatorCopy';
import { trackEvent, ConversionEvent } from '@/services/analytics';
import { iconResolver } from '../iconRuntime';
import { cmsColor, imageSrc, imageSrcSet, isExternal, useCmsImage, useTokens, type CmsLink } from '../runtime';
import { asLink, asList, CmsAnchor, defineModule, f, grouped, headingFields, INFORMES_CTA, lazySection, sectionsOf, VISIT_CTA } from './kit';

/** The icons this module's defaults use; any other curated icon loads on demand. */
const cmsIcon = iconResolver({ CalendarDays, ClipboardList, FileText });

const section = sectionsOf('admisiones');

/**
 * The illustration of a section or item: the one chosen in the editor;
 * «none» hides it; nothing chosen (content saved before the field existed)
 * keeps the built-in one.
 */
const artOf = (chosen: unknown, fallback?: IllustrationName): IllustrationName | undefined =>
  chosen === 'none' ? undefined : isIllustration(chosen) ? chosen : fallback;
const artField = (key = 'illustration', label = 'Ilustración') =>
  f.illustration(key, label, { hint: 'Sin elegir, se muestra la de siempre. «Sin ilustración» la oculta.' });

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
      <div className="relative mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-[72px]">
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
  // No skeleton and no empty band: this section sits right under the hero, and
  // a 640 px placeholder collapsing to an empty 96 px band when the school has
  // no quotes moved everything below by 552 px after the first paint (CLS 0.27
  // on phones). The band appears only when there are quotes, like the home one.
  const { data } = useQuery(testimonialsQuery);
  if ((data ?? []).length === 0) return null;
  return (
    // On cream the white quote cards stand out (the strip below is white).
    <Section bg="cream">
      <Testimonials eyebrow={t(p.eyebrow)} title={t(p.title)} limit={typeof p.limit === 'number' && p.limit > 0 ? p.limit : 3} />
    </Section>
  );
}

/* ── Incorporación SEP: señales de confianza (flyer institucional) ──────── */
/** Each level's registration card wears its level colour (--nivel-*). */
const levelColor = (level: string) => {
  const slug = level.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return ['preescolar', 'primaria', 'secundaria'].includes(slug) ? `var(--nivel-${slug})` : 'var(--purple)';
};

function AdmSepView(p: { title?: string; text?: string; illustration?: string }) {
  const t = useTokens();
  const sepRows = useSep();
  const art = artOf(p.illustration, 'academico');
  return (
    <Section bg="white" spacing="sm">
      <Reveal>
        <div className="relative overflow-hidden rounded-md px-5 py-6 sm:px-8 sm:py-8" style={{ background: wash('var(--purple)', 7) }}>
          <span aria-hidden="true" className="absolute -right-16 -top-20 h-56 w-56 rounded-full" style={{ background: wash('var(--purple)', 14), opacity: 0.6 }} />
          {/* Wide screens: title beside the three registrations; narrower: title above them. */}
          <div className="relative grid gap-6 xl:grid-cols-12 xl:items-center xl:gap-8">
            <div className="flex items-center gap-4 xl:col-span-4">
              {art ? (
                <Illustration name={art} size={104} fluid className="w-[76px] shrink-0 sm:w-[104px]" />
              ) : (
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-purple/10 text-purple">
                  <Award className="h-6 w-6" aria-hidden="true" />
                </span>
              )}
              <div>
                <h2 className="font-head text-fluid-xl font-bold leading-tight text-ink">{t(p.title)}</h2>
                {p.text && <p className="mt-1 text-[15px] leading-snug text-muted">{t(p.text)}</p>}
              </div>
            </div>
            <ul className="grid gap-3 lg:grid-cols-3 xl:col-span-8">
              {sepRows.map((r) => {
                const rest = r.label.startsWith(r.level) ? r.label.slice(r.level.length) : null;
                return (
                  <li key={r.level} className="flex items-start gap-3 rounded-md bg-white p-4 shadow-card">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: wash(levelColor(r.level), 22) }}>
                      <ShieldCheck className="h-4 w-4 text-ink/80" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 text-[15px] leading-snug text-ink/80">
                      {rest !== null ? <><strong className="block font-head font-bold text-ink">{r.level}</strong>{rest.trim()}</> : r.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}

/* ── Proceso de admisión: 4 pasos, cada uno con su CTA directo ──────────── */
interface StepItem { icon?: string; illustration?: string; step?: string; key?: string; title?: string; text?: string; color?: string; link?: CmsLink }
interface StepsProps { eyebrow?: string; title?: string; items?: StepItem[]; waLabel?: string; contact?: CmsLink }

/** `WhatsApp` is the WhatsApp mark (not in the shared icon set); anything else comes from cms/icons. */
const stepIcon = (name: unknown): ElementType => (name === 'WhatsApp' ? WhatsAppIcon : cmsIcon(name));
/** admissions_step_cta `step` value: the stored key, else the title as snake_case («Visita guiada» → visita_guiada). */
const stepKey = (s: StepItem) =>
  s.key || (s.title ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, '_');

/** Each step's illustration when none is chosen: by its key, else by its place in the list. */
const STEP_ART: Record<string, IllustrationName> = {
  informes: 'informes', visita_guiada: 'visita', examen: 'examen', examen_de_valoracion: 'examen', inscripcion: 'inscripcion',
};
const STEP_ART_ORDER: IllustrationName[] = ['informes', 'visita', 'examen', 'inscripcion'];

const STEP_LINK = 'inline-flex min-h-[44px] items-center gap-1.5 rounded-sm text-[15px] font-semibold text-purple underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40';

/** Like CmsAnchor, with the analytics click handler the step CTAs need. */
function TrackedLink({ href, onClick, children }: { href: string; onClick: () => void; children: ReactNode }) {
  if (isExternal(href)) {
    const newTab = href.startsWith('http');
    return <a href={href} onClick={onClick} className={STEP_LINK} {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{children}</a>;
  }
  return <Link to={href} onClick={onClick} className={STEP_LINK}>{children}</Link>;
}

/**
 * The four steps as illustrated cards: art on a wash of the step colour with
 * its number, then the title, the text and the step's own button. A row of
 * four from lg up (small arrows between them), two per row on tablets, and
 * art beside the text on phones so the list stays short.
 */
function AdmStepsView(p: StepsProps) {
  const t = useTokens();
  // WhatsApp number is admin-editable; CTA hidden (fallback to /contacto)
  // when it's empty, per site convention.
  const { whatsapp_number, chrome } = useSiteSettings();
  const steps = asList<StepItem>(p.items);
  const contact = asLink(p.contact);
  return (
    <Section bg="cream">
      {(p.eyebrow || p.title) && (
        <Reveal className="mb-10 text-center sm:mb-12">
          {p.eyebrow && <span className="section-label-purple inline-flex">{t(p.eyebrow)}</span>}
          <h2 className="font-head text-fluid-3xl font-extrabold tracking-tight text-ink">{t(p.title)}</h2>
        </Reveal>
      )}

      <ol className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4 lg:gap-6">
        {steps.map((s, i) => {
          const Icon = stepIcon(s.icon);
          const color = cmsColor(s.color);
          const link = asLink(s.link);
          const key = stepKey(s);
          const art = artOf(s.illustration, STEP_ART[key] ?? STEP_ART_ORDER[i]);
          const last = i === steps.length - 1;
          const cta = link.href?.trim() && link.label ? (
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
              className="btn-green"
            >
              <WhatsAppIcon className="h-4 w-4" /> {t(p.waLabel)}
            </a>
          ) : contact.href?.trim() ? (
            <TrackedLink href={contact.href.trim()} onClick={() => trackEvent(ConversionEvent.AdmissionsStepCta, { step: key })}>
              {t(contact.label)} <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </TrackedLink>
          ) : null;
          return (
            <Reveal key={i} as="li" delay={i * 60} direction="up" className="relative flex">
              <div className="flex w-full overflow-hidden rounded-md bg-white shadow-card sm:flex-col">
                <div className="relative flex w-[108px] shrink-0 items-center justify-center py-5 sm:w-auto sm:py-6" style={{ background: wash(color, 12) }}>
                  {art ? (
                    <Illustration name={art} size={136} fluid className="w-[72px] sm:w-[128px]" />
                  ) : (
                    <Icon className="h-8 w-8" style={{ color }} aria-hidden="true" />
                  )}
                  {s.step && (
                    <span
                      className="absolute left-2 top-2 flex h-7 min-w-7 items-center justify-center rounded-full px-2 font-head text-xs font-bold text-white sm:left-4 sm:top-4"
                      style={{ background: color }}
                    >
                      {t(s.step)}
                    </span>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-5">
                  <h3 className="font-head text-lg font-bold leading-snug text-ink">{t(s.title)}</h3>
                  {s.text && <p className="mt-1.5 text-base leading-relaxed text-ink/75">{t(s.text)}</p>}
                  {cta && <div className="mt-auto pt-4">{cta}</div>}
                </div>
              </div>
              {/* The way forward between two cards (desktop row only). */}
              {!last && (
                <span aria-hidden="true" className="absolute -right-7 top-[72px] z-10 hidden h-8 w-8 items-center justify-center rounded-full bg-white text-subtle shadow-card lg:flex">
                  <ArrowRight className="h-4 w-4" />
                </span>
              )}
            </Reveal>
          );
        })}
      </ol>
    </Section>
  );
}

/* ── Estimador de costos (linkable: /admisiones#estimador) ──────────────── */
// Below the fold: the calculator loads on demand; its own loading skeleton holds the place.
const CostEstimator = lazy(() => import('@/components/admissions/CostEstimator'));
const ESTIMATOR_SKELETON = (
  <div aria-busy="true" aria-label="Cargando estimador de costos">
    <div className="skeleton h-[420px] rounded-md" aria-hidden="true" />
  </div>
);

/** Text fields of the estimator, one field group each call (C4). */
const estimatorText = (group: string, pairs: [string, string][]) => grouped(group, pairs.map(([key, label]) => f.text(key, label)));

function AdmEstimatorView({ eyebrow, title, text, illustration, ...copy }: { eyebrow?: string; title?: string; text?: string; illustration?: string } & Partial<EstimatorCopy>) {
  const p = { eyebrow, title, text };
  // «Costos {{ciclo}}»: the cycle of the published prices, as on the Costos page (lib/priceYears).
  const s = useSiteSettings();
  const t = useTokens({ ciclo: cycleLabel(priceCycleStartOf(s.admissions_next_from_month, s.pricing_years)) });
  const art = artOf(illustration, 'costos');
  return (
    <Section bg="white" id="estimador">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,400px)_1fr] lg:items-start lg:gap-12">
        <Reveal>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {p.eyebrow && <span className="section-label-coral inline-flex">{t(p.eyebrow)}</span>}
              <h2 className="font-head text-fluid-3xl font-extrabold tracking-tight text-ink">
                {t(p.title)}
              </h2>
            </div>
            {/* Phones and tablets: the art sits beside the title; desktop: on its panel below the text. */}
            {art && <Illustration name={art} size={96} fluid className="w-[84px] shrink-0 sm:w-[104px] lg:hidden" />}
          </div>
          {p.text && (
            <p className="mt-3 max-w-md text-base leading-relaxed text-muted">
              {t(p.text)}
            </p>
          )}
          {art && <div className="mt-8 hidden lg:block"><IllustrationPanel name={art} tint="var(--coral)" /></div>}
        </Reveal>
        <Reveal delay={100}>
          <Suspense fallback={ESTIMATOR_SKELETON}>
            <CostEstimator copy={copy} />
          </Suspense>
        </Reveal>
      </div>
    </Section>
  );
}

/* ── Documentos + llamado a agendar la visita ──────────────────────────── */
interface DocsCtaProps {
  docsTitle?: string; docsSummary?: string; docsNote?: string; docsLink?: CmsLink; docsOnlyLabel?: string; docsError?: string; docsIllustration?: string;
  image?: number | string; imageAlt?: string; badge?: string; title?: string; text?: string; primary?: CmsLink; secondary?: CmsLink;
}
function AdmDocsCtaView(p: DocsCtaProps) {
  const t = useTokens();
  // One list for the whole site: Admisiones → Documentos requeridos (Fase 4).
  const { data, isError } = usePublicRequiredDocs();
  const docs = data?.results ?? [];
  const docsLink = asLink(p.docsLink);
  const img = useCmsImage(p.image, t(p.imageAlt));
  const primary = asLink(p.primary);
  const secondary = asLink(p.secondary);
  const docsArt = artOf(p.docsIllustration, 'documentos');
  return (
    <Section bg="cream">
      <div className="grid gap-6 md:grid-cols-2 lg:gap-8">
        {/* Documentos: tarjeta con encabezado, conteo y enlaces oficiales */}
        <Reveal direction="right">
          <div className="flex h-full flex-col overflow-hidden rounded-md bg-white shadow-card">
            <div className="flex items-center gap-4 px-5 py-4 sm:px-6" style={{ background: wash('var(--green)', 10) }}>
              {docsArt ? (
                <Illustration name={docsArt} size={80} fluid className="w-[64px] shrink-0 sm:w-[80px]" />
              ) : (
                <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md bg-green/15 text-green-dark">
                  <FileText className="h-5 w-5" aria-hidden="true" />
                </span>
              )}
              <div className="min-w-0">
                <h3 className="font-head text-fluid-xl font-bold text-ink">{t(p.docsTitle)}</h3>
                {p.docsSummary && data && <p className="mt-0.5 text-sm text-muted">{docsSummary(t(p.docsSummary), docs)}</p>}
              </div>
            </div>
            {isError && !data ? (
              <p className="flex-1 px-5 py-6 text-base text-muted sm:px-6" role="alert">
                {t(p.docsError)}{' '}
                <CmsAnchor link={docsLink} className="font-semibold text-green-dark underline">{t(docsLink.label)}</CmsAnchor>
              </p>
            ) : !data ? (
              <ul className="flex-1 divide-y divide-ink/5 px-5 sm:px-6" aria-hidden="true">
                {Array.from({ length: 10 }).map((_, i) => (
                  <li key={i} className="flex items-start gap-3 py-3">
                    <span className="skeleton mt-0.5 h-4 w-4 shrink-0 rounded-full" />
                    <span className="skeleton h-4 rounded-sm" style={{ width: `${50 + ((i * 17) % 40)}%` }} />
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="flex-1 divide-y divide-ink/5 px-5 sm:px-6">
                {docs.map((d) => (
                  <li key={d.key} className="flex items-start gap-3 py-3 text-[15px] leading-snug">
                    <CheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" aria-hidden="true" />
                    <span className="text-ink/90">
                      {d.name}
                      {d.levels.length < LEVELS.length && (
                        <span className="ml-1.5 whitespace-nowrap text-[13px] font-semibold text-muted">
                          ({t(p.docsOnlyLabel)} {levelsLabel(d.levels)})
                        </span>
                      )}
                      {d.link_url && (
                        <>
                          {' '}
                          <a
                            href={d.link_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 whitespace-nowrap font-semibold text-green-dark underline decoration-green/40 underline-offset-2 hover:decoration-green"
                          >
                            {d.link_label} <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                          </a>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {docsLink.href && data && (
              <p className="px-5 pt-1 sm:px-6">
                <CmsAnchor link={docsLink} className="inline-flex min-h-[44px] items-center gap-1 text-[15px] font-semibold text-green-dark underline decoration-green/40 underline-offset-2 hover:decoration-green">
                  {t(docsLink.label)} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </CmsAnchor>
              </p>
            )}
            {p.docsNote && (
              <p className="m-5 mt-2 rounded-sm bg-cream px-3.5 py-2.5 text-sm leading-relaxed text-muted sm:mx-6">
                {t(p.docsNote)}
              </p>
            )}
          </div>
        </Reveal>

        {/* CTA con foto del salón: llena el espacio e invita a la visita (la ficha la envía el colegio) */}
        <Reveal direction="left">
          <div className="group relative flex h-full min-h-[440px] flex-col justify-end overflow-hidden rounded-md shadow-card">
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
            {/* Lighter at the top so the school's photo reads; dark where the text sits. */}
            <div className="absolute inset-0 bg-gradient-to-t from-dark from-15% via-dark/75 via-50% to-dark/10" />
            <div className="absolute inset-0 bg-gradient-to-br from-purple/30 via-transparent to-transparent" />
            <div className="relative p-6 text-white sm:p-8">
              {p.badge && (
                <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-white/85">
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  {t(p.badge)}
                </p>
              )}
              <h3 className="mt-4 font-head text-fluid-2xl font-extrabold leading-tight tracking-tight">
                {t(p.title)}
              </h3>
              {p.text && (
                <p className="mt-2 max-w-md text-base leading-relaxed text-white/85">
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
                    className="btn-ghost flex-1 justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
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
  { cat: 'Inscripción', q: '¿Cuándo se llena la ficha de inscripción?', a: 'Cuando su hijo/a es admitido después del examen de valoración, el colegio le envía por correo o WhatsApp un enlace personal a su ficha de inscripción. Se llena en línea en unos 15 minutos y puede guardarla y continuar después.' },
  { cat: 'Inscripción', q: '¿Cómo es el proceso de admisión?', a: 'Informes, visita guiada y examen de valoración. Si su hijo/a es admitido, le enviamos su ficha de inscripción, entrega los documentos y confirma su lugar. Un asesor le guía en cada paso.' },
  { cat: 'Documentos', q: '¿Qué documentos necesito para inscribir a mi hijo?', a: 'Acta de nacimiento, CURP del alumno y de los tutores, INE del tutor, comprobante de domicilio, boletas del ciclo anterior, entre otros. Consulte la lista completa con enlaces oficiales en la sección de Documentación.' },
  { cat: 'Costos', q: '¿Cómo están estructurados los costos?', a: 'Las colegiaturas se pagan en 11 mensualidades, de agosto a junio. Consulte el desglose por sección en la página de Costos.' },
  { cat: 'Costos', q: '¿Ofrecen becas o descuentos?', a: 'Contamos con apoyos para hermanos y casos especiales. Escríbanos desde la sección de Contacto para conocer las opciones vigentes.' },
  { cat: 'Oficial', q: '¿El colegio cuenta con incorporación oficial ante la SEP?', a: 'Sí. Nuestros planes de estudio tienen reconocimiento y validez oficial ante la Secretaría de Educación Pública.' },
  { cat: 'Privacidad', q: '¿Cómo protege el colegio los datos de mi familia?', a: 'Tratamos sus datos personales conforme a la LFPDPPP. Consulte nuestro Aviso de Privacidad para conocer y ejercer sus derechos ARCO.' },
];

/**
 * Funnel timeline: from any step a parent reaches a human or a visit in one
 * tap. The ficha de inscripción is private (the school sends it after the
 * exam), so no step links to it.
 */
const STEPS: StepItem[] = [
  { icon: 'WhatsApp', illustration: 'informes', step: '01', key: 'informes', title: 'Informes', text: 'Escríbanos por WhatsApp y un asesor de admisiones resuelve sus dudas.', color: 'var(--green)', link: { label: '', href: '' } },
  { icon: 'CalendarDays', illustration: 'visita', step: '02', key: 'visita_guiada', title: 'Visita guiada', text: 'Conozca las instalaciones y al equipo docente en un recorrido personalizado.', color: 'var(--purple)', link: { label: 'Agendar visita', href: '/agendar-visita' } },
  { icon: 'FileText', illustration: 'examen', step: '03', key: 'examen', title: 'Examen de valoración', text: 'Después de la visita agendamos el examen de valoración de su hijo/a. Consulte los documentos que se piden.', color: 'var(--pink)', link: { label: 'Ver documentación', href: '/admisiones/documentacion' } },
  { icon: 'ClipboardList', illustration: 'inscripcion', step: '04', key: 'inscripcion', title: 'Inscripción', text: 'Si su hijo/a es admitido, le enviamos por correo o WhatsApp su ficha de inscripción personal para llenarla en línea y asegurar su lugar.', color: 'var(--green)', link: { label: 'Ver costos', href: '/admisiones/costos' } },
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
    type: 'sep', label: 'Admisiones · Incorporación SEP', description: 'Franja con una ilustración y las claves de incorporación SEP de cada nivel. Las claves se editan en Ajustes.',
    component: AdmSepView,
    fields: [f.text('title', 'Título'), f.text('text', 'Texto', { hint: 'Puede usar {{anios}}.' }), artField()],
    defaults: { title: 'Incorporación oficial SEP', text: '{{anios}} años de trayectoria con reconocimiento y validez oficial.', illustration: 'academico' },
  }),
  section({
    type: 'steps', label: 'Admisiones · Proceso de admisión', description: 'Pasos numerados en tarjetas con ilustración, color y un botón cada uno.',
    component: AdmStepsView,
    fields: [
      ...headingFields(),
      f.items('items', 'Pasos', [
        f.text('step', 'Número'),
        f.text('title', 'Título', { required: true }),
        f.textarea('text', 'Texto'),
        artField(),
        f.icon('icon', 'Ícono', { hint: 'Se muestra si el paso no tiene ilustración. WhatsApp = logo de WhatsApp.' }),
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
    type: 'estimator', label: 'Admisiones · Estimador de costos', description: 'Calculadora de cuotas por sección y modalidad. Las cifras salen de «Costos y precios» y el cálculo es automático; aquí, el texto de la izquierda y las etiquetas de la calculadora.',
    component: AdmEstimatorView,
    fields: [
      f.action('editPrices', 'Editar precios', '/admin/costos', { hint: 'Las cifras del estimador son las de «Costos y precios» (las mismas de la página de Costos).' }),
      ...headingFields({ text: true }),
      artField(),
      ...estimatorText('Tarjeta', [['cardEyebrow', 'Calculadora: etiqueta'], ['cardTitle', 'Calculadora: título']]),
      f.text('sectionLabel', 'Título de los niveles', { group: 'Selectores' }),
      f.items('sections', 'Niveles', [f.text('label', 'Nivel', { required: true })], { group: 'Selectores', hint: 'Cada botón muestra las filas de precios cuyo nombre contiene ese texto (Primaria = «Primaria»).' }),
      ...estimatorText('Selectores', [['startSection', 'Nivel elegido al abrir'], ['modalityLabel', 'Título de la modalidad'], ['newTag', 'Botón de nuevo ingreso'], ['returningTag', 'Botón de reinscripción']]),
      ...estimatorText('Resultados', [
        ['adminLabel', 'Renglón de gastos administrativos'], ['adminSub', 'Nota de gastos administrativos'],
        ['newFeeLabel', 'Renglón de la cuota (nuevo ingreso)'], ['returningFeeLabel', 'Renglón de la cuota (reinscripción)'], ['feeSub', 'Nota de la cuota'],
        ['tuitionLabel', 'Renglón de la colegiatura'], ['tuitionMissing', 'Colegiatura sin precio'], ['perMonth', 'Texto después de la colegiatura'],
        ['insuranceLabel', 'Renglón de seguros'], ['insuranceSub', 'Nota de seguros'], ['noCost', 'Texto cuando no hay cuota'],
      ]),
      f.items('notes', 'Notas', [f.textarea('text', 'Nota', { required: true }), f.select('tone', 'Color del ícono', [{ value: 'purple', label: 'Morado' }, { value: 'amber', label: 'Ámbar (aviso)' }])], { group: 'Notas y botones' }),
      ...estimatorText('Notas y botones', [['waLabel', 'Botón de WhatsApp'], ['allLabel', 'Enlace a Costos: texto']]),
      f.href('allHref', 'Enlace a Costos: destino', { group: 'Notas y botones' }),
      ...estimatorText('Si no cargan los precios', [['errorTitle', 'Si no cargan los precios: título'], ['errorText', 'Si no cargan los precios: texto']]),
    ],
    defaults: {
      eyebrow: 'Costos {{ciclo}}', title: 'Estime su inversión', illustration: 'costos',
      text: 'Elija la sección y la modalidad para ver las cuotas del ciclo. Las cifras son publicadas por la administración del colegio y el desglose completo está en la página de Costos.',
      ...ESTIMATOR_COPY,
    },
  }),
  section({
    type: 'docs_cta', label: 'Admisiones · Documentos y visita', description: 'Tarjeta con los documentos requeridos y, a su lado, una foto con el llamado a agendar una visita. La lista se edita en Admisiones → Documentos requeridos.',
    component: AdmDocsCtaView,
    fields: [
      ...grouped('Documentos requeridos', [
        f.text('docsTitle', 'Documentos: título'),
        f.text('docsSummary', 'Documentos: resumen', { hint: '{total} = documentos de la lista; {online} = cuántos tienen enlace a un trámite en línea.' }),
        f.text('docsOnlyLabel', 'Documentos: palabra antes de los niveles («Solo»)', { hint: 'Se muestra en los documentos que no piden todos los niveles.' }),
        f.textarea('docsNote', 'Documentos: nota al pie'),
        f.link('docsLink', 'Documentos: enlace a la lista por nivel'),
        f.text('docsError', 'Documentos: si no carga la lista'),
        artField('docsIllustration', 'Documentos: ilustración'),
        f.action('editList', 'Editar la lista de documentos', '/admin/admisiones/documentos', { hint: 'Los documentos y sus niveles se editan en «Documentos requeridos».' }),
      ]),
      ...grouped('Llamado a agendar visita', [
        f.image('image', 'Foto del llamado'),
        f.text('imageAlt', 'Descripción de la foto (accesibilidad)'),
        f.text('badge', 'Insignia'),
        f.text('title', 'Título del llamado'),
        f.textarea('text', 'Texto del llamado'),
        f.link('primary', 'Botón principal'),
        f.link('secondary', 'Botón secundario'),
      ]),
    ],
    defaults: {
      docsTitle: 'Documentos requeridos', docsSummary: '{total} documentos · {online} con trámite oficial en línea',
      docsNote: 'Los enlaces llevan a los portales oficiales del gobierno (gob.mx / INE) para obtener o consultar cada documento en línea.',
      docsOnlyLabel: 'Solo', docsLink: { label: 'Ver los documentos por nivel', href: '/admisiones/documentacion' },
      docsError: 'No se pudo cargar la lista de documentos.', docsIllustration: 'documentos',
      image: '/assets/classroom.webp', imageAlt: 'Salón de clases del Colegio Interlaken',
      badge: 'Inscripciones abiertas · Ciclo {{ciclo}}', title: '¿Listo para comenzar?',
      text: 'El primer paso es conocernos: agende una visita guiada o escríbanos para recibir informes. Después del examen de valoración, si su hijo/a es admitido, le enviamos su ficha de inscripción.',
      primary: VISIT_CTA,
      secondary: INFORMES_CTA,
    },
  }),
  section({
    type: 'faq', label: 'Admisiones · Preguntas frecuentes', description: 'Buscador y filtro por tema sobre la lista de preguntas; también se publican para Google.',
    component: lazySection(faqChunk, 'AdmFaqView', '60vh'),
    fields: [
      ...headingFields(),
      artField('illustration', 'Ilustración junto al filtro'),
      f.items('items', 'Preguntas', [f.text('cat', 'Tema', { hint: 'Las preguntas con el mismo tema se agrupan en el filtro.' }), f.text('q', 'Pregunta', { required: true }), f.textarea('a', 'Respuesta')]),
      ...grouped('Buscador y filtro', [
        f.text('search', 'Buscador'), f.text('searchLabel', 'Buscador (lectores de pantalla)'),
        f.text('filterTitle', 'Título del filtro'), f.text('all', 'Filtro «todas»'),
        f.text('count', 'Contador'),
        f.text('empty', 'Sin resultados'), f.link('emptyLink', 'Sin resultados: enlace'), f.text('emptyAfter', 'Sin resultados: final'),
      ]),
    ],
    defaults: {
      eyebrow: 'Preguntas frecuentes', title: 'Resolvemos sus dudas', illustration: 'ideas', items: FAQS,
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
