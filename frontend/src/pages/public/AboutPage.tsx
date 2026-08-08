import { Link } from 'react-router-dom';
import {
  Target, Eye, Heart, Award, Users, Globe2,
  Sparkles, ArrowRight, type LucideIcon,
} from 'lucide-react';
import { Section } from '@/components/ui/Section';
import { SCHOOL_YEARS } from '@/lib/siteMeta';
import { Reveal } from '@/components/ui/Reveal';
import { Blob, Accent } from '@/components/ui/Blob';

const VALUES: { icon: LucideIcon; title: string; desc: string; color: string }[] = [
  { icon: Award,   title: 'Excelencia académica', desc: 'Formación rigurosa con enfoque humanista y pensamiento crítico.', color: 'var(--purple)' },
  { icon: Globe2,  title: 'Bilingüismo real',      desc: 'Inglés intensivo desde el nivel inicial con certificaciones internacionales.', color: 'var(--green)' },
  { icon: Heart,   title: 'Formación en valores',  desc: 'Ciudadanía, empatía y responsabilidad como parte de la vida diaria.', color: 'var(--pink)' },
  { icon: Sparkles, title: 'Innovación educativa', desc: 'Tecnología, ciencia y creatividad integradas al aula.', color: 'var(--green)' },
  { icon: Users,   title: 'Comunidad integrada',   desc: 'Un ambiente cálido e inclusivo donde cada familia pertenece.', color: 'var(--purple-mid)' },
  { icon: Target,  title: 'Acompañamiento',        desc: 'Apoyo psicopedagógico personalizado para cada alumno.', color: 'var(--amber)' },
];

// Levels use brand scales/tokens (green/brand/coral have numeric ramps; the
// 4th uses the purple token pair). Mirrors the levels offered in the
// pre-registro grade picker.
const LEVELS = [
  { level: 'Preescolar',   grades: '1°–3°', age: '3–6 años',   color: 'bg-green-50 border-green-200 text-green-700' },
  { level: 'Primaria',     grades: '1°–6°', age: '6–12 años',  color: 'bg-brand-50 border-brand-200 text-brand-700' },
  { level: 'Secundaria',   grades: '1°–3°', age: '12–15 años', color: 'bg-coral-50 border-coral-200 text-coral-700' },
];

/**
 * Institutional credentials — defensible facts that replace prior placeholder
 * testimonials (fabricated social proof is banned by the copy standard).
 */
const CREDENTIALS: { icon: LucideIcon; title: string; desc: string; color: string }[] = [
  { icon: Award,  title: 'Incorporación oficial SEP', desc: 'Estudios con reconocimiento y validez oficial ante la Secretaría de Educación Pública.', color: 'var(--purple)' },
  { icon: Globe2, title: 'Certificaciones de inglés',  desc: 'Preparamos a los alumnos para exámenes de certificación internacional de inglés.', color: 'var(--green)' },
  { icon: Users,  title: 'Más de 2,500 egresados',     desc: 'Cuatro décadas de comunidad que respaldan nuestra trayectoria en Tlalnepantla.', color: 'var(--pink)' },
];

function hideOnError(e: React.SyntheticEvent<HTMLImageElement>) {
  (e.target as HTMLImageElement).style.display = 'none';
}

