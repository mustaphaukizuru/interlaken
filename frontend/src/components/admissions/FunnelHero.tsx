import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { CURRENT_CYCLE } from '@/lib/siteMeta';
import { Blob } from '@/components/ui/Blob';
import { useSiteTexts } from '@/hooks/useSiteSettings';

/**
 * The admission process as families walk it (2026-11-21): visit, exam, then
 * the inscripción with the ficha the school sends to admitted families (it is
 * private, so no step links to /pre-registro).
 */
const FUNNEL_STEPS = [
  // Covers both Puertas Abiertas (group) and Agendar Visita (individual).
  { n: '01', key: 'funnel_1', label: 'Visita', to: '/agendar-visita' },
  { n: '02', key: 'funnel_2', label: 'Examen', to: '/admisiones' },
  { n: '03', key: 'funnel_3', label: 'Inscripción', to: '/admisiones/documentacion' },
  { n: '04', key: 'funnel_4', label: 'Bienvenida', to: '/admisiones' },
] as const;

/** Built-in step words; Navegación → «Textos del sitio» edits them (SiteSettings.chrome funnel_*). */
export const FUNNEL_DEFAULTS = {
  funnel_1: 'Visita', funnel_2: 'Examen', funnel_3: 'Inscripción', funnel_4: 'Bienvenida',
  funnel_now: 'Ahora', funnel_done: 'Listo', funnel_next: 'Siguiente',
} as const;

export type FunnelStepKey =
  | 'pre-registro'
  | 'puertas-abiertas'
  | 'agendar-visita'
  | 'inscripcion'
  | 'bienvenida';

const STEP_INDEX: Record<FunnelStepKey, number> = {
  'puertas-abiertas': 0,
  'agendar-visita': 0,
  // The ficha de inscripción is part of the inscripción (sent after the exam).
  'pre-registro': 2,
  inscripcion: 2,
  bienvenida: 3,
};

interface FunnelHeroProps {
  step: FunnelStepKey;
  title: string;
  subtitle?: string;
  /** Optional campus photo under the dark wash */
  imageSrc?: string;
  /** Badge above the title; defaults to the cycle badge, '' hides it (CMS). */
  label?: string;
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
  label = `Ciclo Escolar ${CURRENT_CYCLE} · Admisiones`,
}: FunnelHeroProps) {
  const active = STEP_INDEX[step];
  const text = useSiteTexts(FUNNEL_DEFAULTS);

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
      <div className="relative mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        {label ? <span className="section-label-pink inline-flex">{label}</span> : null}
        <h1 className="mt-3 font-head text-fluid-4xl font-black leading-[1.08] tracking-[-0.04em]">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-3 max-w-xl text-fluid-base leading-relaxed text-white/70">
            {subtitle}
          </p>
        ) : null}

        <ol
          className="mt-8 flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 sm:gap-3"
          aria-label="Proceso de admisión"
        >
          {FUNNEL_STEPS.map((s, i) => {
            const done = i < active;
            const current = i === active;
            return (
              <li key={s.n} className="min-w-[7.5rem] flex-1 snap-start sm:min-w-0">
                <Link
                  to={s.to}
                  className={`block rounded-sm border px-3 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                    current
                      ? 'border-pink/50 bg-white/10'
                      : done
                        ? 'border-white/15 bg-white/5 hover:bg-white/10'
                        : 'border-white/10 bg-transparent hover:bg-white/5'
                  }`}
                  aria-current={current ? 'step' : undefined}
                >
                  <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-white/60">
                    {done ? (
                      <Check className="h-4 w-4 text-[var(--green-bright)]" aria-hidden="true" />
                    ) : (
                      <span className={current ? 'text-pink' : ''}>{s.n}</span>
                    )}
                    {current ? text.funnel_now : done ? text.funnel_done : text.funnel_next}
                  </span>
                  <span
                    className={`mt-0.5 block text-sm font-semibold ${
                      current ? 'text-white' : 'text-white/75'
                    }`}
                  >
                    {text[s.key]}
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
