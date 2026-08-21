import { Link } from 'react-router-dom';
import {
  ArrowRight, ArrowUpRight, CreditCard, GraduationCap, HeartHandshake,
  Info, LockKeyhole, Mail, MonitorSmartphone, Tablet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Seo } from '@/components/seo/Seo';
import { Section } from '@/components/ui/Section';
import { Reveal } from '@/components/ui/Reveal';

/**
 * Comunidad → Plataformas: directorio de accesos digitales de la comunidad
 * (mismas plataformas publicadas por el colegio en su sitio anterior).
 */
const FAMILY_PLATFORMS: {
  name: string; desc: string; href: string; icon: LucideIcon; cta: string;
}[] = [
  {
    name: 'ServoEscolar',
    desc: 'Pague colegiaturas con transferencia o tarjeta sin filas en el banco, y consulte las boletas de calificaciones de sus hijos en tiempo real.',
    href: 'https://interlaken.servoescolar.mx/',
    icon: CreditCard,
    cta: 'Ir a ServoEscolar',
  },
  {
    name: 'Educar es Padre',
    desc: 'Cursos y contenidos diseñados para fortalecer la dinámica familiar y acompañar la crianza.',
    href: 'https://educarespadre.com/',
    icon: HeartHandshake,
    cta: 'Ir a Educar es Padre',
  },
];

const STUDENT_PLATFORMS: {
  name: string; desc: string; href: string; icon: LucideIcon; cta: string;
}[] = [
  {
    name: 'Google Classroom',
    desc: 'Aulas virtuales del colegio: tareas, materiales y seguimiento de cada clase.',
    href: 'https://classroom.google.com/',
    icon: GraduationCap,
    cta: 'Abrir Classroom',
  },
  {
    name: 'Gmail institucional',
    desc: 'Correo electrónico oficial de alumnos y docentes (@interlaken).',
    href: 'https://www.gmail.com/',
    icon: Mail,
    cta: 'Abrir Gmail',
  },
  {
    name: 'Mosyle — registro de iPad',
    desc: 'Inscripción del iPad al sistema del colegio para usarlo en el salón de clases.',
    href: 'https://enroll.mosyle.com/?account=interlaken',
    icon: Tablet,
    cta: 'Registrar iPad',
  },
];

function PlatformCard({ p }: { p: (typeof FAMILY_PLATFORMS)[number] }) {
  return (
    <div className="flex h-full flex-col rounded-xl2 border border-ink/10 bg-white p-6 shadow-card transition-shadow hover:shadow-lg">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-green/10 text-green-dark">
          <p.icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <p className="font-head text-lg font-bold text-ink">{p.name}</p>
      </div>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-muted">{p.desc}</p>
      <a
        href={p.href}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 self-start rounded-full border-2 border-green px-5 text-sm font-semibold text-green-dark transition-colors hover:bg-green-strong hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green/40"
      >
        {p.cta} <ArrowUpRight size={15} aria-hidden="true" />
      </a>
    </div>
  );
}

export default function PlataformasPage() {
  return (
    <div>
      <Seo
        title="Plataformas"
        description="Accesos digitales de la comunidad Interlaken: Portal de Familias, ServoEscolar (pagos y boletas), Educar es Padre, Google Classroom, Gmail y registro de iPad."
      />

      <section className="relative overflow-hidden bg-dark text-white">
        <img
          src="/assets/campus-mural.webp"
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-30"
          loading="eager"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-dark/92 via-dark/75 to-dark/45" />
        <div className="relative mx-auto max-w-[1120px] px-4 py-14 sm:px-6 sm:py-16 lg:py-[72px]">
          <span className="section-label-purple inline-flex">Comunidad</span>
          <h1 className="mt-3 font-head text-fluid-4xl font-black tracking-[-0.03em]">
            Plataformas
          </h1>
          <p className="mt-3 max-w-2xl text-[15.5px] leading-relaxed text-white/75 sm:text-base">
            Los accesos digitales que la comunidad Interlaken utiliza durante el
            ciclo escolar, en un solo lugar.
          </p>
        </div>
      </section>

      <Section bg="white">
        <Reveal>
          <div className="relative overflow-hidden rounded-xl3 border border-green/25 bg-gradient-to-br from-green/[0.08] via-white to-cream-2 px-6 py-8 sm:px-9 sm:py-10">
            <div
              className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full opacity-40"
              style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--green) 35%, transparent), transparent 70%)' }}
            />
            <div className="relative">
              <p className="flex items-center gap-2.5 font-head text-xl font-bold text-ink sm:text-2xl">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-green/15 text-green-dark">
                  <MonitorSmartphone size={22} aria-hidden="true" />
                </span>
                Portal de Familias Interlaken
              </p>
              <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">
                Saldo y recargas de cafetería, avisos y comunicados, y agenda
                de visitas — todo con su cuenta del colegio.
              </p>
              <Link to="/login" className="btn-pink mt-5">
                <LockKeyhole size={15} aria-hidden="true" /> Entrar al Portal
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </Reveal>
      </Section>

      <Section bg="cream">
        <Reveal className="mb-8">
          <span className="section-label-green inline-flex">Familias</span>
          <h2 className="mt-2 font-head text-fluid-3xl font-extrabold tracking-[-0.02em] text-ink">
            Para familias
          </h2>
          <p className="mt-2 max-w-xl text-[15px] text-muted">
            Herramientas de pagos, boletas y acompañamiento familiar.
          </p>
        </Reveal>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {FAMILY_PLATFORMS.map((p, i) => (
            <Reveal key={p.name} delay={i * 80}>
              <PlatformCard p={p} />
            </Reveal>
          ))}
        </div>
      </Section>

      <Section bg="white">
        <Reveal className="mb-8">
          <span className="section-label-pink inline-flex">Aula digital</span>
          <h2 className="mt-2 font-head text-fluid-3xl font-extrabold tracking-[-0.02em] text-ink">
            Para alumnos y docentes
          </h2>
          <p className="mt-2 max-w-xl text-[15px] text-muted">
            Classroom, correo institucional y registro de dispositivos.
          </p>
        </Reveal>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {STUDENT_PLATFORMS.map((p, i) => (
            <Reveal key={p.name} delay={i * 80}>
              <PlatformCard p={p} />
            </Reveal>
          ))}
        </div>

        <Reveal delay={120} className="mt-8">
          <div className="flex items-start gap-3 rounded-xl2 border border-ink/10 bg-cream-2 p-5 text-sm text-muted">
            <Info size={18} className="mt-0.5 flex-shrink-0 text-purple" aria-hidden="true" />
            <p>
              ¿Necesita recuperar un acceso o una contraseña? Escríbanos por
              WhatsApp o al correo de su nivel — vea{' '}
              <Link to="/contacto" className="font-medium text-green-dark underline">Contacto</Link>.
            </p>
          </div>
        </Reveal>
      </Section>
    </div>
  );
}
