import type { ReactNode } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { clsx } from 'clsx';
import { STAGE_META, type StageKey } from '@/lib/caseStages';
import type { StepState } from './StageBar';

const STATE_CHIP: Record<StepState, { label: string; cls: string }> = {
  done: { label: 'Completada', cls: 'bg-green-50 text-green-700 ring-green-600/20' },
  current: { label: 'Etapa actual', cls: 'bg-purple text-white ring-purple' },
  pending: { label: 'Pendiente', cls: 'bg-cream text-muted ring-subtle/25' },
  closed: { label: 'Se cerró aquí', cls: 'bg-coral-50 text-coral-700 ring-coral-600/20' },
};

export const cardDomId = (stage: string) => `etapa-${stage}`;
export const cardToggleId = (stage: string) => `etapa-${stage}-toggle`;

/**
 * One stage of the Expediente: a collapsible card whose header says the step,
 * its state in words and, while collapsed, one line of what was recorded.
 * The heading is the toggle (`aria-expanded`), so the StageBar can jump here
 * and focus it.
 */
export function StageCard({ stage, title, state, summary, open, onToggle, children, actions }: {
  stage: Exclude<StageKey, 'cerrado'>;
  title?: string;
  state: StepState;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** Buttons at the right of the header when open (e.g. «Enviar…»). */
  actions?: ReactNode;
}) {
  const meta = STAGE_META[stage];
  const Icon = meta.icon;
  const chip = STATE_CHIP[state];
  const bodyId = `${cardDomId(stage)}-body`;
  return (
    <section
      id={cardDomId(stage)}
      aria-labelledby={cardToggleId(stage)}
      className={clsx('card scroll-mt-24 overflow-hidden !p-0', state === 'current' && 'ring-2 ring-purple/20')}
    >
      <h2 className="m-0">
        <button
          id={cardToggleId(stage)}
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
          className="flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple/40 sm:px-5"
        >
          <span
            className={clsx(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold',
              state === 'done' ? clsx(meta.dot, 'text-white') : state === 'closed' ? 'bg-coral-50 text-coral-700' : 'bg-cream text-ink',
            )}
            aria-hidden="true"
          >
            {state === 'done' ? <Check className="h-4 w-4" /> : state === 'closed' ? <X className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-head text-[15px] font-bold text-ink">{meta.step}. {title ?? meta.label}</span>
              <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', chip.cls)}>
                {chip.label}
              </span>
            </span>
            {!open && summary && <span className="mt-0.5 block truncate text-xs text-muted">{summary}</span>}
          </span>
          <ChevronDown className={clsx('h-5 w-5 shrink-0 text-subtle transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </button>
      </h2>
      {open && (
        <div id={bodyId} className="space-y-5 border-t border-line px-4 py-4 sm:px-5 sm:py-5">
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
          {children}
        </div>
      )}
    </section>
  );
}

export default StageCard;
