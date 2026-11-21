/**
 * Where the family is in the ficha: «Paso 3 de 7» with a segmented bar on
 * every width, and the list of steps (done / current / missing / pending),
 * always visible from 640 px and behind «Ver todos los pasos» on a phone.
 * A step is a button once it can be opened (reached before, or complete).
 */
import { useId, useState } from 'react';
import { clsx } from 'clsx';
import { AlertCircle, Check, ChevronDown } from 'lucide-react';
import type { FichaCopy } from './copy';
import { fillText } from './copy';

export type StepState = 'done' | 'current' | 'missing' | 'pending';

export interface StepBarItem { key: string; label: string; state: StepState; reachable: boolean }

export function StepBar({ items, current, copy, onPick }: {
  items: StepBarItem[];
  current: string;
  copy: FichaCopy;
  onPick: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const index = Math.max(0, items.findIndex((s) => s.key === current));
  const here = items[index];
  const stateLabel: Record<StepState, string> = {
    done: copy.t('stateDone'), current: copy.t('stateCurrent'), missing: copy.t('stateMissing'), pending: copy.t('statePending'),
  };
  return (
    <nav aria-label={copy.t('stepsLabel')} className="rounded-xl2 border border-line bg-white p-4 shadow-card sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0">
          <span className="block text-xs font-bold uppercase tracking-[0.12em] text-pink">{fillText(copy.t('stepOf'), { n: index + 1, total: items.length })}</span>
          <span className="block truncate text-[15px] font-semibold text-ink">{here?.label}</span>
        </p>
        <button
          type="button"
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-full px-3 text-sm font-semibold text-purple hover:bg-cream focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 sm:hidden"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? copy.t('stepsHide') : copy.t('stepsToggle')}
          <ChevronDown className={clsx('h-4 w-4 transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden="true" />
        </button>
      </div>
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
      <ol id={listId} className={clsx('mt-3 gap-1.5 sm:mt-4 sm:grid sm:auto-cols-fr sm:grid-flow-col', open ? 'grid' : 'hidden')}>
        {items.map((s, i) => {
          const body = (
            <>
              <span
                className={clsx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold', {
                  'bg-green-strong text-white': s.state === 'done',
                  'bg-purple text-white': s.state === 'current',
                  'bg-amber-bright/25 text-amber': s.state === 'missing',
                  'bg-cream text-subtle': s.state === 'pending',
                })}
                aria-hidden="true"
              >
                {s.state === 'done' ? <Check className="h-4 w-4" /> : s.state === 'missing' ? <AlertCircle className="h-4 w-4" /> : i + 1}
              </span>
              <span className="min-w-0 text-left text-sm leading-tight sm:text-center sm:text-xs">
                <span className={clsx('block font-semibold', s.state === 'current' ? 'text-ink' : 'text-muted')}>{s.label}</span>
                <span className="sr-only">: {stateLabel[s.state]}</span>
              </span>
            </>
          );
          const cls = 'flex min-h-[44px] w-full items-center gap-3 rounded-xl px-2 py-1.5 sm:flex-col sm:gap-1.5 sm:px-1';
          return (
            <li key={s.key}>
              {s.reachable && s.state !== 'current' ? (
                <button
                  type="button"
                  className={clsx(cls, 'hover:bg-cream focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40')}
                  onClick={() => { setOpen(false); onPick(s.key); }}
                >
                  {body}
                </button>
              ) : (
                <span className={clsx(cls, s.state === 'current' && 'bg-purple-light/60')} aria-current={s.state === 'current' ? 'step' : undefined}>
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
