import { Link } from 'react-router-dom';
import {
  Target, Eye, Heart, Award, Users, Globe2,
  Sparkles, Quote, ArrowRight, type LucideIcon,
} from 'lucide-react';
import { Section } from '@/components/ui/Section';
import { Reveal } from '@/components/ui/Reveal';
import { Blob, Accent } from '@/components/ui/Blob';

const VALUES: { icon: LucideIcon; title: string; desc: string; color: string }[] = [
  { icon: Award,   title: 'Excelencia académica', desc: 'Formación rigurosa con enfoque humanista y pensamiento crítico.', color: '#401a8e' },
  { icon: Globe2,  title: 'Bilingüismo real',      desc: 'Inglés intensivo desde el nivel inicial con certificaciones internacionales.', color: '#47a028' },
  { icon: Heart,   title: 'Formación en valores',  desc: 'Ciudadanía, empatía y responsabilidad como parte de la vida diaria.', color: '#ef2558' },
  { icon: Sparkles, title: 'Innovación educativa', desc: 'Tecnología, ciencia y creatividad integradas al aula.', color: '#48a018' },
  { icon: Users,   title: 'Comunidad integrada',   desc: 'Un ambiente cálido e inclusivo donde cada familia pertenece.', color: '#8f6fd0' },
  { icon: Target,  title: 'Acompañamiento',        desc: 'Apoyo psicopedagógico personalizado para cada alumno.', color: '#d97706' },
];

const LEVELS = [
  { level: 'Preescolar',   grades: '1°–3°', age: '3–6 años',   color: 'bg-purple-50 border-purple-200 text-purple-700' },
  { level: 'Primaria',     grades: '1°–6°', age: '6–12 años',  color: 'bg-brand-50 border-brand-200 text-brand-700' },
  { level: 'Secundaria',   grades: '1°–3°', age: '12–15 años', color: 'bg-blue-50 border-blue-200 text-blue-700' },
  { level: 'Preparatoria', grades: '1°–3°', age: '15–18 años', color: 'bg-amber-50 border-amber-200 text-amber-700' },
];

const TESTIMONIALS = [
  {
    name: 'Mariana Gómez',
    relation: 'Mamá de Primaria',
    color: '#401a8e',
    quote: 'Interlaken se siente como una familia. Mis hijos llegan felices y su inglés ha mejorado muchísimo en solo un año.',
  },
  {
    name: 'Roberto Salas',
    relation: 'Papá de Secundaria',
    color: '#47a028',
    quote: 'El acompañamiento de los maestros es excepcional. Se nota que conocen a cada alumno por su nombre y su historia.',
  },
  {
    name: 'Andrea Ríos',
    relation: 'Egresada, generación 2015',
    color: '#ef2558',
    quote: 'Los valores y la disciplina que aprendí aquí me acompañan hasta hoy en la universidad. Siempre agradecida con mi colegio.',
  },
];

function hideOnError(e: React.SyntheticEvent<HTMLImageElement>) {
  (e.target as HTMLImageElement).style.display = 'none';
}

