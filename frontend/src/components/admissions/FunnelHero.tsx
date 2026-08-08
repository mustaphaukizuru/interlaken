import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { CURRENT_CYCLE } from '@/lib/siteMeta';
import { Blob } from '@/components/ui/Blob';

const FUNNEL_STEPS = [
  { n: '01', label: 'Pre-Registro', to: '/pre-registro' },
  { n: '02', label: 'Puertas Abiertas', to: '/puertas-abiertas' },
  { n: '03', label: 'Inscripción', to: '/admisiones/documentacion' },
  { n: '04', label: 'Bienvenida', to: '/admisiones' },
] as const;

export type FunnelStepKey = 'pre-registro' | 'puertas-abiertas' | 'inscripcion' | 'bienvenida';

const STEP_INDEX: Record<FunnelStepKey, number> = {
  'pre-registro': 0,
  'puertas-abiertas': 1,
  inscripcion: 2,
  bienvenida: 3,
};

interface FunnelHeroProps {
  step: FunnelStepKey;
  title: string;
  subtitle?: string;
  /** Optional campus photo under the dark wash */
  imageSrc?: string;
}

/**
 * Shared admissions-funnel chrome — matches Admisiones marketing (dark hero +
 * cycle badge + 4-step progress) so /pre-registro, /registro, /agendar, etc.
 * no longer feel like a different site.
 */
export function FunnelHero({
  step,
  title,
  subtitle,
  imageSrc = '/assets/hopscotch.webp',
}: FunnelHeroProps) {
  const active = STEP_INDEX[step];

  return (
    <section className="relative overflow-hidden bg-dark text-white">
      <img
        src={imageSrc}
        alt=""
        className="absolute inset-0 h-full w-full object-cover opacity-30"
        loading="eager"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-dark/92 via-dark/75 to-dark/50" />
      <Blob
        tone="purple"
        opacity={0.35}
        size={420}
        shape={0}
        className="hidden sm:block"
        style={{ top: -160, left: -120 }}
      />
      <div className="relative mx-auto max-w-[1120px] px-4 py-10 sm:px-6 sm:py-14">
        <span className="section-label-pink inline-flex">
          Ciclo Escolar {CURRENT_CYCLE} · Admisiones
        </span>
        <h1 className="mt-3 font-head text-fluid-4xl font-black leading-[1.08] tracking-[-0.04em]">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-3 max-w-xl text-fluid-base leading-relaxed text-white/70">
            {subtitle}
          </p>
        ) : null}

        <ol
          className="mt-8 flex gap-2 overflow-x-auto pb-1 sm:gap-3"
          aria-label="Proceso de admisión"
        >
          {FUNNEL_STEPS.map((s, i) => {
            const done = i < active;
            const current = i === active;
            return (
              <li key={s.n} className="min-w-[7.5rem] flex-1 sm:min-w-0">
                <Link
                  to={s.to}
                  className={`block rounded-xl2 border px-3 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                    current
                      ? 'border-pink/50 bg-white/10'
                      : done
                        ? 'border-white/15 bg-white/5 hover:bg-white/10'
                        : 'border-white/10 bg-transparent hover:bg-white/5'
                  }`}
                  aria-current={current ? 'step' : undefined}
                >
                  <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/50">
                    {done ? (
                      <Check className="h-3 w-3 text-[var(--green-bright)]" aria-hidden="true" />
                    ) : (
                      <span className={current ? 'text-pink' : ''}>{s.n}</span>
                    )}
                    {current ? 'Ahora' : done ? 'Listo' : 'Siguiente'}
                  </span>
                  <span
                    className={`mt-0.5 block text-sm font-semibold ${
                      current ? 'text-white' : 'text-white/75'
                    }`}
                  >
                    {s.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

export default FunnelHero;
