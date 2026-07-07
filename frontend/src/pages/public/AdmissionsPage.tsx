import { Link } from 'react-router-dom';
import { FileText, ClipboardList, CheckCircle, ArrowRight, CalendarDays } from 'lucide-react';
import { Section } from '@/components/ui/Section';
import { Reveal } from '@/components/ui/Reveal';
import { Blob } from '@/components/ui/Blob';

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
    color: '#1da2ab',
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
  return (
    <div>
      {/* ── HERO ── */}
      <section style={{ position: 'relative', background: '#080516', color: '#fff', overflow: 'hidden' }}>
        <Blob tone="teal" opacity={0.42} size={480} shape={2} style={{ top: -160, left: -120 }} />
        <Blob tone="pink" opacity={0.16} size={400} shape={1} style={{ bottom: -150, right: -110 }} />
        <div style={{ position: 'relative', maxWidth: 1120, margin: '0 auto', padding: '72px 24px' }}>
          <span className="section-label-pink" style={{ display: 'inline-flex' }}>Ciclo Escolar 2025–2026 · Inscripciones Abiertas</span>
          <h1 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 900, fontSize: 'clamp(34px, 5.5vw, 54px)', letterSpacing: -1.4, lineHeight: 1.08, marginTop: 12 }}>
            Admisiones
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.64)', fontSize: 17, marginTop: 18, maxWidth: 560, lineHeight: 1.7 }}>
            Un proceso simple, transparente y completamente en línea. Te acompañamos en cada paso.
          </p>
        </div>
      </section>

      {/* ── PROCESS TIMELINE ── */}
      <Section bg="white">
        <Reveal style={{ textAlign: 'center', marginBottom: 48 }}>
          <span className="section-label-purple" style={{ display: 'inline-flex' }}>Cómo funciona</span>
          <h2 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 'clamp(28px, 4vw, 40px)', color: '#1A1130', letterSpacing: -1 }}>Proceso de admisión</h2>
        </Reveal>

        <div style={{ position: 'relative' }}>
          {/* Connecting line (desktop only) */}
          <div
            aria-hidden="true"
            className="hidden lg:block"
            style={{ position: 'absolute', top: 28, left: '12.5%', right: '12.5%', height: 2, background: 'linear-gradient(90deg, #401a8e, #1da2ab, #ef2558, #48a018)', opacity: 0.35 }}
          />
          <ol style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 28, listStyle: 'none', margin: 0, padding: 0 }}>
            {STEPS.map(({ icon: Icon, step, title, desc, color }, i) => (
              <Reveal key={step} delay={i * 100} direction="up">
                <li style={{ position: 'relative', textAlign: 'center' }}>
                  {/* Numbered node */}
                  <div style={{ position: 'relative', width: 58, height: 58, margin: '0 auto', borderRadius: '50%', background: '#fff', border: `3px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 12px 26px -12px ${color}88`, zIndex: 1 }}>
                    <Icon size={24} color={color} />
                    <span style={{ position: 'absolute', top: -8, right: -8, minWidth: 24, height: 24, padding: '0 6px', borderRadius: 999, background: color, color: '#fff', fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{step}</span>
                  </div>
                  <h3 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 18, color: '#1A1130', marginTop: 18 }}>{title}</h3>
                  <p style={{ color: '#6E6885', fontSize: 13.5, marginTop: 8, lineHeight: 1.6, maxWidth: 240, marginLeft: 'auto', marginRight: 'auto' }}>{desc}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </Section>

      {/* ── DOCUMENTS + CTA ── */}
      <Section bg="cream">
        <div className="grid md:grid-cols-2 gap-8">
          <Reveal direction="right">
            <div className="card" style={{ height: '100%' }}>
              <h3 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 19, color: '#1A1130', marginBottom: 18 }}>Documentos requeridos</h3>
              <ul className="space-y-2.5">
                {DOCS.map((d) => (
                  <li key={d} className="flex items-center gap-2.5 text-sm text-slate-600">
                    <CheckCircle className="w-4 h-4 text-brand-500 flex-shrink-0" />
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
          <Reveal direction="left">
            <div className="card bg-brand-50 border-brand-200 flex flex-col justify-between" style={{ height: '100%' }}>
              <div>
                <h3 className="font-bold text-brand-800 text-xl mb-2">¿Listo para comenzar?</h3>
                <p className="text-brand-700 text-sm leading-relaxed mb-6">
                  El proceso de pre-registro toma menos de 5 minutos. Recibirás confirmación inmediata
                  y nos pondremos en contacto para coordinar los siguientes pasos.
                </p>
              </div>
              <div className="space-y-3">
                <Link to="/pre-registro" className="btn-primary w-full justify-center">
                  Iniciar Pre-Registro <ArrowRight className="w-4 h-4" />
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
