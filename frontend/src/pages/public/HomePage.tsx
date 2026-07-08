import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import {
  ArrowRight, Award, TrendingUp, Star, Check, Users, GraduationCap,
  CalendarDays, Sparkles, Languages, Trophy, Palette, FlaskConical,
  MapPin, Quote, Heart, Mail, Send,
} from 'lucide-react';
import { admissionsApi, contactApi } from '@/services/api';
import type { OpenSchoolEvent } from '@/types';
import { Section } from '@/components/ui/Section';
import { Container } from '@/components/ui/Container';
import { Reveal } from '@/components/ui/Reveal';

const STATS = [
  { value: '1,200+', label: 'Alumnos', color: '#ef2558', icon: Users },
  { value: '80+', label: 'Maestros', color: '#47a028', icon: GraduationCap },
  { value: '40', label: 'Años', color: '#8f6fd0', icon: CalendarDays },
  { value: '95%', label: 'Aprovechamiento', color: '#48d06a', icon: TrendingUp },
];

const TRUST_BADGES = ['Bilingüe', '40 años', 'Certificación SEP', 'Grupos reducidos'];

const LEVELS = [
  { name: 'Preescolar', img: '/assets/court-primaria.webp', accent: '#47a028', desc: 'Aprendizaje lúdico y desarrollo socioemocional en un entorno seguro y estimulante.' },
  { name: 'Primaria', img: '/assets/facade.webp', accent: '#401a8e', desc: 'Formación bilingüe sólida con énfasis en pensamiento crítico y valores.' },
  { name: 'Secundaria', img: '/assets/secundaria.webp', accent: '#ef2558', desc: 'Preparación académica de excelencia orientada al liderazgo y la ciudadanía global.' },
];

const PROGRAMS = [
  { name: 'Inglés', img: '/assets/classroom.webp', accent: '#401a8e', icon: Languages },
  { name: 'Deportes', img: '/assets/campus-court.webp', accent: '#47a028', icon: Trophy },
  { name: 'Arte y Música', img: '/assets/campus-mural.webp', accent: '#ef2558', icon: Palette },
  { name: 'Ciencia y Robótica', img: '/assets/secundaria.webp', accent: '#48a018', icon: FlaskConical },
];

