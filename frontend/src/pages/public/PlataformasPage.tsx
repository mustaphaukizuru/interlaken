import { Link } from 'react-router-dom';
import { GraduationCap, HeartHandshake, Info, Mail, Tablet } from 'lucide-react';
import { Seo } from '@/components/seo/Seo';
import { Section } from '@/components/ui/Section';
import { Reveal } from '@/components/ui/Reveal';
import { PlatformCard, type Platform } from '@/components/public/PlatformCard';
import { assetSrcSet } from '@/lib/images';

/**
 * El Colegio → Plataformas (bitácora 13/10/2026, ref. 6): las plataformas del
 * aula y de acompañamiento a padres. Los accesos de pago (colegiaturas y
 * cafetería) se movieron a /pagos.
 */
const STUDENT_PLATFORMS: Platform[] = [
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

const PARENT_PLATFORMS: Platform[] = [
  {
    name: 'Educar es Padre',
    desc: 'Cursos y contenidos diseñados para fortalecer la dinámica familiar y acompañar la crianza.',
    href: 'https://educarespadre.com/',
    icon: HeartHandshake,
    cta: 'Ir a Educar es Padre',
  },
];

export default function PlataformasPage() {
  return (
    <div>
      <Seo
        title="Plataformas"
        description="Plataformas del Colegio Interlaken: Google Classroom, Gmail institucional, registro de iPad (Mosyle) y Educar es Padre."
      />

      <section className="relative overflow-hidden bg-dark text-white">
        <img
          src="/assets/campus-mural.webp"
          srcSet={assetSrcSet('/assets/campus-mural.webp', { full: true })}
          sizes="100vw"
          alt=""
          width={1600}
          height={900}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover opacity-30"
          loading="eager"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-dark/92 via-dark/75 to-dark/45" />
        <div className="relative mx-auto max-w-[1120px] px-4 py-14 sm:px-6 sm:py-16 lg:py-[72px]">
          <span className="section-label-purple inline-flex">El Colegio</span>
          <h1 className="mt-3 font-head text-fluid-4xl font-black tracking-[-0.03em]">
            Plataformas
          </h1>
          <p className="mt-3 max-w-2xl text-[15.5px] leading-relaxed text-white/75 sm:text-base">
            Las herramientas digitales del aula y de acompañamiento a padres, en un solo lugar.
          </p>
        </div>
      </section>

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
      </Section>

      <Section bg="cream">
        <Reveal className="mb-8">
          <span className="section-label-green inline-flex">Familias</span>
          <h2 className="mt-2 font-head text-fluid-3xl font-extrabold tracking-[-0.02em] text-ink">
            Para padres
          </h2>
          <p className="mt-2 max-w-xl text-[15px] text-muted">
            Acompañamiento para la crianza y la vida familiar.
          </p>
        </Reveal>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {PARENT_PLATFORMS.map((p) => (
            <Reveal key={p.name}>
              <PlatformCard p={p} />
            </Reveal>
          ))}
        </div>

        <Reveal delay={120} className="mt-8">
          <div className="flex items-start gap-3 rounded-xl2 border border-ink/10 bg-white p-5 text-sm text-muted">
            <Info size={18} className="mt-0.5 flex-shrink-0 text-purple" aria-hidden="true" />
            <p>
              ¿Necesita recuperar un acceso o una contraseña? Escríbanos por
              WhatsApp o al correo de su nivel; vea{' '}
              <Link to="/contacto" className="font-medium text-green-dark underline">Contacto</Link>.
              Los pagos de colegiaturas y cafetería están en{' '}
              <Link to="/pagos" className="font-medium text-green-dark underline">Colegiaturas y cafetería</Link>.
            </p>
          </div>
        </Reveal>
      </Section>
    </div>
  );
}
