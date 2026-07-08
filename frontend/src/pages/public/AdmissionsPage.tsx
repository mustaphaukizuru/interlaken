import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FileText, ClipboardList, CheckCircle, ArrowRight, CalendarDays } from 'lucide-react';
import { Section } from '@/components/ui/Section';
import { Reveal } from '@/components/ui/Reveal';
import { Blob } from '@/components/ui/Blob';
import { trackEvent, FunnelEvent } from '@/services/analytics';

const STEPS = [
  {
    icon: FileText,
    step: '01',
    title: 'Pre-Registro',
    desc: 'Completa el formulario de pre-registro en línea. Recibirás confirmación inmediata por correo.',
    color: '#401a8e',
  },
  {
    icon: CalendarDays,
    step: '02',
    title: 'Puertas Abiertas',
    desc: 'Asiste a nuestro día de puertas abiertas para conocer las instalaciones y al equipo docente.',
    color: '#47a028',
  },
  {
    icon: ClipboardList,
    step: '03',
    title: 'Inscripción formal',
    desc: 'Presenta los documentos requeridos y completa el proceso de inscripción con el personal administrativo.',
    color: '#ef2558',
  },
  {
    icon: CheckCircle,
    step: '04',
    title: '¡Bienvenido!',
    desc: 'Recibirás tu kit de bienvenida, credencial escolar y acceso al portal de padres.',
    color: '#48a018',
  },
];

const DOCS = [
  'Acta de nacimiento (original y copia)',
  'CURP del alumno',
  'Fotografías (tamaño infantil)',
  'Boleta o certificado del ciclo anterior',
  'Cartilla de vacunación (preescolar)',
  'Comprobante de domicilio',
  'Identificación oficial del tutor',
];

export default function AdmissionsPage() {
  // Admissions funnel entry point (page views also cover this; the explicit
  // event makes the funnel step unambiguous in the analytics tool).
  useEffect(() => {
    trackEvent(FunnelEvent.ViewAdmissions);
  }, []);

  return (
    <div>
      {/* ── HERO ── */}
      <section className="relative overflow-hidden bg-dark text-white">
        <Blob tone="green" opacity={0.42} size={480} shape={2} className="hidden sm:block" style={{ top: -160, left: -120 }} />
        <Blob tone="pink" opacity={0.16} size={400} shape={1} className="hidden sm:block" style={{ bottom: -150, right: -110 }} />
        <div className="relative mx-auto w-full max-w-[1120px] px-6 py-14 sm:py-[72px]">
          <span className="section-label-pink inline-flex">Ciclo Escolar 2025–2026 · Inscripciones Abiertas</span>
          <h1 className="mt-3 font-head text-fluid-4xl font-black leading-[1.08] tracking-tight">
            Admisiones
          </h1>
          <p className="mt-4 max-w-[560px] text-base leading-relaxed text-white/60 sm:text-[17px]">
            Un proceso simple, transparente y completamente en línea. Te acompañamos en cada paso.
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
            style={{ background: 'linear-gradient(90deg, #401a8e, #9a1185, #ef2558, #47a028)' }}
          />
          <ol className="m-0 grid list-none grid-cols-1 gap-7 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ icon: Icon, step, title, desc, color }, i) => (
              <Reveal key={step} delay={i * 100} direction="up">
                <li className="relative text-center">
                  {/* Numbered node */}
                  <div
                    className="relative z-[1] mx-auto flex h-[58px] w-[58px] items-center justify-center rounded-full border-[3px] bg-white"
                    style={{ borderColor: color, boxShadow: `0 12px 26px -12px ${color}88` }}
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
              <ul className="space-y-2.5">
                {DOCS.map((d) => (
                  <li key={d} className="flex items-center gap-2.5 text-sm text-muted">
                    <CheckCircle className="h-4 w-4 flex-shrink-0 text-green-500" />
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
          <Reveal direction="left">
            <div className="card flex h-full flex-col justify-between border-brand-200 bg-brand-50">
              <div>
                <h3 className="mb-2 text-xl font-bold text-brand-800">¿Listo para comenzar?</h3>
                <p className="mb-6 text-sm leading-relaxed text-brand-700">
                  El proceso de pre-registro toma menos de 5 minutos. Recibirás confirmación inmediata
                  y nos pondremos en contacto para coordinar los siguientes pasos.
                </p>
              </div>
              <div className="space-y-3">
                <Link to="/pre-registro" className="btn-primary w-full justify-center">
                  Iniciar Pre-Registro <ArrowRight className="h-4 w-4" />
                </Link>
                <Link to="/puertas-abiertas" className="btn-secondary w-full justify-center">
                  Ver fechas de Puertas Abiertas
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </Section>
    </div>
  );
}
