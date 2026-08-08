import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import {
  ArrowRight, Award, TrendingUp, Star, Check, Users, GraduationCap,
  CalendarDays, Sparkles, Languages, Trophy, Palette, FlaskConical,
  MapPin, Heart, Mail, Send,
} from 'lucide-react';
import { admissionsApi, contactApi } from '@/services/api';
import { CURRENT_CYCLE, SCHOOL_YEARS } from '@/lib/siteMeta';
import type { OpenSchoolEvent } from '@/types';
import { Section } from '@/components/ui/Section';
import { Container } from '@/components/ui/Container';
import { Reveal } from '@/components/ui/Reveal';
import Logo from '@/components/ui/Logo';

const STATS = [
  { value: '1,200+', label: 'Alumnos', color: 'var(--pink)', icon: Users },
  { value: '80+', label: 'Maestros', color: 'var(--green)', icon: GraduationCap },
  { value: String(SCHOOL_YEARS), label: 'Años', color: 'var(--purple-mid)', icon: CalendarDays },
  { value: '95%', label: 'Aprovechamiento', color: 'var(--green-mid)', icon: TrendingUp },
];

const LEVELS = [
  { name: 'Preescolar', img: '/assets/court-primaria.webp', accent: 'var(--green)', desc: 'Aprendizaje lúdico y desarrollo socioemocional en un entorno seguro y estimulante.' },
  { name: 'Primaria', img: '/assets/facade.webp', accent: 'var(--purple)', desc: 'Formación bilingüe sólida con énfasis en pensamiento crítico y valores.' },
  { name: 'Secundaria', img: '/assets/secundaria.webp', accent: 'var(--pink)', desc: 'Preparación académica de excelencia orientada al liderazgo y la ciudadanía global.' },
];

const PROGRAMS = [
  { name: 'Inglés', img: '/assets/classroom.webp', accent: 'var(--purple)', icon: Languages },
  { name: 'Deportes', img: '/assets/campus-court.webp', accent: 'var(--green)', icon: Trophy },
  { name: 'Arte y Música', img: '/assets/campus-mural.webp', accent: 'var(--pink)', icon: Palette },
  { name: 'Ciencia y Robótica', img: '/assets/secundaria.webp', accent: 'var(--green)', icon: FlaskConical },
];

const PROMOS = [
  {
    label: 'Modelo Bilingüe',
    title: 'Inglés desde preescolar, todos los días',
    desc: 'Un programa intensivo con certificaciones internacionales que prepara a nuestros alumnos para un mundo global.',
    to: '/nosotros',
    cta: 'Conozca el modelo',
    grad: 'linear-gradient(135deg, var(--purple) 0%, var(--purple-mid) 100%)',
    icon: Languages,
  },
  {
    label: 'Comunidad y Valores',
    title: 'Formamos personas íntegras y felices',
    desc: 'Educación en valores, acompañamiento socioemocional y una comunidad cálida donde cada familia pertenece.',
    to: '/nosotros',
    cta: 'Nuestra comunidad',
    grad: 'linear-gradient(135deg, var(--pink) 0%, var(--pink-hot) 100%)',
    icon: Heart,
  },
];

/**
 * Institutional strengths — defensible, verifiable school credentials that
 * replace prior placeholder testimonials (fabricated social proof is banned).
 */
const STRENGTHS = [
  {
    icon: Award,
    color: 'var(--purple)',
    title: 'Incorporación oficial SEP',
    body: 'Planes de estudio con reconocimiento y validez oficial ante la Secretaría de Educación Pública.',
  },
  {
    icon: Languages,
    color: 'var(--green)',
    title: 'Certificaciones internacionales',
    body: 'Programa bilingüe intensivo con exámenes de certificación de inglés reconocidos internacionalmente.',
  },
  {
    icon: Heart,
    color: 'var(--pink)',
    title: `${SCHOOL_YEARS} años de trayectoria`,
    body: `${SCHOOL_YEARS} años formando familias en Tlalnepantla, con más de 2,500 egresados en nuestra comunidad.`,
  },
];

