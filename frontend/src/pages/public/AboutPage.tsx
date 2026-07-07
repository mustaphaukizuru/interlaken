import { CheckCircle } from 'lucide-react';

const VALUES = [
  'Excelencia académica con enfoque humanista',
  'Bilingüismo desde el nivel inicial',
  'Formación en valores y ciudadanía',
  'Tecnología e innovación educativa',
  'Comunidad escolar integrada e inclusiva',
  'Apoyo psicopedagógico personalizado',
];

export default function AboutPage() {
  return (
    <div>
      {/* Hero */}
      <section className="bg-gradient-to-r from-brand-700 to-brand-600 text-white py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h1 className="text-4xl font-bold mb-4">Nosotros</h1>
          <p className="text-brand-100 text-lg max-w-xl">
            Más de 30 años formando generaciones de líderes en Tlalnepantla de Baz.
          </p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
        <div className="grid md:grid-cols-2 gap-12 items-center mb-16">
          <div>
            <h2 className="text-3xl font-bold text-slate-900 mb-6">Nuestra misión</h2>
            <p className="text-slate-600 leading-relaxed mb-4">
              Colegio Interlaken es una institución educativa privada con más de 30 años de trayectoria
              en Tlalnepantla, Estado de México. Ofrecemos educación bilingüe de calidad desde nivel
              preescolar hasta preparatoria.
            </p>
            <p className="text-slate-600 leading-relaxed">
              Nuestra misión es formar personas íntegras, críticas y comprometidas con su entorno,
              capaces de afrontar los retos del siglo XXI con confianza y habilidades globales.
            </p>
          </div>
          <div className="bg-slate-50 rounded-2xl p-8">
            <h3 className="font-semibold text-slate-900 mb-4">Nuestros valores</h3>
            <ul className="space-y-3">
              {VALUES.map((v) => (
                <li key={v} className="flex items-start gap-3 text-sm text-slate-700">
                  <CheckCircle className="w-4 h-4 text-brand-600 flex-shrink-0 mt-0.5" />
                  {v}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Levels */}
        <div>
          <h2 className="text-2xl font-bold text-slate-900 mb-8 text-center">Niveles educativos</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { level: 'Preescolar',    grades: '1°–3°', age: '3–6 años',   color: 'bg-purple-50 border-purple-200 text-purple-700' },
              { level: 'Primaria',      grades: '1°–6°', age: '6–12 años',  color: 'bg-brand-50 border-brand-200 text-brand-700' },
              { level: 'Secundaria',    grades: '1°–3°', age: '12–15 años', color: 'bg-blue-50 border-blue-200 text-blue-700' },
              { level: 'Preparatoria', grades: '1°–3°', age: '15–18 años', color: 'bg-amber-50 border-amber-200 text-amber-700' },
            ].map((l) => (
              <div key={l.level} className={`rounded-2xl border-2 p-5 ${l.color}`}>
                <h4 className="font-bold text-lg mb-1">{l.level}</h4>
                <p className="text-sm opacity-80">{l.grades}</p>
                <p className="text-xs opacity-60 mt-1">{l.age}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
