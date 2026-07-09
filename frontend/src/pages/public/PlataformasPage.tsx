import { Link } from 'react-router-dom';
import {
  ArrowRight, ArrowUpRight, CreditCard, GraduationCap, HeartHandshake,
  Info, LockKeyhole, Mail, MonitorSmartphone, Tablet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Seo } from '@/components/seo/Seo';

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
    <div className="flex flex-col rounded-xl2 border border-ink/10 bg-white p-6 shadow-card transition-shadow hover:shadow-lg">
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
        className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 self-start rounded-full border-2 border-green px-5 text-sm font-semibold text-green-dark transition-colors hover:bg-green hover:text-white"
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
        <img src="/assets/court-mural.webp" alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" loading="eager" />
        <div className="absolute inset-0 bg-gradient-to-r from-dark/90 via-dark/70 to-dark/45" />
        <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
          <span className="section-label-purple inline-flex">Comunidad</span>
          <h1 className="mt-3 font-head text-fluid-3xl font-black tracking-[-0.02em]">
            Plataformas
          </h1>
          <p className="mt-3 max-w-2xl text-[15.5px] text-white/80">
            Los accesos digitales que la comunidad Interlaken utiliza durante el
            ciclo escolar, en un solo lugar.
          </p>
        </div>
      </section>

      {/* Portal propio, destacado */}
      <section className="bg-white pt-12 sm:pt-16">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="rounded-xl2 border border-green/30 bg-green/5 p-6 sm:p-8">
            <p className="flex items-center gap-2 font-head text-lg font-bold text-ink sm:text-xl">
              <MonitorSmartphone size={22} className="text-green-dark" aria-hidden="true" />
              Portal de Familias Interlaken
            </p>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
              Saldo y recargas de cafetería, pago de colegiaturas, avisos y
              comunicados, y agenda de visitas — todo con su cuenta del colegio.
            </p>
            <Link to="/login" className="btn-pink mt-4">
              <LockKeyhole size={15} aria-hidden="true" /> Entrar al Portal
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      {/* Para familias */}
      <section className="bg-white py-10 sm:py-12">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <h2 className="font-head text-fluid-xl font-bold text-ink">Para familias</h2>
          <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
            {FAMILY_PLATFORMS.map((p) => <PlatformCard key={p.name} p={p} />)}
          </div>
        </div>
      </section>

      {/* Para alumnos y docentes */}
      <section className="bg-cream-2 py-10 sm:py-14">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <h2 className="font-head text-fluid-xl font-bold text-ink">Para alumnos y docentes</h2>
          <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {STUDENT_PLATFORMS.map((p) => <PlatformCard key={p.name} p={p} />)}
          </div>

          <div className="mt-8 flex items-start gap-3 rounded-xl2 border border-ink/10 bg-white p-5 text-sm text-muted">
            <Info size={18} className="mt-0.5 flex-shrink-0 text-purple" aria-hidden="true" />
            <p>
              ¿Necesita recuperar un acceso o una contraseña? Escríbanos por
              WhatsApp o al correo de su nivel — vea{' '}
              <Link to="/contacto" className="font-medium text-green-dark underline">Contacto</Link>.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
