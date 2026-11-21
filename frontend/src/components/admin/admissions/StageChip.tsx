import { clsx } from 'clsx';
import { stageMeta, type StageKey } from '@/lib/caseStages';

/**
 * The stage of an admission case as a tinted pill: icon + words, the same
 * palette on the Expedientes list, the board, the StageBar and the case
 * header (`lib/caseStages.ts`). A closed case can add its outcome
 * («Cerrado · No le interesa»).
 */
export function StageChip({ stage, outcome, short = false, className }: {
  stage: StageKey | string;
  /** Closed outcome label, shown after «Cerrado». */
  outcome?: string;
  /** The short word («Documentación») for tight spots. */
  short?: boolean;
  className?: string;
}) {
  const meta = stageMeta(stage);
  const Icon = meta.icon;
  return (
    <span
      className={clsx(
        'inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset',
        meta.chip,
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">
        {short ? meta.short : meta.label}
        {stage === 'cerrado' && outcome ? ` · ${outcome}` : ''}
      </span>
    </span>
  );
}

export default StageChip;