const GALLERY = Array.from({ length: 8 }, (_, i) => `/assets/interlaken-image (${i + 1}).webp`);

function hideOnError(e: React.SyntheticEvent<HTMLImageElement>) {
  (e.target as HTMLImageElement).style.display = 'none';
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
    <div className="relative overflow-hidden rounded-xl3 bg-gradient-to-br from-purple to-brand-500 text-white px-6 py-10 text-center sm:px-10 sm:py-12 lg:py-14">
      <div className="pointer-events-none absolute -top-16 -right-10 hidden h-56 w-56 rounded-full bg-white/[0.06] sm:block" />
      <div className="relative mx-auto max-w-[620px]">
        <div className="mx-auto mb-4 inline-flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-white/[0.14]">
          <Mail size={24} />
        </div>
        <h2 className="font-head font-extrabold text-fluid-3xl tracking-tight">Solicite informes</h2>
        <p className="mt-2.5 text-base leading-relaxed opacity-90">
          Déjenos sus datos y un asesor le compartirá costos, fechas y todo lo que necesita saber sobre Interlaken.
        </p>
        {done ? (
          <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-green-400/20 px-5 py-3 font-semibold">
            <Check size={18} color="var(--green-mid)" strokeWidth={3} /> ¡Solicitud recibida! Le contactaremos pronto.
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 flex flex-col flex-wrap justify-center gap-3 sm:mt-6 sm:flex-row">
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre completo"
              aria-label="Nombre completo"
              className="min-w-0 flex-1 rounded-full border-none px-5 py-3.5 text-[15px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-pink focus-visible:ring-offset-2 focus-visible:ring-offset-purple sm:flex-[1_1_180px]"
            />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Correo electrónico"
              aria-label="Correo electrónico"
              className="min-w-0 flex-1 rounded-full border-none px-5 py-3.5 text-[15px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-pink focus-visible:ring-offset-2 focus-visible:ring-offset-purple sm:flex-[1_1_220px]"
            />
            <button
              type="submit"
              className="btn btn-lg shrink-0 justify-center bg-pink text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-purple disabled:opacity-70"
              disabled={sending}
            >
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
      {/* ── HERO: brand + one headline + one line + CTAs over full-bleed campus ── */}
      <section className="relative flex min-h-[min(92svh,820px)] items-end overflow-hidden bg-dark text-white sm:min-h-[min(88svh,760px)]">
        <img
          src="/assets/court-wide.webp"
          alt="Campus Colegio Interlaken"
          {...{ fetchpriority: 'high' }} // React 18 lacks the camelCase prop; lowercase via spread avoids the TS/DOM warning
          decoding="async"
          width={1600}
          height={900}
          className="absolute inset-0 h-full w-full object-cover object-center"
          onError={hideOnError}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(8,5,22,0.35) 0%, rgba(8,5,22,0.55) 42%, rgba(8,5,22,0.92) 100%)',
          }}
        />
        <div
          className="pointer-events-none absolute -top-32 -left-24 hidden h-[420px] w-[420px] rounded-full sm:block"
          style={{ background: 'radial-gradient(circle, rgba(64,26,142,0.4), transparent 68%)' }}
        />
        <Container className="relative w-full !pb-12 !pt-28 sm:!pb-16 sm:!pt-32 lg:!pb-[72px]">
          <div className="max-w-[640px]">
            <Logo variant="horizontal" theme="dark" size={56} eager className="mb-6 sm:mb-7" />
            <h1 className="font-head font-black leading-[1.05] tracking-[-0.03em] text-fluid-5xl">
              Formando líderes<br />
              <span
                style={{
                  background: 'linear-gradient(100deg, var(--pink) 0%, var(--purple-mid) 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                con excelencia
              </span>
            </h1>
            <p className="mt-4 max-w-[480px] text-[16px] leading-relaxed text-white/75 sm:text-[17px]">
              Educación bilingüe en Tlalnepantla, de preescolar a secundaria — ciclo {CURRENT_CYCLE}.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:flex-wrap sm:gap-3.5">
              <Link
                to="/pre-registro"
                className="btn-pink btn-lg justify-center focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-dark"
              >
                Inicie su pre-registro <ArrowRight size={17} />
              </Link>
              <Link
                to="/login"
                className="btn-ghost btn-lg justify-center focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-dark"
              >
                Portal Familias
              </Link>
            </div>
          </div>
        </Container>
      </section>

      {/* ── STAT BANNER ── */}
      <section className="bg-dark-2 py-10 text-white">
        <Container>
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STATS.map((s, i) => (
              <Reveal key={s.label} delay={i * 80} direction="up">
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[14px]" style={{ background: `color-mix(in srgb, ${s.color} 13%, transparent)` }}>
                    <s.icon size={24} color={s.color} />
                  </div>
                  <div>
                    <div className="font-head text-[32px] font-black leading-none tracking-[-0.03em]" style={{ color: s.color }}>{s.value}</div>
                    <div className="mt-[3px] text-[13px] text-white/60">{s.label}</div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* ── ABOUT ── */}
      <Section bg="white">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-11">
          <Reveal direction="right">
            <span className="section-label-purple inline-flex">Nuestra Comunidad</span>
            <h2 className="font-head font-extrabold text-fluid-4xl leading-tight tracking-[-0.03em] text-ink">
              {SCHOOL_YEARS} años formando familias en Tlalnepantla
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted">
              En Colegio Interlaken combinamos rigor académico, educación bilingüe y un ambiente cálido y seguro. Nuestros egresados destacan por su liderazgo, sus valores y su compromiso con la comunidad.
            </p>
            <Link to="/nosotros" className="btn-outline mt-6 focus-visible:ring-2 focus-visible:ring-purple focus-visible:ring-offset-2">Conózcanos <ArrowRight size={16} /></Link>
          </Reveal>
          <Reveal direction="left" className="relative">
            <div className="grid grid-cols-2 gap-3.5">
              <img src="/assets/classroom.webp" alt="" loading="lazy" decoding="async" width={400} height={400} className="row-span-2 h-full max-w-full rounded-2xl object-cover" onError={hideOnError} />
              <img src="/assets/campus-mural.webp" alt="" loading="lazy" decoding="async" width={400} height={186} className="h-[93px] w-full max-w-full rounded-2xl object-cover" onError={hideOnError} />
              <img src="/assets/hopscotch.webp" alt="" loading="lazy" decoding="async" width={400} height={186} className="h-[93px] w-full max-w-full rounded-2xl object-cover" onError={hideOnError} />
            </div>
            {/* Floating mini-stat card */}
            <div className="absolute -bottom-4 right-0 flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3.5 shadow-purple sm:-right-2">
              <div className="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-purple/10"><Star size={20} color="var(--purple)" /></div>
              <div>
                <div className="font-head text-xl font-extrabold leading-none text-ink">+2,500</div>
                <div className="text-[11.5px] text-muted">Egresados</div>
              </div>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ── LEVELS ── */}
      <Section bg="cream">
        <Reveal className="mb-10 text-center">
          <span className="section-label-green inline-flex">Niveles Educativos</span>
          <h2 className="font-head font-extrabold text-fluid-4xl tracking-[-0.03em] text-ink">Un camino de excelencia</h2>
        </Reveal>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {LEVELS.map((l, i) => (
            <Reveal key={l.name} delay={i * 90}>
              <div className="card hover-lift overflow-hidden !p-0">
                <div className="relative h-[180px]">
                  <img src={l.img} alt={l.name} loading="lazy" decoding="async" width={400} height={180} className="h-full w-full max-w-full object-cover" onError={hideOnError} />
                  <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 40%, color-mix(in srgb, ${l.accent} 87%, transparent) 100%)` }} />
                  <h3 className="absolute bottom-3.5 left-[18px] font-head text-[22px] font-extrabold text-white">{l.name}</h3>
                </div>
                <div className="px-5 py-[18px]">
                  <p className="text-sm leading-relaxed text-muted">{l.desc}</p>
                  <Link to="/admisiones" className="mt-3.5 inline-flex items-center gap-[5px] text-[13.5px] font-bold focus-visible:ring-2 focus-visible:ring-offset-2 rounded" style={{ color: l.accent }}>Ver admisiones <ArrowRight size={14} /></Link>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── PROGRAMAS ── */}
      <Section bg="white">
        <Reveal className="mb-11 text-center">
          <span className="section-label-pink inline-flex">Nuestros Programas</span>
          <h2 className="font-head font-extrabold text-fluid-4xl tracking-[-0.03em] text-ink">Más allá del aula</h2>
        </Reveal>
        <div className="grid grid-cols-2 gap-7 sm:grid-cols-2 lg:grid-cols-4">
          {PROGRAMS.map((p, i) => (
            <Reveal key={p.name} delay={i * 80} className="text-center">
              <div className="relative mx-auto h-[150px] w-[150px] max-w-full">
                <div className="absolute inset-0 rounded-full" style={{ background: `color-mix(in srgb, ${p.accent} 8%, transparent)` }} />
                <div className="absolute inset-2.5 overflow-hidden rounded-full" style={{ border: `3px solid ${p.accent}`, boxShadow: `0 16px 30px -14px color-mix(in srgb, ${p.accent} 53%, transparent)` }}>
                  <img src={p.img} alt={p.name} loading="lazy" decoding="async" width={150} height={150} className="h-full w-full max-w-full object-cover" onError={hideOnError} />
                </div>
                <div className="absolute bottom-0.5 right-0.5 flex h-10 w-10 items-center justify-center rounded-full shadow-[0_8px_18px_-6px_rgba(0,0,0,0.4)]" style={{ background: p.accent }}>
                  <p.icon size={19} color="white" />
                </div>
              </div>
              <h3 className="mt-[18px] font-head text-[17px] font-bold text-ink">{p.name}</h3>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── PROMO PAIR ── */}
      <Section bg="cream">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {PROMOS.map((p, i) => (
            <Reveal key={p.label} delay={i * 100} direction={i === 0 ? 'right' : 'left'}>
              <div className="hover-lift relative flex min-h-[260px] flex-col justify-between overflow-hidden rounded-xl3 px-8 py-10 text-white shadow-[0_24px_48px_-20px_rgba(16,12,40,0.4)] sm:px-9" style={{ background: p.grad }}>
                <div className="pointer-events-none absolute -top-12 -right-12 h-[200px] w-[200px] rounded-full bg-white/[0.08]" />
                <p.icon size={40} color="rgba(255,255,255,0.9)" className="relative" />
                <div className="relative mt-5">
                  <span className="text-xs font-bold uppercase tracking-[1.5px] opacity-85">{p.label}</span>
                  <h3 className="mt-2 font-head text-[26px] font-extrabold leading-tight tracking-[-0.02em]">{p.title}</h3>
                  <p className="mt-3 max-w-[420px] text-[14.5px] leading-relaxed opacity-90">{p.desc}</p>
                  <Link to={p.to} className="mt-5 inline-flex items-center gap-1.5 border-b-2 border-white/50 pb-0.5 text-sm font-bold text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 rounded-sm">{p.cta} <ArrowRight size={15} /></Link>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── RESPALDO / POR QUÉ INTERLAKEN ── */}
      <Section bg="white">
        <Reveal className="mb-11 text-center">
          <span className="section-label-purple inline-flex">Por qué Interlaken</span>
          <h2 className="font-head font-extrabold text-fluid-4xl tracking-[-0.03em] text-ink">Respaldo que da certeza a su familia</h2>
        </Reveal>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {STRENGTHS.map((s, i) => (
            <Reveal key={s.title} delay={i * 90}>
              <div className="card hover-lift flex h-full flex-col gap-[18px]">
                <div className="flex h-[52px] w-[52px] items-center justify-center rounded-[14px]" style={{ background: `color-mix(in srgb, ${s.color} 12%, transparent)` }}>
                  <s.icon size={26} color={s.color} />
                </div>
                <h3 className="font-head text-[19px] font-bold text-ink">{s.title}</h3>
                <p className="flex-1 text-[15px] leading-relaxed text-muted">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── EVENT BANNER (Próxima Puertas Abiertas) ── */}
      <Section bg="cream">
        <Reveal>
          <div className="grid grid-cols-1 overflow-hidden rounded-xl3 shadow-[0_24px_48px_-20px_rgba(16,12,40,0.35)] lg:grid-cols-2">
            <div className="relative min-h-[220px] lg:min-h-[240px]">
              <img src="/assets/facade-sign.webp" alt="Puertas Abiertas Colegio Interlaken" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full max-w-full object-cover" onError={hideOnError} />
            </div>
            <div className="flex flex-col justify-center px-6 py-10 text-white sm:px-10 sm:py-11" style={{ background: 'linear-gradient(135deg, var(--green) 0%, var(--purple) 100%)' }}>
              <span className="inline-flex items-center gap-[7px] self-start rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-bold uppercase tracking-[1px]">
                <Sparkles size={13} /> Próximo Evento
              </span>
              <h2 className="mt-4 font-head font-extrabold text-fluid-3xl leading-tight tracking-[-0.02em]">
                {nextEvent?.title ?? 'Puertas Abiertas Interlaken'}
              </h2>
              {nextEvent ? (
                <div className="mt-[18px] flex flex-wrap gap-[18px]">
                  <span className="inline-flex items-center gap-2 text-[15px] font-semibold">
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
                    <span className="inline-flex items-center gap-2 text-[15px] font-semibold">
                      <MapPin size={17} /> {nextEvent.location}
                    </span>
                  )}
                </div>
              ) : (
                <p className="mt-4 max-w-[440px] text-[15px] leading-relaxed opacity-90">
                  Ven a conocer nuestras instalaciones, nuestro modelo educativo y a la comunidad Interlaken. Consulta las próximas fechas.
                </p>
              )}
              <Link to="/puertas-abiertas" className="btn btn-lg mt-6 self-start bg-white text-purple focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-purple">
                Reserve su lugar <ArrowRight size={17} />
              </Link>
            </div>
          </div>
        </Reveal>
      </Section>

      {/* ── GALLERY ── */}
      <Section bg="dark">
        <Reveal className="mb-9 text-center">
          <span className="section-label-pink inline-flex">Galería</span>
          <h2 className="font-head font-extrabold text-fluid-4xl tracking-[-0.03em] text-white">Vida en Interlaken</h2>
        </Reveal>
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
          {GALLERY.map((src, i) => (
            <img key={i} src={src} alt="" loading="lazy" width={280} height={150} className="h-[120px] w-full max-w-full rounded-[14px] border border-white/[0.08] object-cover sm:h-[150px]" onError={hideOnError} />
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
      <Section bg="gradient" spacing="sm" className="text-center">
        <Star size={28} className="mx-auto mb-3" />
        <h2 className="font-head font-black text-fluid-4xl tracking-[-0.03em]">Comience el futuro de su hijo hoy</h2>
        <p className="mx-auto mt-3 max-w-[560px] text-[17px] opacity-90">Agende una visita o inicie su pre-registro en línea en solo unos minutos.</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3.5">
          <Link to="/pre-registro" className="btn btn-lg bg-white text-purple focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-purple">Inicie su pre-registro <ArrowRight size={17} /></Link>
          <Link to="/puertas-abiertas" className="btn-ghost btn-lg focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-purple">Puertas Abiertas</Link>
        </div>
      </Section>
    </div>
  );
}