export default function AboutPage() {
  return (
    <div>
      {/* ── HERO ── */}
      <section className="relative overflow-hidden bg-dark text-white">
        <Blob tone="purple" opacity={0.5} size={520} shape={0} className="hidden sm:block" style={{ top: -180, left: -140 }} />
        <Blob tone="green" opacity={0.18} size={420} shape={2} className="hidden sm:block" style={{ bottom: -160, right: -120 }} />
        <div className="relative mx-auto max-w-[1120px] px-6 py-14 sm:py-16 lg:py-[72px]">
          <span className="section-label-pink inline-flex">Nuestra Historia</span>
          <h1 className="mt-3 font-head font-black text-fluid-4xl leading-[1.08] tracking-[-0.04em]">
            {SCHOOL_YEARS} años formando<br />líderes en Tlalnepantla
          </h1>
          <p className="mt-4 max-w-xl text-fluid-base leading-relaxed text-white/60 sm:mt-[18px]">
            Colegio Interlaken es una institución educativa privada con más de cuatro décadas
            de trayectoria, ofreciendo educación bilingüe de calidad desde preescolar hasta secundaria.
          </p>
        </div>
      </section>

      {/* ── MISIÓN / VISIÓN split ── */}
      <Section bg="white">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-11">
          <Reveal direction="right" className="relative">
            <Blob tone="pink" opacity={0.1} size={280} shape={1} className="hidden sm:block" style={{ top: -40, left: -50 }} />
            <div className="relative">
              <h2 className="font-head text-fluid-3xl font-extrabold leading-tight tracking-[-0.02em] text-ink">
                Nuestra misión y visión
              </h2>
              <div className="mt-6 flex gap-4">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-purple/10">
                  <Target size={22} color="var(--purple)" />
                </div>
                <div>
                  <h3 className="font-head text-[17px] font-bold text-ink">Misión</h3>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
                    Formar personas íntegras, críticas y comprometidas con su entorno, capaces de
                    afrontar los retos del siglo XXI con confianza y habilidades globales.
                  </p>
                </div>
              </div>
              <div className="mt-5 flex gap-4">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-green/10">
                  <Eye size={22} color="var(--green)" />
                </div>
                <div>
                  <h3 className="font-head text-[17px] font-bold text-ink">Visión</h3>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
                    Ser la comunidad educativa de referencia en la zona, reconocida por la excelencia
                    académica, el bilingüismo y la formación humana de sus egresados.
                  </p>
                </div>
              </div>
            </div>
          </Reveal>

          {/* Image collage + floating mini-stat card */}
          <Reveal direction="left" className="relative">
            <Accent tone="green" variant="ring" size={64} opacity={0.4} className="hidden sm:block" style={{ top: -24, right: 20 }} />
            <div className="relative grid grid-cols-2 gap-3.5">
              <img src="/assets/facade.webp" alt="Fachada del Colegio Interlaken" width={520} height={240} loading="lazy" className="row-span-2 h-60 w-full max-w-full rounded-2xl object-cover" onError={hideOnError} />
              <img src="/assets/classroom.webp" alt="Aula del colegio" width={260} height={113} loading="lazy" className="h-[113px] w-full max-w-full rounded-2xl object-cover" onError={hideOnError} />
              <img src="/assets/campus-mural.webp" alt="Mural del campus" width={260} height={113} loading="lazy" className="h-[113px] w-full max-w-full rounded-2xl object-cover" onError={hideOnError} />
            </div>
            {/* Floating mini-stat card */}
            <div className="absolute -bottom-5 -left-2.5 flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3.5 shadow-purple sm:-left-2.5">
              <div className="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-pink/10">
                <Award size={20} color="var(--pink)" />
              </div>
              <div>
                <div className="font-head text-xl font-extrabold leading-none text-ink">+2,500</div>
                <div className="text-[11.5px] text-muted">Egresados</div>
              </div>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ── VALORES row ── */}
      <Section bg="cream">
        <Reveal className="mb-10 text-center sm:mb-11">
          <span className="section-label-purple inline-flex">Lo que nos define</span>
          <h2 className="font-head text-fluid-3xl font-extrabold tracking-[-0.025em] text-ink">Nuestros valores</h2>
        </Reveal>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {VALUES.map((v, i) => (
            <Reveal key={v.title} delay={i * 70}>
              <div className="card hover-lift h-full">
                <div
                  className="flex h-[46px] w-[46px] items-center justify-center rounded-xl2"
                  style={{ background: `color-mix(in srgb, ${v.color} 9%, transparent)` }}
                >
                  <v.icon size={22} color={v.color} />
                </div>
                <h3 className="mt-4 font-head text-[17px] font-bold text-ink">{v.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{v.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── NIVELES ── */}
      <Section bg="white">
        <Reveal className="mb-9 text-center">
          <span className="section-label-green inline-flex">Oferta educativa</span>
          <h2 className="font-head text-fluid-3xl font-extrabold tracking-[-0.025em] text-ink">Niveles educativos</h2>
        </Reveal>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {LEVELS.map((l, i) => (
            <Reveal key={l.level} delay={i * 80}>
              <div className={`rounded-2xl border-2 p-5 ${l.color}`}>
                <h4 className="font-bold text-lg mb-1">{l.level}</h4>
                <p className="text-sm opacity-80">{l.grades}</p>
                <p className="text-xs opacity-60 mt-1">{l.age}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── RESPALDO ── */}
      <Section bg="cream">
        <Reveal className="mb-10 text-center sm:mb-11">
          <span className="section-label-pink inline-flex">Nuestro respaldo</span>
          <h2 className="font-head text-fluid-3xl font-extrabold tracking-[-0.025em] text-ink">Certificaciones y trayectoria que dan certeza</h2>
        </Reveal>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {CREDENTIALS.map((c, i) => (
            <Reveal key={c.title} delay={i * 90}>
              <div className="card hover-lift flex h-full flex-col gap-[18px]">
                <div className="flex h-[52px] w-[52px] items-center justify-center rounded-[14px]" style={{ background: `color-mix(in srgb, ${c.color} 12%, transparent)` }}>
                  <c.icon size={26} color={c.color} />
                </div>
                <h3 className="font-head text-[19px] font-bold text-ink">{c.title}</h3>
                <p className="flex-1 text-[15px] leading-relaxed text-muted">{c.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── CTA ── */}
      <Section bg="gradient" spacing="sm" className="text-center">
        <h2 className="font-head text-fluid-3xl font-black tracking-[-0.025em]">¿Desea conocernos de cerca?</h2>
        <p className="mx-auto mt-3 max-w-xl text-fluid-base opacity-90">Agende una visita o inicie su pre-registro en línea en solo unos minutos.</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3.5">
          <Link to="/pre-registro" className="btn btn-lg bg-white text-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Inicie su pre-registro <ArrowRight size={17} /></Link>
          <Link to="/puertas-abiertas" className="btn-ghost btn-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Puertas Abiertas</Link>
        </div>
      </Section>
    </div>
  );
}
