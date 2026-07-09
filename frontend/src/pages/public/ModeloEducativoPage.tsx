import { Link } from 'react-router-dom';
import { ArrowRight, BookOpenCheck, Globe2, HeartHandshake, Laptop, Leaf, Trophy } from 'lucide-react';
import { Seo } from '@/components/seo/Seo';
import { Reveal } from '@/components/ui/Reveal';

const PILLARS = [
  {
    icon: Globe2,
    title: 'Educación bilingüe',
    text: 'Español–Inglés en los tres niveles, con preparación para el First Certificate de la Universidad de Cambridge en Secundaria.',
  },
  {
    icon: BookOpenCheck,
    title: 'Alto nivel académico',
    text: 'Planes y Programas de la SEP enriquecidos con horas clase adicionales, Proyecto de Activación a la Inteligencia y Taller de Lectura y Redacción.',
  },
  {
    icon: HeartHandshake,
    title: 'Educación en Valores',
    text: 'Formamos mejores seres humanos: valores en el quehacer diario, ayuda y servicio a la comunidad, ceremonias y convivencia.',
  },
  {
    icon: Laptop,
    title: 'Tecnología en el aula',
    text: 'iPad integrado al salón de clases (de 4º de Primaria en adelante) y Educación Tecnológica con certificación en Word, Excel y PowerPoint.',
  },
  {
    icon: Leaf,
    title: 'Cultura Ecológica',
    text: 'Conciencia ambiental transversal en actividades, campañas y proyectos escolares.',
  },
  {
    icon: Trophy,
    title: 'Actividades que complementan',
    text: 'Visitas, concursos, exposiciones, festivales, ExpoInterlaken · Maratón de Conocimientos y actividades extraescolares deportivas y culturales.',
  },
];

export default function ModeloEducativoPage() {
  return (
    <div>
      <Seo
        title="Modelo Educativo"
        description="El modelo del Colegio Interlaken: educación bilingüe, alto nivel académico, valores, tecnología en el aula y cultura ecológica, de Preescolar a Secundaria."
      />

      <section className="relative overflow-hidden bg-dark text-white">
        <img src="/assets/campus-mural.webp" alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" loading="eager" />
        <div className="absolute inset-0 bg-gradient-to-r from-dark/90 via-dark/70 to-dark/40" />
        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <span className="section-label-green inline-flex">El Colegio</span>
          <h1 className="mt-3 font-head text-fluid-3xl font-black leading-tight tracking-[-0.02em]">
            Modelo Educativo
          </h1>
          <p className="mt-4 max-w-2xl text-[15.5px] leading-relaxed text-white/80">
            Un modelo propio orientado a una formación de calidad: los alumnos
            adquieren conocimientos y desarrollan habilidades y actitudes que los
            hacen competentes en la vida diaria y los preparan para su siguiente
            nivel educativo.
          </p>
        </div>
      </section>

      <section className="bg-white py-12 sm:py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {PILLARS.map((p) => (
              <Reveal key={p.title}>
                <div className="h-full rounded-xl2 border border-ink/10 bg-cream-2 p-6">
                  <p.icon size={22} className="text-green-dark" aria-hidden="true" />
                  <h2 className="mt-3 font-head text-lg font-bold text-ink">{p.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{p.text}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <div className="mt-12 rounded-xl2 bg-dark p-8 text-center text-white sm:p-10">
            <h2 className="font-head text-fluid-xl font-bold">
              Conózcalo en acción, nivel por nivel
            </h2>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              {(['preescolar', 'primaria', 'secundaria'] as const).map((slug) => (
                <Link key={slug} to={`/niveles/${slug}`} className="btn-ghost capitalize">
                  {slug} <ArrowRight size={15} aria-hidden="true" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
