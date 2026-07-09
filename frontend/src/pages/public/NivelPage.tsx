import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowRight, CalendarCheck, CheckCircle2, Users } from 'lucide-react';
import { Seo } from '@/components/seo/Seo';
import { Reveal } from '@/components/ui/Reveal';
import { LEVELS, getLevel } from '@/lib/levels';

const ACCENT = {
  green: { label: 'section-label-green', text: 'text-green-dark', ring: 'border-green/30', soft: 'bg-green/5' },
  coral: { label: 'section-label-pink', text: 'text-coral-dark', ring: 'border-coral/30', soft: 'bg-coral/5' },
  purple: { label: 'section-label-purple', text: 'text-purple', ring: 'border-purple/30', soft: 'bg-purple/5' },
} as const;

/** Un template para los tres niveles (contenido en src/lib/levels.ts). */
export default function NivelPage() {
  const { nivel } = useParams();
  const level = getLevel(nivel);
  if (!level) return <Navigate to="/niveles/preescolar" replace />;
  const accent = ACCENT[level.accent];
  const others = LEVELS.filter((l) => l.slug !== level.slug);

  return (
    <div>
      <Seo
        title={`${level.name} — Niveles Educativos`}
        description={level.seoDescription}
      />

      {/* Hero */}
      <section className="relative overflow-hidden bg-dark text-white">
        <img
          src={level.hero}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-35"
          onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <span className={`${accent.label} inline-flex`}>Niveles Educativos</span>
          <h1 className="mt-3 font-head text-fluid-3xl font-black leading-tight tracking-[-0.02em]">
            {level.name}
          </h1>
          <p className="mt-4 max-w-2xl text-[15.5px] leading-relaxed text-white/80">
            {level.intro}
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to="/pre-registro" className="btn-pink">
              Iniciar pre-registro <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link to="/agendar-visita" className="btn-ghost">
              <CalendarCheck size={16} aria-hidden="true" /> Agendar visita
            </Link>
          </div>
        </div>
      </section>

      {/* Contenido + sidebar */}
      <section className="bg-white py-12 sm:py-16">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_300px]">
          <div className="space-y-10">
            <Reveal>
              <div>
                <h2 className={`font-head text-fluid-xl font-bold ${accent.text}`}>
                  {level.modelTitle}
                </h2>
                <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
                  {level.model.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-[15px] leading-snug text-ink/90">
                      <CheckCircle2 size={17} className={`mt-0.5 shrink-0 ${accent.text}`} aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>

            <Reveal>
              <div>
                <h2 className="font-head text-fluid-xl font-bold text-ink">{level.groupsTitle}</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {level.groups.map((g) => (
                    <div key={g.name} className={`rounded-xl2 border ${accent.ring} ${accent.soft} p-5`}>
                      <p className="flex items-center gap-2 font-head font-bold text-ink">
                        <Users size={17} className={accent.text} aria-hidden="true" /> {g.name}
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-muted">{g.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>

            <Reveal>
              <ul className="space-y-2.5">
                {level.extras.map((e) => (
                  <li key={e} className="flex items-start gap-2 text-[15px] leading-snug text-ink/90">
                    <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-green-dark" aria-hidden="true" />
                    {e}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          {/* Sidebar de acciones (paralela al menú del sitio anterior) */}
          <aside className="h-fit rounded-xl2 border border-ink/10 bg-cream-2 p-5 lg:sticky lg:top-24">
            <p className="font-head text-sm font-bold uppercase tracking-wide text-subtle">
              Información útil
            </p>
            <ul className="mt-3 divide-y divide-ink/10 text-[15px]">
              {[
                { to: '/admisiones', label: 'Proceso de inscripción' },
                { to: '/admisiones#documentacion', label: 'Documentación' },
                { to: '/admisiones#costos', label: 'Costos y colegiaturas' },
                { to: '/puertas-abiertas', label: 'Puertas Abiertas' },
                { to: '/contacto', label: 'Contacto por nivel' },
              ].map((l) => (
                <li key={l.label}>
                  <Link
                    to={l.to}
                    className="flex min-h-[44px] items-center justify-between gap-2 py-2 text-ink hover:text-green-dark"
                  >
                    {l.label} <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </section>

      {/* Otros niveles */}
      <section className="bg-cream-2 py-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="font-head text-sm font-bold uppercase tracking-wide text-subtle">
            Conozca también
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {others.map((o) => (
              <Link
                key={o.slug}
                to={`/niveles/${o.slug}`}
                className="group flex items-center justify-between rounded-xl2 border border-ink/10 bg-white p-5 hover:border-green/40"
              >
                <span className="font-head text-lg font-bold text-ink group-hover:text-green-dark">
                  {o.name}
                </span>
                <ArrowRight size={18} className="text-green-dark" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
