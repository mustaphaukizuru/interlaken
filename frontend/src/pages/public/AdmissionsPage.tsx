import { useEffect, useMemo, useState, type ElementType } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Award, FileText, ClipboardList, CheckCircle, ArrowRight, ArrowUpRight, CalendarDays, Search, ShieldCheck, Plus } from 'lucide-react';
import { CURRENT_CYCLE, SCHOOL_YEARS } from '@/lib/siteMeta';
import { SEP_INCORPORATIONS } from '@/lib/sepIncorporations';
import { waLink, WA_MESSAGES } from '@/lib/whatsapp';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { Section } from '@/components/ui/Section';
import { Reveal } from '@/components/ui/Reveal';
import { Blob } from '@/components/ui/Blob';
import { WhatsAppIcon } from '@/components/icons/WhatsAppIcon';
import { CostEstimator } from '@/components/admissions/CostEstimator';
import { trackEvent, FunnelEvent, ConversionEvent } from '@/services/analytics';

/** Funnel timeline: from any step a parent reaches a human, a visit or the
 *  pre-registro in one tap. `key` feeds the admissions_step_cta event. */
const STEPS: {
  icon: ElementType;
  step: string;
  key: string;
  title: string;
  desc: string;
  color: string;
  /** Internal link CTA; the 'Informes' step renders the WhatsApp CTA instead. */
  to?: string;
  ctaLabel?: string;
}[] = [
  {
    icon: WhatsAppIcon,
    step: '01',
    key: 'informes',
    title: 'Informes',
    desc: 'Escríbanos por WhatsApp y un asesor de admisiones resuelve sus dudas.',
    color: 'var(--green)',
  },
  {
    icon: CalendarDays,
    step: '02',
    key: 'visita_guiada',
    title: 'Visita guiada',
    desc: 'Conozca las instalaciones y al equipo docente en un recorrido personalizado.',
    color: 'var(--purple)',
    to: '/agendar-visita',
    ctaLabel: 'Agendar visita',
  },
  {
    icon: FileText,
    step: '03',
    key: 'documentacion',
    title: 'Documentación',
    desc: 'Consulte la lista de documentos requeridos, con enlaces a trámites oficiales.',
    color: 'var(--pink)',
    to: '/admisiones/documentacion',
    ctaLabel: 'Ver documentación',
  },
  {
    icon: ClipboardList,
    step: '04',
    key: 'inscripcion',
    title: 'Inscripción',
    desc: 'Complete el pre-registro en línea en menos de 5 minutos y asegure su lugar.',
    color: 'var(--green)',
    to: '/pre-registro',
    ctaLabel: 'Iniciar pre-registro',
  },
];

// Fuente única con /admisiones/documentacion (enlaces oficiales incluidos).
import { ADMISSION_DOCS as DOCS } from '@/lib/admisionesDocs';

/** Objection-handling FAQ — also emitted as FAQPage structured data below.
 *  `cat` alimenta el filtro por tema del explorador de preguntas. */
const FAQS: { cat: string; q: string; a: string }[] = [
  {
    cat: 'Niveles',
    q: '¿Qué niveles educativos ofrece Colegio Interlaken?',
    a: 'Ofrecemos preescolar, primaria y secundaria, con un modelo bilingüe (español–inglés) en cada nivel.',
  },
  {
    cat: 'Niveles',
    q: '¿En qué consiste el modelo bilingüe?',
    a: 'Inglés intensivo desde el nivel inicial, con preparación para certificaciones internacionales de la Universidad de Cambridge en secundaria.',
  },
  {
    cat: 'Inscripción',
    q: '¿Cuánto tarda el pre-registro en línea?',
    a: 'Menos de 5 minutos. Recibirá confirmación inmediata y un asesor le contactará en un plazo de 2 días hábiles.',
  },
  {
    cat: 'Inscripción',
    q: '¿Cómo es el proceso de admisión?',
    a: 'Pre-registro en línea, entrega de documentos, examen de valoración y confirmación de lugar. Un asesor le guía en cada paso.',
  },
  {
    cat: 'Documentos',
    q: '¿Qué documentos necesito para inscribir a mi hijo?',
    a: 'Acta de nacimiento, CURP del alumno y de los tutores, INE del tutor, comprobante de domicilio, boletas del ciclo anterior, entre otros. Consulte la lista completa con enlaces oficiales en la sección de Documentación.',
  },
  {
    cat: 'Costos',
    q: '¿Cómo están estructurados los costos?',
    a: 'Las colegiaturas se pagan en 11 mensualidades, de agosto a junio. Consulte el desglose por sección en la página de Costos.',
  },
  {
    cat: 'Costos',
    q: '¿Ofrecen becas o descuentos?',
    a: 'Contamos con apoyos para hermanos y casos especiales. Escríbanos desde la sección de Contacto para conocer las opciones vigentes.',
  },
  {
    cat: 'Oficial',
    q: '¿El colegio cuenta con incorporación oficial ante la SEP?',
    a: 'Sí. Nuestros planes de estudio tienen reconocimiento y validez oficial ante la Secretaría de Educación Pública.',
  },
  {
    cat: 'Privacidad',
    q: '¿Cómo protege el colegio los datos de mi familia?',
    a: 'Tratamos sus datos personales conforme a la LFPDPPP. Consulte nuestro Aviso de Privacidad para conocer y ejercer sus derechos ARCO.',
  },
];

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
};