const PROMOS = [
  {
    label: 'Modelo Bilingüe',
    title: 'Inglés desde preescolar, todos los días',
    desc: 'Un programa intensivo con certificaciones internacionales que prepara a nuestros alumnos para un mundo global.',
    to: '/nosotros',
    cta: 'Conoce el modelo',
    grad: 'linear-gradient(135deg, #401a8e 0%, #5e3aad 100%)',
    icon: Languages,
  },
  {
    label: 'Comunidad y Valores',
    title: 'Formamos personas íntegras y felices',
    desc: 'Educación en valores, acompañamiento socioemocional y una comunidad cálida donde cada familia pertenece.',
    to: '/nosotros',
    cta: 'Nuestra comunidad',
    grad: 'linear-gradient(135deg, #ef2558 0%, #ec1f7f 100%)',
    icon: Heart,
  },
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

const GALLERY = Array.from({ length: 8 }, (_, i) => `/assets/interlaken-image (${i + 1}).webp`);

function hideOnError(e: React.SyntheticEvent<HTMLImageElement>) {
  (e.target as HTMLImageElement).style.display = 'none';
}

function initials(name: string) {
  return name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

function NewsletterCTA() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    try {
      await contactApi.send({
        name: name.trim(),
        email: email.trim(),
        subject: 'Solicitud de informes',
        message: `${name.trim()} solicita informes desde la página de inicio.`,
      });
      setDone(true);
      toast.success('¡Gracias! Te contactaremos muy pronto.');
    } catch {
      toast.error('No fue posible enviar tu solicitud. Intenta de nuevo.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 24, background: 'linear-gradient(120deg, #401a8e 0%, #5e3aad 100%)', color: '#fff', padding: 'clamp(32px, 5vw, 52px)', textAlign: 'center' }}>
      <div style={{ position: 'absolute', top: -60, right: -40, width: 220, height: 220, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
      <div style={{ position: 'relative', maxWidth: 620, margin: '0 auto' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, borderRadius: 14, background: 'rgba(255,255,255,0.14)', margin: '0 auto 16px' }}>
          <Mail size={24} />
        </div>
        <h2 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 'clamp(24px, 3.5vw, 34px)', letterSpacing: -0.5 }}>Solicita Informes</h2>
        <p style={{ fontSize: 16, opacity: 0.86, marginTop: 10, lineHeight: 1.6 }}>
          Déjanos tus datos y un asesor te compartirá costos, fechas y todo lo que necesitas saber sobre Interlaken.
        </p>
        {done ? (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 24, padding: '12px 20px', borderRadius: 999, background: 'rgba(72,208,106,0.2)', fontWeight: 600 }}>
            <Check size={18} color="#48d06a" strokeWidth={3} /> ¡Solicitud recibida! Te contactaremos pronto.
          </div>
        ) : (
          <form onSubmit={onSubmit} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 26, justifyContent: 'center' }}>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tu nombre"
              aria-label="Tu nombre"
              style={{ flex: '1 1 180px', minWidth: 0, border: 'none', borderRadius: 999, padding: '14px 20px', fontSize: 15, color: '#1A1130', outline: 'none' }}
            />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Tu correo electrónico"
              aria-label="Tu correo electrónico"
              style={{ flex: '1 1 220px', minWidth: 0, border: 'none', borderRadius: 999, padding: '14px 20px', fontSize: 15, color: '#1A1130', outline: 'none' }}
            />
            <button type="submit" className="btn btn-lg" disabled={sending} style={{ background: '#ef2558', color: '#fff', flex: '0 0 auto', opacity: sending ? 0.7 : 1 }}>
              {sending ? 'Enviando…' : <>Solicitar <Send size={16} /></>}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function HomePage() {
  const { data: events } = useQuery<OpenSchoolEvent[]>({
    queryKey: ['open-school-events'],
    queryFn: async () => {
      const { data } = await admissionsApi.getOpenSchoolEvents();
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
  const nextEvent = events?.find((e) => e.is_active) ?? events?.[0];

  return (
    <div>
      {/* ── HERO ── */}
      <section style={{ position: 'relative', background: '#080516', color: '#fff', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -160, left: -120, width: 520, height: 520, borderRadius: '50%', background: 'radial-gradient(circle, rgba(64,26,142,0.55), rgba(8,5,22,0) 68%)' }} />
        <div style={{ position: 'absolute', bottom: -140, right: -100, width: 420, height: 420, borderRadius: '50%', background: 'radial-gradient(circle, rgba(29,162,171,0.2), rgba(8,5,22,0) 66%)' }} />
        <Container style={{ padding: '72px 24px', position: 'relative', display: 'grid', gap: 40 }}>
          <div style={{ display: 'grid', gap: 48, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'center' }}>
            {/* Text */}
            <div>
              <span className="section-label-pink" style={{ display: 'inline-flex' }}>Ciclo Escolar 2025–2026 · Inscripciones Abiertas</span>
              <h1 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 900, fontSize: 'clamp(38px, 6vw, 60px)', lineHeight: 1.05, letterSpacing: -1.5, marginTop: 14 }}>
                Formando Líderes<br />
                <span style={{ background: 'linear-gradient(100deg, #ef2558 0%, #b13bbf 55%, #5e3aad 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>con Excelencia</span>
              </h1>
              <p style={{ color: 'rgba(255,255,255,0.62)', fontSize: 17, marginTop: 18, maxWidth: 520, lineHeight: 1.6 }}>
                Educación bilingüe de excelencia en Tlalnepantla. Desde preescolar hasta secundaria, formamos personas íntegras y preparadas para el mundo.
              </p>
              {/* Trust badges */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 24 }}>
                {TRUST_BADGES.map((b) => (
                  <span key={b} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 14px', borderRadius: 999, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.86)' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: 999, background: 'rgba(72,208,106,0.18)' }}>
                      <Check size={12} color="#48d06a" strokeWidth={3} />
                    </span>
                    {b}
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 30 }}>
                <Link to="/pre-registro" className="btn-pink btn-lg">Pre-inscripción <ArrowRight size={17} /></Link>
                <Link to="/login" className="btn-ghost btn-lg">Portal Familias</Link>
              </div>
            </div>
            {/* Image + floating cards */}
            <div style={{ position: 'relative' }}>
              <img src="/assets/court-wide.webp" alt="Colegio Interlaken" fetchPriority="high" decoding="async" style={{ width: '100%', borderRadius: 20, border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 30px 60px -20px rgba(0,0,0,0.6)', objectFit: 'cover', aspectRatio: '4/3' }} onError={hideOnError} />
              <div style={{ position: 'absolute', top: 18, left: -14, background: '#fff', color: '#1A1130', borderRadius: 14, padding: '12px 16px', boxShadow: '0 16px 30px -12px rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="stat-icon" style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(217,119,6,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Award size={18} color="#d97706" /></div>
                <div><div style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 14 }}>Top 5 Colegios</div><div style={{ fontSize: 11, color: '#6E6885' }}>Zona Norte CDMX</div></div>
              </div>
              <div style={{ position: 'absolute', bottom: 18, right: -14, background: '#fff', color: '#1A1130', borderRadius: 14, padding: '12px 16px', boxShadow: '0 16px 30px -12px rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="stat-icon" style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(72,160,24,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><TrendingUp size={18} color="#48a018" /></div>
                <div><div style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 14 }}>Promedio 9.2</div><div style={{ fontSize: 11, color: '#6E6885' }}>Ciclo anterior</div></div>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* ── STAT BANNER ── */}
      <section style={{ background: '#0f0a24', color: '#fff', padding: '40px 0' }}>
        <Container>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 20 }}>
            {STATS.map((s, i) => (
              <Reveal key={s.label} delay={i * 80} direction="up">
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ width: 52, height: 52, borderRadius: 14, flexShrink: 0, background: `${s.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <s.icon size={24} color={s.color} />
                  </div>
                  <div>
                    <div style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 900, fontSize: 32, color: s.color, letterSpacing: -1, lineHeight: 1 }}>{s.value}</div>
                    <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 3 }}>{s.label}</div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* ── ABOUT ── */}
      <Section bg="white">
        <div style={{ display: 'grid', gap: 44, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'center' }}>
          <Reveal direction="right">
            <span className="section-label-purple" style={{ display: 'inline-flex' }}>Nuestra Comunidad</span>
            <h2 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 'clamp(28px, 4vw, 40px)', color: '#1A1130', letterSpacing: -1, lineHeight: 1.15 }}>
              40 años formando familias en Tlalnepantla
            </h2>
            <p style={{ color: '#6E6885', fontSize: 16, marginTop: 16, lineHeight: 1.7 }}>
              En Colegio Interlaken combinamos rigor académico, educación bilingüe y un ambiente cálido y seguro. Nuestros egresados destacan por su liderazgo, sus valores y su compromiso con la comunidad.
            </p>
            <Link to="/nosotros" className="btn-outline" style={{ marginTop: 24 }}>Conócenos <ArrowRight size={16} /></Link>
          </Reveal>
          <Reveal direction="left" style={{ position: 'relative' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <img src="/assets/classroom.webp" alt="" loading="lazy" decoding="async" style={{ borderRadius: 16, objectFit: 'cover', height: 200, gridRow: 'span 2', width: '100%' }} onError={hideOnError} />
              <img src="/assets/campus-mural.webp" alt="" loading="lazy" decoding="async" style={{ borderRadius: 16, objectFit: 'cover', height: 93, width: '100%' }} onError={hideOnError} />
              <img src="/assets/hopscotch.webp" alt="" loading="lazy" decoding="async" style={{ borderRadius: 16, objectFit: 'cover', height: 93, width: '100%' }} onError={hideOnError} />
            </div>
            {/* Floating mini-stat card */}
            <div style={{ position: 'absolute', bottom: -18, right: -8, background: '#fff', borderRadius: 16, padding: '14px 18px', boxShadow: '0 20px 40px -16px rgba(64,26,142,0.35)', border: '1px solid #ECEAF3', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(64,26,142,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Star size={20} color="#401a8e" /></div>
              <div>
                <div style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 20, color: '#1A1130', lineHeight: 1 }}>+2,500</div>
                <div style={{ fontSize: 11.5, color: '#6E6885' }}>Egresados</div>
              </div>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ── LEVELS ── */}
      <Section bg="cream">
        <Reveal style={{ textAlign: 'center', marginBottom: 40 }}>
          <span className="section-label-green" style={{ display: 'inline-flex' }}>Niveles Educativos</span>
          <h2 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 'clamp(28px, 4vw, 40px)', color: '#1A1130', letterSpacing: -1 }}>Un camino de excelencia</h2>
        </Reveal>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24 }}>
          {LEVELS.map((l, i) => (
            <Reveal key={l.name} delay={i * 90}>
              <div className="card hover-lift" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ position: 'relative', height: 180 }}>
                  <img src={l.img} alt={l.name} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={hideOnError} />
                  <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, transparent 40%, ${l.accent}dd 100%)` }} />
                  <h3 style={{ position: 'absolute', bottom: 14, left: 18, color: '#fff', fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 22 }}>{l.name}</h3>
                </div>
                <div style={{ padding: '18px 20px' }}>
                  <p style={{ color: '#6E6885', fontSize: 14, lineHeight: 1.6 }}>{l.desc}</p>
                  <Link to="/admisiones" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 14, fontSize: 13.5, fontWeight: 700, color: l.accent }}>Más información <ArrowRight size={14} /></Link>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── PROGRAMAS ── */}
      <Section bg="white">
        <Reveal style={{ textAlign: 'center', marginBottom: 44 }}>
          <span className="section-label-pink" style={{ display: 'inline-flex' }}>Nuestros Programas</span>
          <h2 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 'clamp(28px, 4vw, 40px)', color: '#1A1130', letterSpacing: -1 }}>Más allá del aula</h2>
        </Reveal>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 28 }}>
          {PROGRAMS.map((p, i) => (
            <Reveal key={p.name} delay={i * 80} style={{ textAlign: 'center' }}>
              <div style={{ position: 'relative', width: 150, height: 150, margin: '0 auto' }}>
                <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: `${p.accent}14` }} />
                <div style={{ position: 'absolute', inset: 10, borderRadius: '50%', overflow: 'hidden', border: `3px solid ${p.accent}`, boxShadow: `0 16px 30px -14px ${p.accent}88` }}>
                  <img src={p.img} alt={p.name} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={hideOnError} />
                </div>
                <div style={{ position: 'absolute', bottom: 2, right: 2, width: 40, height: 40, borderRadius: '50%', background: p.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 18px -6px rgba(0,0,0,0.4)' }}>
                  <p.icon size={19} color="#fff" />
                </div>
              </div>
              <h3 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 17, color: '#1A1130', marginTop: 18 }}>{p.name}</h3>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── PROMO PAIR ── */}
      <Section bg="cream">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24 }}>
          {PROMOS.map((p, i) => (
            <Reveal key={p.label} delay={i * 100} direction={i === 0 ? 'right' : 'left'}>
              <div className="hover-lift" style={{ position: 'relative', overflow: 'hidden', borderRadius: 24, padding: '40px 36px', color: '#fff', background: p.grad, minHeight: 260, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 24px 48px -20px rgba(16,12,40,0.4)' }}>
                <div style={{ position: 'absolute', top: -50, right: -50, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
                <p.icon size={40} color="rgba(255,255,255,0.9)" style={{ position: 'relative' }} />
                <div style={{ position: 'relative', marginTop: 20 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.85 }}>{p.label}</span>
                  <h3 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 26, letterSpacing: -0.5, marginTop: 8, lineHeight: 1.2 }}>{p.title}</h3>
                  <p style={{ fontSize: 14.5, opacity: 0.9, marginTop: 12, lineHeight: 1.6, maxWidth: 420 }}>{p.desc}</p>
                  <Link to={p.to} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 20, fontWeight: 700, fontSize: 14, color: '#fff', borderBottom: '2px solid rgba(255,255,255,0.5)', paddingBottom: 2 }}>{p.cta} <ArrowRight size={15} /></Link>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── TESTIMONIOS ── */}
      <Section bg="white">
        <Reveal style={{ textAlign: 'center', marginBottom: 44 }}>
          <span className="section-label-purple" style={{ display: 'inline-flex' }}>Testimonios</span>
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

      {/* ── EVENT BANNER (Próxima Puertas Abiertas) ── */}
      <Section bg="cream">
        <Reveal>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', overflow: 'hidden', borderRadius: 24, boxShadow: '0 24px 48px -20px rgba(16,12,40,0.35)' }}>
            <div style={{ position: 'relative', minHeight: 240 }}>
              <img src="/assets/facade-sign.webp" alt="Puertas Abiertas Colegio Interlaken" loading="lazy" decoding="async" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} onError={hideOnError} />
            </div>
            <div style={{ background: 'linear-gradient(135deg, #47a028 0%, #401a8e 100%)', color: '#fff', padding: '44px 40px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, alignSelf: 'flex-start', padding: '6px 14px', borderRadius: 999, background: 'rgba(255,255,255,0.15)', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                <Sparkles size={13} /> Próximo Evento
              </span>
              <h2 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 'clamp(24px, 3.5vw, 34px)', letterSpacing: -0.5, marginTop: 16, lineHeight: 1.15 }}>
                {nextEvent?.title ?? 'Puertas Abiertas Interlaken'}
              </h2>
              {nextEvent ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginTop: 18 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600 }}>
                    <CalendarDays size={17} />
                    {(() => {
                      try {
                        return format(parseISO(nextEvent.date), "d 'de' MMMM, yyyy", { locale: es });
                      } catch {
                        return nextEvent.date;
                      }
                    })()}
                  </span>
                  {nextEvent.location && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600 }}>
                      <MapPin size={17} /> {nextEvent.location}
                    </span>
                  )}
                </div>
              ) : (
                <p style={{ fontSize: 15, opacity: 0.9, marginTop: 16, lineHeight: 1.6, maxWidth: 440 }}>
                  Ven a conocer nuestras instalaciones, nuestro modelo educativo y a la comunidad Interlaken. Consulta las próximas fechas.
                </p>
              )}
              <Link to="/puertas-abiertas" className="btn btn-lg" style={{ background: '#fff', color: '#401a8e', marginTop: 26, alignSelf: 'flex-start' }}>
                Reservar mi lugar <ArrowRight size={17} />
              </Link>
            </div>
          </div>
        </Reveal>
      </Section>

      {/* ── GALLERY ── */}
      <Section bg="dark">
        <Reveal style={{ textAlign: 'center', marginBottom: 36 }}>
          <span className="section-label-pink" style={{ display: 'inline-flex' }}>Galería</span>
          <h2 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 'clamp(28px, 4vw, 40px)', color: '#fff', letterSpacing: -1 }}>Vida en Interlaken</h2>
        </Reveal>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          {GALLERY.map((src, i) => (
            <img key={i} src={src} alt="" loading="lazy" style={{ width: '100%', height: 150, objectFit: 'cover', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)' }} onError={hideOnError} />
          ))}
        </div>
      </Section>

      {/* ── NEWSLETTER / LEAD CAPTURE ── */}
      <Section bg="white">
        <Reveal>
          <NewsletterCTA />
        </Reveal>
      </Section>

      {/* ── CTA ── */}
      <Section bg="gradient" spacing="sm" style={{ textAlign: 'center' }}>
        <Star size={28} style={{ margin: '0 auto 12px' }} />
        <h2 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 900, fontSize: 'clamp(28px, 4vw, 42px)', letterSpacing: -1 }}>Comienza el futuro de tu hijo hoy</h2>
        <p style={{ fontSize: 17, opacity: 0.9, marginTop: 12, maxWidth: 560, margin: '12px auto 0' }}>Agenda una visita o inicia tu pre-inscripción en línea en solo unos minutos.</p>
        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 14, marginTop: 28 }}>
          <Link to="/pre-registro" className="btn btn-lg" style={{ background: '#fff', color: '#401a8e' }}>Iniciar Pre-registro <ArrowRight size={17} /></Link>
          <Link to="/puertas-abiertas" className="btn-ghost btn-lg">Puertas Abiertas</Link>
        </div>
      </Section>
    </div>
  );
}
