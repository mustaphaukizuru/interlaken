/**
 * The top of a numbered step, compact on every width: «Paso 3 de 7» with the
 * «Ver los pasos» button, the step's title (the H2 that takes the focus on
 * every step change, read as «Paso 3 de 7: Información de salud»), a
 * segmented bar and the step's intro. «Ver los pasos» opens the list of the
 * seven steps with their numbered titles and state (Completo / Faltan datos
 * / Pendiente / Paso actual): one tall row per step, so a thumb reaches it.
 * A step is a button once it can be opened (reached before, or complete).
 */
import { useId, useState, type Ref } from 'react';
import { clsx } from 'clsx';
import { AlertCircle, Check, ChevronDown, ChevronRight } from 'lucide-react';
import type { FichaCopy } from './copy';
import { stepNumber } from './copy';

export type StepState = 'done' | 'current' | 'missing' | 'pending';

export interface StepBarItem { key: string; label: string; state: StepState; reachable: boolean }

export function StepBar({ items, current, copy, onPick, intro, headingRef }: {
  items: StepBarItem[];
  current: string;
  copy: FichaCopy;
  onPick: (key: string) => void;
  intro?: string;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const index = Math.max(0, items.findIndex((s) => s.key === current));
  const here = items[index];
  const total = items.length;
  const number = stepNumber(copy, index + 1, total);
  const stateLabel: Record<StepState, string> = {
    done: copy.t('stateDone'), current: copy.t('stateCurrent'), missing: copy.t('stateMissing'), pending: copy.t('statePending'),
  };
  return (
    <header className="mb-6">
      <div className="flex min-h-[44px] items-center justify-between gap-3">
        {/* Read with the title (the H2 below), not twice. */}
        <p aria-hidden="true" className="min-w-0 text-xs font-bold uppercase tracking-[0.12em] text-pink">{number}</p>
        <button
          type="button"
          className="-mr-3 inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-sm px-3 text-sm font-semibold text-purple hover:bg-cream focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? copy.t('stepsHide') : copy.t('stepsToggle')}
          <ChevronDown className={clsx('h-4 w-4 transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden="true" />
        </button>
      </div>
      <h2 ref={headingRef} tabIndex={-1} className="scroll-mt-28 break-words font-head text-fluid-xl font-bold leading-tight text-ink focus:outline-none">
        <span className="sr-only">{number}: </span>{here?.label}
      </h2>
      <div className="mt-3 flex gap-1" aria-hidden="true">
        {items.map((s) => (
          <span
            key={s.key}
            className={clsx('h-1.5 flex-1 rounded-full', {
              'bg-green-strong': s.state === 'done',
              'bg-purple': s.state === 'current',
              'bg-amber-bright': s.state === 'missing',
              'bg-line': s.state === 'pending',
            })}
          />
        ))}
      </div>
      <nav id={listId} aria-label={copy.t('stepsLabel')} hidden={!open} className="mt-3 rounded-md bg-cream-2 p-1.5">
        <ol className="sm:columns-2 sm:gap-1.5">
          {items.map((s, i) => {
            const clickable = s.reachable && s.state !== 'current';
            const body = (
              <>
                <span
                  className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold', {
                    'bg-green-strong text-white': s.state === 'done',
                    'bg-purple text-white': s.state === 'current',
                    'bg-amber-bright/25 text-amber': s.state === 'missing',
                    'bg-white text-subtle ring-1 ring-line': s.state === 'pending',
                  })}
                  aria-hidden="true"
                >
                  {s.state === 'done' ? <Check className="h-4 w-4" /> : s.state === 'missing' ? <AlertCircle className="h-4 w-4" /> : i + 1}
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className={clsx('block text-[15px] font-semibold leading-snug', s.state === 'pending' && !s.reachable ? 'text-muted' : 'text-ink')}>
                    <span className="sr-only">{stepNumber(copy, i + 1, total)}: </span>{s.label}
                  </span>
                  <span className={clsx('block text-xs leading-snug', s.state === 'missing' ? 'font-semibold text-amber' : 'text-muted')}>
                    <span className="sr-only">, </span>{stateLabel[s.state]}
                  </span>
                </span>
                {clickable ? <ChevronRight className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" /> : null}
              </>
            );
            const cls = 'flex min-h-[52px] w-full items-center gap-3 rounded-md px-2.5 py-2';
            return (
              <li key={s.key} className="mb-1 break-inside-avoid last:mb-0">
                {clickable ? (
                  <button
                    type="button"
                    className={clsx(cls, 'hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40')}
                    onClick={() => { setOpen(false); onPick(s.key); }}
                  >
                    {body}
                  </button>
                ) : (
                  <span className={clsx(cls, s.state === 'current' && 'bg-purple-light')} aria-current={s.state === 'current' ? 'step' : undefined}>
                    {body}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      {intro ? <p className="mt-3 text-[15px] leading-relaxed text-muted">{intro}</p> : null}
    </header>
  );
}