function initials(name: string) {
  return name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

export default function AboutPage() {
  return (
    <div>
      {/* ── HERO ── */}
      <section style={{ position: 'relative', background: '#080516', color: '#fff', overflow: 'hidden' }}>
        <Blob tone="purple" opacity={0.5} size={520} shape={0} style={{ top: -180, left: -140 }} />
        <Blob tone="green" opacity={0.18} size={420} shape={2} style={{ bottom: -160, right: -120 }} />
        <div style={{ position: 'relative', maxWidth: 1120, margin: '0 auto', padding: '72px 24px' }}>
          <span className="section-label-pink" style={{ display: 'inline-flex' }}>Nuestra Historia</span>
          <h1 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 900, fontSize: 'clamp(34px, 5.5vw, 54px)', letterSpacing: -1.4, lineHeight: 1.08, marginTop: 12 }}>
            40 años formando<br />líderes en Tlalnepantla
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.64)', fontSize: 17, marginTop: 18, maxWidth: 560, lineHeight: 1.7 }}>
            Colegio Interlaken es una institución educativa privada con más de cuatro décadas
            de trayectoria, ofreciendo educación bilingüe de calidad desde preescolar hasta preparatoria.
          </p>
        </div>
      </section>

      {/* ── MISIÓN / VISIÓN split ── */}
      <Section bg="white">
        <div style={{ display: 'grid', gap: 44, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'center' }}>
          <Reveal direction="right" style={{ position: 'relative' }}>
            <Blob tone="pink" opacity={0.1} size={280} shape={1} style={{ top: -40, left: -50 }} />
            <div style={{ position: 'relative' }}>
              <h2 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 'clamp(26px, 3.5vw, 36px)', color: '#1A1130', letterSpacing: -0.8, lineHeight: 1.15 }}>
                Nuestra misión y visión
              </h2>
              <div style={{ display: 'flex', gap: 16, marginTop: 24 }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, flexShrink: 0, background: 'rgba(64,26,142,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Target size={22} color="#401a8e" />
                </div>
                <div>
                  <h3 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 17, color: '#1A1130' }}>Misión</h3>
                  <p style={{ color: '#6E6885', fontSize: 15, marginTop: 6, lineHeight: 1.7 }}>
                    Formar personas íntegras, críticas y comprometidas con su entorno, capaces de
                    afrontar los retos del siglo XXI con confianza y habilidades globales.
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 20 }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, flexShrink: 0, background: 'rgba(29,162,171,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Eye size={22} color="#47a028" />
                </div>
                <div>
                  <h3 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 17, color: '#1A1130' }}>Visión</h3>
                  <p style={{ color: '#6E6885', fontSize: 15, marginTop: 6, lineHeight: 1.7 }}>
                    Ser la comunidad educativa de referencia en la zona, reconocida por la excelencia
                    académica, el bilingüismo y la formación humana de sus egresados.
                  </p>
                </div>
              </div>
            </div>
          </Reveal>

          {/* Image collage + floating mini-stat card */}
          <Reveal direction="left" style={{ position: 'relative' }}>
            <Accent tone="green" variant="ring" size={64} opacity={0.4} style={{ top: -24, right: 20 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, position: 'relative' }}>
              <img src="/assets/facade.webp" alt="Fachada del Colegio Interlaken" style={{ borderRadius: 16, objectFit: 'cover', height: 240, gridRow: 'span 2', width: '100%' }} onError={hideOnError} />
              <img src="/assets/classroom.webp" alt="Aula del colegio" style={{ borderRadius: 16, objectFit: 'cover', height: 113, width: '100%' }} onError={hideOnError} />
              <img src="/assets/campus-mural.webp" alt="Mural del campus" style={{ borderRadius: 16, objectFit: 'cover', height: 113, width: '100%' }} onError={hideOnError} />
            </div>
            {/* Floating mini-stat card */}
            <div style={{ position: 'absolute', bottom: -20, left: -10, background: '#fff', borderRadius: 16, padding: '14px 18px', boxShadow: '0 20px 40px -16px rgba(64,26,142,0.35)', border: '1px solid #ECEAF3', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(239,37,88,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Award size={20} color="#ef2558" />
              </div>
              <div>
                <div style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 20, color: '#1A1130', lineHeight: 1 }}>+2,500</div>
                <div style={{ fontSize: 11.5, color: '#6E6885' }}>Egresados</div>
              </div>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ── VALORES row ── */}
      <Section bg="cream">
        <Reveal style={{ textAlign: 'center', marginBottom: 44 }}>
          <span className="section-label-purple" style={{ display: 'inline-flex' }}>Lo que nos define</span>
          <h2 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 'clamp(28px, 4vw, 40px)', color: '#1A1130', letterSpacing: -1 }}>Nuestros valores</h2>
        </Reveal>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 22 }}>
          {VALUES.map((v, i) => (
            <Reveal key={v.title} delay={i * 70}>
              <div className="card hover-lift" style={{ height: '100%' }}>
                <div style={{ width: 46, height: 46, borderRadius: 13, background: `${v.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <v.icon size={22} color={v.color} />
                </div>
                <h3 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 17, color: '#1A1130', marginTop: 16 }}>{v.title}</h3>
                <p style={{ color: '#6E6885', fontSize: 14, marginTop: 8, lineHeight: 1.6 }}>{v.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── NIVELES ── */}
      <Section bg="white">
        <Reveal style={{ textAlign: 'center', marginBottom: 36 }}>
          <span className="section-label-green" style={{ display: 'inline-flex' }}>Oferta educativa</span>
          <h2 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 'clamp(28px, 4vw, 40px)', color: '#1A1130', letterSpacing: -1 }}>Niveles educativos</h2>
        </Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
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

      {/* ── TESTIMONIOS ── */}
      <Section bg="cream">
        <Reveal style={{ textAlign: 'center', marginBottom: 44 }}>
          <span className="section-label-pink" style={{ display: 'inline-flex' }}>Testimonios</span>
          <h2 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 'clamp(28px, 4vw, 40px)', color: '#1A1130', letterSpacing: -1 }}>Lo que dicen nuestras familias</h2>
        </Reveal>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
          {TESTIMONIALS.map((t, i) => (
            <Reveal key={t.name} delay={i * 90}>
              <div className="card hover-lift" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 18 }}>
                <Quote size={30} color={t.color} style={{ opacity: 0.5 }} />
                <p style={{ color: '#3d3654', fontSize: 15, lineHeight: 1.7, flex: 1 }}>“{t.quote}”</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                  <div style={{ width: 46, height: 46, borderRadius: '50%', flexShrink: 0, background: t.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 15 }}>{initials(t.name)}</div>
                  <div>
                    <div style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 15, color: '#1A1130' }}>{t.name}</div>
                    <div style={{ fontSize: 12.5, color: '#6E6885' }}>{t.relation}</div>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── CTA ── */}
      <Section bg="gradient" spacing="sm" style={{ textAlign: 'center' }}>
        <h2 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 900, fontSize: 'clamp(26px, 4vw, 40px)', letterSpacing: -1 }}>¿Quieres conocernos de cerca?</h2>
        <p style={{ fontSize: 17, opacity: 0.9, marginTop: 12, maxWidth: 560, margin: '12px auto 0' }}>Agenda una visita o inicia tu pre-inscripción en línea en solo unos minutos.</p>
        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 14, marginTop: 28 }}>
          <Link to="/pre-registro" className="btn btn-lg" style={{ background: '#fff', color: '#401a8e' }}>Iniciar Pre-registro <ArrowRight size={17} /></Link>
          <Link to="/puertas-abiertas" className="btn-ghost btn-lg">Puertas Abiertas</Link>
        </div>
      </Section>
    </div>
  );
}
