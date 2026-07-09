import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { FileText, ClipboardList, CheckCircle, ArrowRight, ArrowUpRight, CalendarDays } from 'lucide-react';
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

/** Documentación para el Examen de Valoración. Donde existe un trámite
 *  oficial en línea se enlaza directo para facilitarlo a las familias. */
const DOCS: { label: string; href?: string; linkLabel?: string }[] = [
  { label: 'Acta de nacimiento: 1 original (solo cotejo) y 2 copias actualizadas tamaño carta',
    href: 'https://www.gob.mx/ActaNacimiento/', linkLabel: 'Obtener acta en línea' },
  { label: 'CURP del alumno (2 copias, emitida por RENAPO)',
    href: 'https://www.gob.mx/curp/', linkLabel: 'Consultar CURP' },
  { label: 'CURP de cada padre o tutor (1 copia, RENAPO)',
    href: 'https://www.gob.mx/curp/', linkLabel: 'Consultar CURP' },
  { label: 'INE de cada padre o tutor (1 copia ampliada al 200%)',
    href: 'https://www.ine.mx/credencial/', linkLabel: 'Trámites INE' },
  { label: '1 fotografía reciente tamaño infantil del alumno' },
  { label: 'Comprobante de domicilio vigente (menor a 3 meses, con dirección completa y C.P.)' },
  { label: 'Boleta SEP del grado anterior (1 copia)' },
  { label: 'Boletas internas de español e inglés del grado anterior y actual (1 copia c/u)' },
  { label: 'Certificado de primaria, si ya lo obtuvo (1 copia — ingreso a secundaria)' },
  { label: 'Carta de buena conducta' },
  { label: 'Constancia de no adeudo' },
];

/** Objection-handling FAQ — also emitted as FAQPage structured data below. */
const FAQS = [
  {
    q: '¿Qué niveles educativos ofrece Colegio Interlaken?',
    a: 'Ofrecemos preescolar, primaria y secundaria, con un modelo bilingüe en cada nivel.',
  },
  {
    q: '¿El colegio cuenta con incorporación oficial ante la SEP?',
    a: 'Sí. Nuestros planes de estudio tienen reconocimiento y validez oficial ante la Secretaría de Educación Pública.',
  },
  {
    q: '¿Cuánto tarda el pre-registro en línea?',
    a: 'Menos de 5 minutos. Recibirá confirmación inmediata y un asesor le contactará en un plazo de 2 días hábiles.',
  },
  {
    q: '¿Qué documentos necesito para inscribir a mi hijo?',
    a: 'Acta de nacimiento, CURP del alumno, comprobante de domicilio, boleta o certificado del ciclo anterior e identificación del tutor, entre otros.',
  },
  {
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
          <span className="section-label-pink inline-flex">Ciclo Escolar 2025–2026 · Inscripciones Abiertas</span>
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
          <Reveal direction="right">
            <div className="card h-full">
              <h3 className="mb-4 font-head text-[19px] font-bold text-ink">Documentos requeridos</h3>
              <ul className="space-y-3">
                {DOCS.map((d) => (
                  <li key={d.label} className="flex items-start gap-2.5 text-sm text-muted">
                    <CheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" />
                    <span>
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
              <p className="mt-4 rounded-lg bg-cream px-3.5 py-2.5 text-xs leading-relaxed text-muted">
                Los enlaces llevan a los portales oficiales del gobierno (gob.mx / INE)
                para obtener o consultar cada documento en línea.
              </p>
            </div>
          </Reveal>
          <Reveal direction="left">
            <div className="card flex h-full flex-col justify-between border-brand-200 bg-brand-50">
              <div>
                <h3 className="mb-2 text-xl font-bold text-brand-800">¿Listo para comenzar?</h3>
                <p className="mb-6 text-sm leading-relaxed text-brand-700">
                  El proceso de pre-registro toma menos de 5 minutos. Recibirá confirmación inmediata
                  y nos pondremos en contacto para coordinar los siguientes pasos.
                </p>
              </div>
              <div className="space-y-3">
                <Link to="/pre-registro" className="btn-primary w-full justify-center">
                  Inicie su pre-registro <ArrowRight className="h-4 w-4" />
                </Link>
                <Link to="/puertas-abiertas" className="btn-secondary w-full justify-center">
                  Ver fechas de Puertas Abiertas
                </Link>
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
        <div className="mx-auto max-w-[760px] space-y-3.5">
          {FAQS.map((f, i) => (
            <Reveal key={f.q} delay={i * 60}>
              <details className="card group">
                <summary className="flex cursor-pointer items-center justify-between gap-4 font-head text-[15.5px] font-bold text-ink [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <ArrowRight size={18} className="flex-shrink-0 text-purple transition-transform group-open:rotate-90" />
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted">{f.a}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </Section>
    </div>
  );
}