const FAQ_TOPICS = ['Todas', ...Array.from(new Set(FAQS.map((f) => f.cat)))];

/**
 * Explorador de preguntas frecuentes: buscador + filtro por tema (barra
 * lateral) y lista acordeón. Sin dependencias; mobile-first (la barra se
 * apila sobre la lista en teléfonos).
 */
function FaqExplorer() {
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('Todas');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FAQS.filter(
      (f) =>
        (topic === 'Todas' || f.cat === topic) &&
        (!q || f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q)),
    );
  }, [query, topic]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
      {/* Barra lateral */}
      <aside className="self-start lg:sticky lg:top-24">
        <div className="rounded-[20px] border border-ink/10 bg-white p-4 shadow-card sm:p-5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar…"
              aria-label="Buscar en preguntas frecuentes"
              className="input-field min-h-[44px] pl-9 text-base"
            />
          </div>

          <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-subtle">
            Filtrar por tema
          </p>
          <div className="mt-2 flex flex-col gap-1">
            {FAQ_TOPICS.map((t) => {
              const count = t === 'Todas' ? FAQS.length : FAQS.filter((f) => f.cat === t).length;
              const active = topic === t;
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setTopic(t)}
                  className={`flex min-h-[42px] items-center justify-between gap-2 rounded-xl px-3 text-sm font-semibold transition-colors ${
                    active
                      ? 'bg-purple text-white shadow-purple'
                      : 'text-ink/80 hover:bg-purple/[0.07] hover:text-purple'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-white' : 'bg-purple/40'}`}
                      aria-hidden="true"
                    />
                    {t}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                      active ? 'bg-white/20 text-white' : 'bg-purple/10 text-purple'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="mt-5 border-t border-ink/5 pt-3 text-xs uppercase tracking-wide text-subtle">
            {visible.length} de {FAQS.length} preguntas
          </p>
        </div>
      </aside>

      {/* Lista de preguntas */}
      <div className="min-w-0">
        {visible.length === 0 ? (
          <div className="rounded-[20px] border border-ink/10 bg-white p-8 text-center shadow-card">
            <p className="text-sm text-muted">
              No encontramos preguntas para su búsqueda.{' '}
              <Link to="/contacto" className="font-semibold text-green-dark underline">
                Contáctenos
              </Link>{' '}
              y con gusto le ayudamos.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-ink/5 overflow-hidden rounded-[20px] border border-ink/10 bg-white shadow-card">
            {visible.map((f) => (
              <details key={f.q} className="group">
                <summary className="flex cursor-pointer items-start justify-between gap-4 px-5 py-4 transition-colors hover:bg-cream-2/60 sm:px-6 [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0">
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-purple">
                      {f.cat}
                    </span>
                    <span className="mt-0.5 block font-head text-[15.5px] font-bold leading-snug text-ink">
                      {f.q}
                    </span>
                  </span>
                  <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-purple/10 text-purple transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none">
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </span>
                </summary>
                <p className="px-5 pb-4 text-sm leading-relaxed text-muted sm:px-6">{f.a}</p>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdmissionsPage() {
  // WhatsApp number is admin-editable; CTA hidden (fallback to /contacto)
  // when it's empty, per site convention.
  const { whatsapp_number } = useSiteSettings();

  // Admissions funnel entry point (page views also cover this; the explicit
  // event makes the funnel step unambiguous in the analytics tool).
  useEffect(() => {
    trackEvent(FunnelEvent.ViewAdmissions);
  }, []);

  return (
    <div>
      <Helmet>
        <script type="application/ld+json">{JSON.stringify(faqJsonLd)}</script>
      </Helmet>
      {/* ── HERO ── */}
      <section className="relative overflow-hidden bg-dark text-white">
        <img src="/assets/primaria-gate.webp" alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" loading="eager" />
        <div className="absolute inset-0 bg-gradient-to-r from-dark/90 via-dark/70 to-dark/45" />
        <Blob tone="green" opacity={0.42} size={480} shape={2} className="hidden sm:block" style={{ top: -160, left: -120 }} />
        <Blob tone="pink" opacity={0.16} size={400} shape={1} className="hidden sm:block" style={{ bottom: -150, right: -110 }} />
        <div className="relative mx-auto w-full max-w-[1120px] px-6 py-14 sm:py-[72px]">
          <span className="section-label-pink inline-flex">Ciclo Escolar {CURRENT_CYCLE} · Inscripciones Abiertas</span>
          <h1 className="mt-3 font-head text-fluid-4xl font-black leading-[1.08] tracking-tight">
            Admisiones
          </h1>
          <p className="mt-4 max-w-[560px] text-base leading-relaxed text-white/60 sm:text-[17px]">
            Un proceso simple, transparente y completamente en línea. Le acompañamos en cada paso.
          </p>
        </div>
      </section>

      {/* ── INCORPORACIÓN SEP — señales de confianza (flyer institucional) ── */}
      <Section bg="white" spacing="sm">
        <Reveal>
          <div className="rounded-[20px] border border-ink/10 bg-cream-2/60 px-5 py-5 shadow-card sm:px-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-purple/10 text-purple">
                  <Award className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="font-head text-[17px] font-bold text-ink">Incorporación oficial SEP</h2>
                  <p className="text-xs text-muted">
                    {SCHOOL_YEARS} años de trayectoria con reconocimiento y validez oficial.
                  </p>
                </div>
              </div>
              <ul className="grid gap-2.5 text-xs leading-relaxed text-ink/80 sm:grid-cols-3 lg:max-w-[660px]">
                {SEP_INCORPORATIONS.map((r) => (
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

      {/* ── PROCESS TIMELINE — 4 pasos, cada uno con su CTA directo ── */}
      <Section bg="white">
        <Reveal className="mb-10 text-center sm:mb-12">
          <span className="section-label-purple inline-flex">Cómo funciona</span>
          <h2 className="font-head text-fluid-3xl font-extrabold tracking-tight text-ink">Proceso de admisión</h2>
        </Reveal>

        <div className="relative">
          {/* Connecting line (desktop only) */}
          <div
            aria-hidden="true"
            className="absolute left-[12.5%] right-[12.5%] top-7 hidden h-0.5 opacity-35 lg:block"
            style={{ background: 'var(--grad-bar)' }}
          />
          <ol className="m-0 flex list-none flex-col p-0 lg:grid lg:grid-cols-4 lg:gap-7">
            {STEPS.map(({ icon: Icon, step, key, title, desc, color, to, ctaLabel }, i) => (
              <Reveal key={step} delay={i * 100} direction="up">
                <li className="relative flex gap-4 lg:block lg:text-center">
                  {/* Numbered node + vertical connector (phones/tablets) */}
                  <div className="flex flex-col items-center lg:block">
                    <div
                      className="relative z-[1] flex h-[58px] w-[58px] flex-shrink-0 items-center justify-center rounded-full border-[3px] bg-white lg:mx-auto"
                      style={{ borderColor: color, boxShadow: `0 12px 26px -12px color-mix(in srgb, ${color} 53%, transparent)` }}
                    >
                      <Icon className="h-6 w-6" style={{ color }} aria-hidden="true" />
                      <span
                        className="absolute -right-2 -top-2 flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 font-head text-xs font-bold text-white"
                        style={{ background: color }}
                      >
                        {step}
                      </span>
                    </div>
                    {i < STEPS.length - 1 && (
                      <div className="mt-2 w-0.5 flex-1 rounded-full bg-ink/10 lg:hidden" aria-hidden="true" />
                    )}
                  </div>

                  <div className={`min-w-0 pt-2 lg:pt-0 ${i < STEPS.length - 1 ? 'pb-9 lg:pb-0' : ''}`}>
                    <h3 className="font-head text-lg font-bold text-ink lg:mt-4">{title}</h3>
                    <p className="mt-1.5 max-w-[280px] text-[13.5px] leading-relaxed text-muted lg:mx-auto lg:mt-2 lg:max-w-[240px]">
                      {desc}
                    </p>
                    {to && ctaLabel ? (
                      <Link
                        to={to}
                        onClick={() => trackEvent(ConversionEvent.AdmissionsStepCta, { step: key })}
                        className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-purple transition-colors hover:bg-purple/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
                      >
                        {ctaLabel} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    ) : whatsapp_number ? (
                      <a
                        href={waLink(whatsapp_number, WA_MESSAGES.admissionsInfo)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => {
                          trackEvent(ConversionEvent.AdmissionsStepCta, { step: key });
                          trackEvent(ConversionEvent.WhatsappCta, { context: 'admisiones_informes' });
                        }}
                        className="btn-green mt-3"
                      >
                        <WhatsAppIcon className="h-4 w-4" /> WhatsApp
                      </a>
                    ) : (
                      <Link
                        to="/contacto"
                        onClick={() => trackEvent(ConversionEvent.AdmissionsStepCta, { step: key })}
                        className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-purple transition-colors hover:bg-purple/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
                      >
                        Contáctenos <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    )}
                  </div>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </Section>

      {/* ── ESTIMADOR DE COSTOS (linkable: /admisiones#estimador) ── */}
      <Section bg="cream" id="estimador">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,380px)_1fr] lg:items-start">
          <Reveal>
            <span className="section-label-coral inline-flex">Costos {CURRENT_CYCLE}</span>
            <h2 className="font-head text-fluid-3xl font-extrabold tracking-tight text-ink">
              Estime su inversión
            </h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
              Elija la sección y la modalidad para ver las cuotas del ciclo.
              Las cifras son publicadas por la administración del colegio y el
              desglose completo está en la página de Costos.
            </p>
          </Reveal>
          <Reveal delay={100}>
            <CostEstimator />
          </Reveal>
        </div>
      </Section>

      {/* ── DOCUMENTS + CTA ── */}
      <Section bg="cream">
        <div className="grid gap-8 md:grid-cols-2">
          {/* Documentos — tarjeta con encabezado, conteo y enlaces oficiales */}
          <Reveal direction="right">
            <div className="flex h-full flex-col overflow-hidden rounded-[20px] border border-ink/10 bg-white shadow-card">
              <div className="flex items-center gap-3 border-b border-ink/10 bg-green/5 px-5 py-4 sm:px-6">
                <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-green/15 text-green-dark">
                  <FileText className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="font-head text-[19px] font-bold text-ink">Documentos requeridos</h3>
                  <p className="text-xs text-muted">
                    {DOCS.length} documentos · {DOCS.filter((d) => d.href).length} con trámite oficial en línea
                  </p>
                </div>
              </div>
              <ul className="flex-1 divide-y divide-ink/5 px-5 sm:px-6">
                {DOCS.map((d) => (
                  <li key={d.label} className="flex items-start gap-3 py-3 text-sm">
                    <CheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" aria-hidden="true" />
                    <span className="text-ink/90">
                      {d.label}
                      {d.href && (
                        <>
                          {' '}
                          <a
                            href={d.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 whitespace-nowrap font-semibold text-green-dark underline decoration-green/40 underline-offset-2 hover:decoration-green"
                          >
                            {d.linkLabel} <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                          </a>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="m-5 mt-2 rounded-lg bg-cream px-3.5 py-2.5 text-xs leading-relaxed text-muted sm:mx-6">
                Los enlaces llevan a los portales oficiales del gobierno (gob.mx / INE)
                para obtener o consultar cada documento en línea.
              </p>
            </div>
          </Reveal>

          {/* CTA con foto del salón — llena el espacio y motiva el pre-registro */}
          <Reveal direction="left">
            <div className="group relative flex h-full min-h-[440px] flex-col justify-end overflow-hidden rounded-[20px] shadow-card">
              <img
                src="/assets/classroom.webp"
                alt="Salón de clases del Colegio Interlaken"
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-dark via-dark/85 to-dark/25" />
              <div className="absolute inset-0 bg-gradient-to-br from-purple/45 via-transparent to-transparent" />
              <div className="relative p-6 text-white sm:p-8">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                  Inscripciones abiertas · Ciclo {CURRENT_CYCLE}
                </span>
                <h3 className="mt-4 font-head text-fluid-2xl font-extrabold leading-tight tracking-tight">
                  ¿Listo para comenzar?
                </h3>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-white/85">
                  El pre-registro toma menos de 5 minutos. Recibirá confirmación
                  inmediata y le contactaremos para coordinar los siguientes pasos.
                </p>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <Link to="/pre-registro" className="btn-pink flex-1 justify-center">
                    Inicie su pre-registro <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                  <Link
                    to="/puertas-abiertas"
                    className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-full border-2 border-white/50 px-5 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  >
                    Ver Puertas Abiertas
                  </Link>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ── FAQ (objection handling) ── */}
      <Section bg="white">
        <Reveal className="mb-8 text-center sm:mb-10">
          <span className="section-label-green inline-flex">Preguntas frecuentes</span>
          <h2 className="font-head text-fluid-3xl font-extrabold tracking-tight text-ink">Resolvemos sus dudas</h2>
        </Reveal>
        <FaqExplorer />
      </Section>
    </div>
  );
}
