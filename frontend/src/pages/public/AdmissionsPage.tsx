import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { FileText, ClipboardList, CheckCircle, ArrowRight, ArrowUpRight, CalendarDays, Search, Plus } from 'lucide-react';
import { CURRENT_CYCLE } from '@/lib/siteMeta';
import { Section } from '@/components/ui/Section';
import { Reveal } from '@/components/ui/Reveal';
import { Blob } from '@/components/ui/Blob';
import { trackEvent, FunnelEvent } from '@/services/analytics';

const STEPS = [
  {
    icon: FileText,
    step: '01',
    title: 'Pre-Registro',
    desc: 'Complete el formulario de pre-registro en línea. Recibirá confirmación inmediata por correo.',
    color: 'var(--purple)',
  },
  {
    icon: CalendarDays,
    step: '02',
    title: 'Puertas Abiertas',
    desc: 'Asista a nuestro día de puertas abiertas para conocer las instalaciones y al equipo docente.',
    color: 'var(--green)',
  },
  {
    icon: ClipboardList,
    step: '03',
    title: 'Inscripción formal',
    desc: 'Presente los documentos requeridos y complete el proceso de inscripción con el personal administrativo.',
    color: 'var(--pink)',
  },
  {
    icon: CheckCircle,
    step: '04',
    title: '¡Bienvenido!',
    desc: 'Recibirá su kit de bienvenida, credencial escolar y acceso al portal de padres.',
    color: 'var(--green)',
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
          <div className="mt-2 flex flex-wrap gap-2">
            {FAQ_TOPICS.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={topic === t}
                onClick={() => setTopic(t)}
                className={`min-h-[36px] rounded-full px-3.5 text-sm font-semibold transition-colors ${
                  topic === t
                    ? 'bg-purple text-white'
                    : 'bg-purple/[0.07] text-purple hover:bg-purple/15'
                }`}
              >
                {t}
              </button>
            ))}
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

      {/* ── PROCESS TIMELINE ── */}
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
          <ol className="m-0 grid list-none grid-cols-1 gap-7 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ icon: Icon, step, title, desc, color }, i) => (
              <Reveal key={step} delay={i * 100} direction="up">
                <li className="relative text-center">
                  {/* Numbered node */}
                  <div
                    className="relative z-[1] mx-auto flex h-[58px] w-[58px] items-center justify-center rounded-full border-[3px] bg-white"
                    style={{ borderColor: color, boxShadow: `0 12px 26px -12px color-mix(in srgb, ${color} 53%, transparent)` }}
                  >
                    <Icon size={24} color={color} />
                    <span
                      className="absolute -right-2 -top-2 flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 font-head text-xs font-bold text-white"
                      style={{ background: color }}
                    >
                      {step}
                    </span>
                  </div>
                  <h3 className="mt-4 font-head text-lg font-bold text-ink">{title}</h3>
                  <p className="mx-auto mt-2 max-w-[240px] text-[13.5px] leading-relaxed text-muted">{desc}</p>
                </li>
              </Reveal>
            ))}
          </ol>
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
