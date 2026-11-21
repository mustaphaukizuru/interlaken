import { Check, X } from 'lucide-react';
import { clsx } from 'clsx';
import { PROCESS_STAGES, STAGE_META, stageIndex, type StageKey } from '@/lib/caseStages';

export type StepState = 'done' | 'current' | 'pending' | 'closed';

/** Short words under each step (tablet and up) and on a 360 px phone. */
const SHORT: Record<string, string> = {
  informes: 'Informes', visita: 'Visita', examen: 'Examen', documentacion: 'Documentos', inscrito: 'Inscrito',
};
const TINY: Record<string, string> = {
  informes: 'Informes', visita: 'Visita', examen: 'Examen', documentacion: 'Docs.', inscrito: 'Inscrito',
};

const STATE_TEXT: Record<StepState, string> = {
  done: 'completada',
  current: 'etapa actual',
  pending: 'pendiente',
  closed: 'aquí se cerró',
};

/** Where each step stands for a case on `stage` (closed in `closedFrom`). */
export function stepStates(stage: StageKey, closedFrom?: string | null): Record<string, StepState> {
  const out: Record<string, StepState> = {};
  const closed = stage === 'cerrado';
  const at = closed ? stageIndex(closedFrom || 'informes') : stageIndex(stage);
  PROCESS_STAGES.forEach((s, i) => {
    if (closed) out[s] = i < at ? 'done' : i === at ? 'closed' : 'pending';
    else if (stage === 'inscrito') out[s] = 'done';
    else out[s] = i < at ? 'done' : i === at ? 'current' : 'pending';
  });
  return out;
}

/**
 * The five steps of the process with where the case stands: done (check),
 * current (the stage's icon, ringed), pending (its number) and, for a closed
 * case, the step where it closed (a cross). Each step is a button that jumps
 * to its card. State is in the words too (screen readers, colour-blind).
 */
export function StageBar({ stage, closedFrom, onJump }: {
  stage: StageKey;
  closedFrom?: string | null;
  onJump: (stage: string) => void;
}) {
  const states = stepStates(stage, closedFrom);
  return (
    <nav aria-label="Etapas del proceso de admisión">
      <ol className="grid grid-cols-5 gap-1">
        {PROCESS_STAGES.map((s, i) => {
          const meta = STAGE_META[s];
          const state = states[s];
          const Icon = meta.icon;
          return (
            <li key={s} className="relative min-w-0">
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className={clsx(
                    'absolute right-1/2 top-[18px] z-0 h-0.5 w-full -translate-y-1/2 sm:top-[22px]',
                    state === 'pending' || state === 'closed' ? 'bg-line' : meta.dot,
                  )}
                />
              )}
              <button
                type="button"
                onClick={() => onJump(s)}
                aria-current={state === 'current' ? 'step' : undefined}
                aria-label={`${meta.step}. ${meta.label}: ${STATE_TEXT[state]}`}
                className="relative z-10 flex min-h-[44px] w-full flex-col items-center gap-1 rounded-xl px-0.5 pb-1 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
              >
                <span
                  className={clsx(
                    'flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ring-2 transition sm:h-11 sm:w-11',
                    state === 'done' && clsx(meta.dot, 'text-white ring-white'),
                    state === 'current' && clsx('bg-white ring-[3px] sm:ring-4', meta.text, 'ring-current'),
                    state === 'pending' && 'bg-white text-subtle ring-line',
                    state === 'closed' && 'bg-coral-50 text-coral-700 ring-coral-600/40',
                  )}
                >
                  {state === 'done' ? <Check className="h-5 w-5" aria-hidden="true" />
                    : state === 'closed' ? <X className="h-5 w-5" aria-hidden="true" />
                      : state === 'current' ? <Icon className="h-5 w-5" aria-hidden="true" />
                        : meta.step}
                </span>
                <span className={clsx('w-full truncate text-[11px] leading-tight sm:text-xs', state === 'current' ? 'font-bold text-ink' : 'font-medium text-muted')}>
                  <span className="sm:hidden">{TINY[s]}</span>
                  <span className="hidden sm:inline">{SHORT[s]}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default StageBar;
