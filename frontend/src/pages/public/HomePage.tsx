import { Link } from 'react-router-dom';
import { ArrowRight, Award, TrendingUp, Star } from 'lucide-react';

const STATS = [
  { value: '1,200+', label: 'Alumnos', color: '#ef2558' },
  { value: '80+', label: 'Maestros', color: '#1da2ab' },
  { value: '40', label: 'Años', color: '#8f6fd0' },
  { value: '95%', label: 'Aprovechamiento', color: '#48d06a' },
];

const LEVELS = [
  { name: 'Preescolar', img: '/assets/court-primaria.webp', accent: '#1da2ab', desc: 'Aprendizaje lúdico y desarrollo socioemocional en un entorno seguro y estimulante.' },
  { name: 'Primaria', img: '/assets/facade.webp', accent: '#401a8e', desc: 'Formación bilingüe sólida con énfasis en pensamiento crítico y valores.' },
  { name: 'Secundaria', img: '/assets/secundaria.webp', accent: '#ef2558', desc: 'Preparación académica de excelencia orientada al liderazgo y la ciudadanía global.' },
];

const GALLERY = Array.from({ length: 8 }, (_, i) => `/assets/interlaken-image (${i + 1}).webp`);

export default function HomePage() {
  return (
    <div>
      {/* ── HERO ── */}
      <section style={{ position: 'relative', background: '#080516', color: '#fff', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -160, left: -120, width: 520, height: 520, borderRadius: '50%', background: 'radial-gradient(circle, rgba(64,26,142,0.55), rgba(8,5,22,0) 68%)' }} />
        <div style={{ position: 'absolute', bottom: -140, right: -100, width: 420, height: 420, borderRadius: '50%', background: 'radial-gradient(circle, rgba(29,162,171,0.2), rgba(8,5,22,0) 66%)' }} />
        <div className="max-w-6xl" style={{ margin: '0 auto', padding: '72px 24px', position: 'relative', display: 'grid', gap: 48, gridTemplateColumns: '1fr', alignItems: 'center' }}>
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
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 30 }}>
                <Link to="/pre-registro" className="btn-pink btn-lg">Pre-inscripción <ArrowRight size={17} /></Link>
                <Link to="/login" className="btn-ghost btn-lg">Portal Familias</Link>
              </div>
            </div>
            {/* Image + floating cards */}
            <div style={{ position: 'relative' }}>
              <img src="/assets/court-wide.webp" alt="Colegio Interlaken" style={{ width: '100%', borderRadius: 20, border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 30px 60px -20px rgba(0,0,0,0.6)', objectFit: 'cover', aspectRatio: '4/3' }} onError={e => ((e.target as HTMLImageElement).style.display = 'none')} />
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
          {/* Stats strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 30 }}>
            {STATS.map(s => (
              <div key={s.label}>
                <div style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 900, fontSize: 34, color: s.color, letterSpacing: -1 }}>{s.value}</div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ABOUT ── */}
      <section style={{ background: '#fff', padding: '72px 0' }}>
        <div className="max-w-6xl" style={{ margin: '0 auto', padding: '0 24px', display: 'grid', gap: 44, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'center' }}>
          <div>
            <span className="section-label-purple" style={{ display: 'inline-flex' }}>Nuestra Comunidad</span>
            <h2 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 'clamp(28px, 4vw, 40px)', color: '#1A1130', letterSpacing: -1, lineHeight: 1.15 }}>
              40 años formando familias en Tlalnepantla
            </h2>
            <p style={{ color: '#6E6885', fontSize: 16, marginTop: 16, lineHeight: 1.7 }}>
              En Colegio Interlaken combinamos rigor académico, educación bilingüe y un ambiente cálido y seguro. Nuestros egresados destacan por su liderazgo, sus valores y su compromiso con la comunidad.
            </p>
            <Link to="/nosotros" className="btn-outline" style={{ marginTop: 24 }}>Conócenos <ArrowRight size={16} /></Link>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <img src="/assets/classroom.webp" alt="" style={{ borderRadius: 16, objectFit: 'cover', height: 200, gridRow: 'span 2' }} onError={e => ((e.target as HTMLImageElement).style.display = 'none')} />
            <img src="/assets/campus-mural.webp" alt="" style={{ borderRadius: 16, objectFit: 'cover', height: 93 }} onError={e => ((e.target as HTMLImageElement).style.display = 'none')} />
            <img src="/assets/hopscotch.webp" alt="" style={{ borderRadius: 16, objectFit: 'cover', height: 93 }} onError={e => ((e.target as HTMLImageElement).style.display = 'none')} />
          </div>
        </div>
      </section>

      {/* ── LEVELS ── */}
      <section style={{ background: '#FAF9FD', padding: '72px 0' }}>
        <div className="max-w-6xl" style={{ margin: '0 auto', padding: '0 24px' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <span className="section-label-teal" style={{ display: 'inline-flex' }}>Niveles Educativos</span>
            <h2 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 'clamp(28px, 4vw, 40px)', color: '#1A1130', letterSpacing: -1 }}>Un camino de excelencia</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24 }}>
            {LEVELS.map(l => (
              <div key={l.name} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ position: 'relative', height: 180 }}>
                  <img src={l.img} alt={l.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => ((e.target as HTMLImageElement).style.display = 'none')} />
                  <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, transparent 40%, ${l.accent}dd 100%)` }} />
                  <h3 style={{ position: 'absolute', bottom: 14, left: 18, color: '#fff', fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 22 }}>{l.name}</h3>
                </div>
                <div style={{ padding: '18px 20px' }}>
                  <p style={{ color: '#6E6885', fontSize: 14, lineHeight: 1.6 }}>{l.desc}</p>
                  <Link to="/admisiones" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 14, fontSize: 13.5, fontWeight: 700, color: l.accent }}>Más información <ArrowRight size={14} /></Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── GALLERY ── */}
      <section style={{ background: '#080516', padding: '72px 0' }}>
        <div className="max-w-6xl" style={{ margin: '0 auto', padding: '0 24px' }}>
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <span className="section-label-pink" style={{ display: 'inline-flex' }}>Galería</span>
            <h2 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 'clamp(28px, 4vw, 40px)', color: '#fff', letterSpacing: -1 }}>Vida en Interlaken</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            {GALLERY.map((src, i) => (
              <img key={i} src={src} alt="" style={{ width: '100%', height: 150, objectFit: 'cover', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)' }} onError={e => ((e.target as HTMLImageElement).style.display = 'none')} />
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ background: 'linear-gradient(120deg, #ef2558 0%, #401a8e 100%)', padding: '64px 0', color: '#fff' }}>
        <div className="max-w-6xl" style={{ margin: '0 auto', padding: '0 24px', textAlign: 'center' }}>
          <Star size={28} style={{ margin: '0 auto 12px' }} />
          <h2 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 900, fontSize: 'clamp(28px, 4vw, 42px)', letterSpacing: -1 }}>Comienza el futuro de tu hijo hoy</h2>
          <p style={{ fontSize: 17, opacity: 0.9, marginTop: 12, maxWidth: 560, margin: '12px auto 0' }}>Agenda una visita o inicia tu pre-inscripción en línea en solo unos minutos.</p>
          <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 14, marginTop: 28 }}>
            <Link to="/pre-registro" className="btn btn-lg" style={{ background: '#fff', color: '#401a8e' }}>Iniciar Pre-registro <ArrowRight size={17} /></Link>
            <Link to="/puertas-abiertas" className="btn-ghost btn-lg">Puertas Abiertas</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
