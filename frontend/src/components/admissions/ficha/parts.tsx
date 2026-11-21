/**
 * Small shared pieces of the ficha: the heading of an unnumbered screen
 * (focused on every change), the numbered step title, the error summary at
 * the top of a step, the «Guardado» status, the action row and the
 * full-width status panels (link sent, closed start, invalid link…).
 */
import { forwardRef, type ReactNode, type Ref } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, Check, CloudOff, Loader2 } from 'lucide-react';

export const StepHeading = forwardRef<HTMLHeadingElement, { title: string; intro?: string; eyebrow?: string }>(
  ({ title, intro, eyebrow }, ref) => (
    <header className="mb-6">
      {eyebrow ? <p className="mb-1 text-xs font-bold uppercase tracking-[0.12em] text-pink">{eyebrow}</p> : null}
      <h2 ref={ref} tabIndex={-1} className="scroll-mt-28 font-head text-fluid-xl font-bold text-ink focus:outline-none">{title}</h2>
      {intro ? <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{intro}</p> : null}
    </header>
  ),
);
StepHeading.displayName = 'StepHeading';

/**
 * «Paso 2 de 7» over a step's title (review sections, lists), read as one
 * «Paso 2 de 7: Domicilio». Unnumbered screens pass no number.
 */
export function NumberedTitle({ number, title }: { number?: string; title: string }) {
  return (
    <>
      {number ? (
        <>
          <span aria-hidden="true" className="mb-0.5 block text-[11px] font-bold uppercase leading-4 tracking-[0.12em] text-pink">{number}</span>
          <span className="sr-only">{number}: </span>
        </>
      ) : null}
      {title}
    </>
  );
}

export interface SummaryItem { id: string; label: string; message: string }

/**
 * «Revise estos datos»: every problem of the step with a link that moves
 * focus to the field. Focused when it appears, so a screen reader reads it.
 */
export const ErrorSummary = forwardRef<HTMLDivElement, { title: string; items: SummaryItem[]; detail?: string; children?: ReactNode }>(
  ({ title, items, detail, children }, ref) => {
    if (!items.length && !detail && !children) return null;
    const go = (id: string) => {
      const el = document.getElementById(id);
      if (!el) return;
      const target = el.tagName === 'FIELDSET' ? (el.querySelector('input') as HTMLElement | null) ?? el : el;
      el.scrollIntoView?.({ block: 'center' });
      target.focus({ preventScroll: true });
    };
    return (
      <div ref={ref} tabIndex={-1} role="alert" className="mb-6 rounded-xl2 border border-coral-200 bg-coral-50 p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-coral-400/40">
        <p className="flex items-start gap-2 font-semibold text-coral-800">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <span>{title}</span>
        </p>
        {detail ? <p className="mt-1.5 pl-7 text-sm text-coral-800">{detail}</p> : null}
        {items.length ? (
          <ul className="mt-2 space-y-1 pl-7 text-sm">
            {items.map((it) => (
              <li key={it.id}>
                <a
                  href={`#${it.id}`}
                  className="font-medium text-coral-800 underline underline-offset-2 hover:text-coral-900"
                  onClick={(e) => { e.preventDefault(); go(it.id); }}
                >
                  {it.label}
                </a>
                <span className="text-coral-800">: {it.message}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {children}
      </div>
    );
  },
);
ErrorSummary.displayName = 'ErrorSummary';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** «Guardando…» / «Guardado» / «No se pudo guardar», announced politely. */
export function SaveStatus({ state, labels }: { state: SaveState; labels: { saving: string; saved: string; error: string } }) {
  return (
    <p role="status" aria-live="polite" className="flex min-h-[20px] items-center gap-1.5 text-xs font-medium">
      {state === 'saving' ? (
        <span className="inline-flex items-center gap-1.5 text-muted"><Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />{labels.saving}</span>
      ) : state === 'saved' ? (
        <span className="inline-flex items-center gap-1.5 text-green-dark"><Check className="h-3.5 w-3.5" aria-hidden="true" />{labels.saved}</span>
      ) : state === 'error' ? (
        <span className="inline-flex items-center gap-1.5 text-coral-700"><CloudOff className="h-3.5 w-3.5" aria-hidden="true" />{labels.error}</span>
      ) : null}
    </p>
  );
}

/** A centred status screen (link sent, link invalid, start closed, already sent). */
export function Panel({ icon, tone = 'neutral', title, children, headingRef }: {
  icon: ReactNode;
  tone?: 'neutral' | 'success' | 'warn';
  title: string;
  children?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="card p-6 text-center sm:p-10">
      <div className={clsx('mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full', {
        'bg-cream text-purple': tone === 'neutral',
        'bg-green-light text-green-dark': tone === 'success',
        'bg-coral-50 text-coral-700': tone === 'warn',
      })} aria-hidden="true">
        {icon}
      </div>
      <h2 ref={headingRef} tabIndex={-1} className="font-head text-fluid-xl font-bold text-ink focus:outline-none">{title}</h2>
      <div className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-muted">{children}</div>
    </div>
  );
}

/** The two-line field grid used by most steps (one column on a phone). */
export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('grid grid-cols-1 gap-5 sm:grid-cols-2', className)}>{children}</div>;
}

/** A titled block inside a step («Sus datos», «Datos del alumno»). */
export function Block({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="space-y-5">
      {title ? <h3 className="border-b border-line pb-2 text-sm font-bold uppercase tracking-[0.1em] text-subtle">{title}</h3> : null}
      {children}
    </section>
  );
}
