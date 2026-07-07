import { Link } from 'react-router-dom';
import { BookOpen, Users, Award, ArrowRight, Star } from 'lucide-react';

const FEATURES = [
  { icon: BookOpen, title: 'Educación Bilingüe', desc: 'Programas en español e inglés desde preescolar hasta preparatoria, con metodología internacional.' },
  { icon: Users, title: 'Comunidad Unida', desc: 'Más de 30 años formando familias en Tlalnepantla. Ambiente seguro, cálido y de excelencia.' },
  { icon: Award, title: 'Excelencia Académica', desc: 'Resultados superiores en evaluaciones nacionales e internacionales año tras año.' },
];

const STATS = [
  { value: '30+', label: 'Años de experiencia' },
  { value: '500+', label: 'Familias activas' },
  { value: '95%', label: 'Tasa de satisfacción' },
  { value: 'K-12', label: 'Niveles educativos' },
];

export default function HomePage() {
  return (
    <div>
      {/* Hero */}
      <section className="relative bg-gradient-to-br from-brand-800 via-brand-700 to-brand-600 text-white overflow-hidden">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
            backgroundSize: '60px',
          }}
        />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-24 md:py-32">
          <div className="max-w-2xl">
            <span className="inline-block bg-white/20 text-white text-xs font-semibold px-3 py-1 rounded-full mb-6 backdrop-blur-sm">
              Ciclo Escolar 2025–2026 · Inscripciones Abiertas
            </span>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight mb-6">
              Formamos líderes<br />
              <span className="text-brand-200">del mañana</span>
            </h1>
            <p className="text-lg text-brand-100 mb-10 leading-relaxed max-w-xl">
              Educación bilingüe de excelencia en Tlalnepantla. Desde preescolar hasta preparatoria,
              comprometidos con el desarrollo integral de cada alumno.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link
                to="/pre-registro"
                className="btn-primary bg-white text-brand-700 hover:bg-brand-50 shadow-lg text-sm px-6 py-3"
              >
                Iniciar Pre-Registro
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                to="/puertas-abiertas"
                className="btn-secondary border-white/40 bg-white/10 text-white hover:bg-white/20 text-sm px-6 py-3 backdrop-blur-sm"
              >
                Visitar el Colegio
              </Link>
            </div>
          </div>
        </div>
        {/* Decorative wave */}
        <div className="absolute bottom-0 left-0 right-0">
          <svg viewBox="0 0 1440 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M0 80L1440 80L1440 20C1200 70 960 0 720 30C480 60 240 10 0 40L0 80Z"
              fill="white"
            />
          </svg>
        </div>
      </section>

      {/* Stats */}
      <section className="bg-white py-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {STATS.map((s) => (
              <div key={s.label} className="text-center">
                <p className="text-3xl font-bold text-brand-600">{s.value}</p>
                <p className="text-sm text-slate-500 mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="bg-slate-50 py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-slate-900">¿Por qué elegir Interlaken?</h2>
            <p className="text-slate-500 mt-3 max-w-xl mx-auto">
              Un colegio donde cada alumno es conocido por nombre, no por número.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="card hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-brand-50 rounded-2xl flex items-center justify-center mb-4">
                  <Icon className="w-6 h-6 text-brand-600" />
                </div>
                <h3 className="font-semibold text-slate-900 mb-2">{title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonial / Social proof */}
      <section className="bg-white py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-slate-900">Lo que dicen las familias</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {[
              {
                text: 'El nivel académico y la atención personalizada que le dan a mi hijo son incomparables. Lo recomiendo ampliamente.',
                author: 'Familia Martínez',
                stars: 5,
              },
              {
                text: 'Desde preescolar hasta preparatoria, mis tres hijos han crecido aquí. Es más que un colegio, es una familia.',
                author: 'Familia Rodríguez',
                stars: 5,
              },
            ].map((t, i) => (
              <div key={i} className="card bg-slate-50 border-0">
                <div className="flex gap-0.5 mb-3">
                  {Array.from({ length: t.stars }).map((_, j) => (
                    <Star key={j} className="w-4 h-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-slate-700 text-sm leading-relaxed mb-4">"{t.text}"</p>
                <p className="text-xs font-semibold text-slate-500">— {t.author}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-brand-700 text-white py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl font-bold mb-4">¿Listo para conocernos?</h2>
          <p className="text-brand-100 mb-8 max-w-lg mx-auto">
            Reserve un lugar en nuestro próximo día de Puertas Abiertas o inicie el pre-registro hoy mismo.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              to="/puertas-abiertas"
              className="btn-primary bg-white text-brand-700 hover:bg-brand-50 px-8 py-3"
            >
              Puertas Abiertas
            </Link>
            <Link
              to="/pre-registro"
              className="btn-secondary border-white/30 bg-transparent text-white hover:bg-white/10 px-8 py-3"
            >
              Pre-Registro en línea
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
