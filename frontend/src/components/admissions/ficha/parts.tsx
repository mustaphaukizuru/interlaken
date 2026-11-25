/**
 * Small shared pieces of the ficha: the heading of an unnumbered screen
 * (focused on every change), the numbered step title, the one-line error
 * notice at the top of a step (and the focus move to the first field with a
 * problem), the unsaved-changes warning, the «Guardado» status, the titled
 * blocks a step is made of and the full-width status panels (link sent,
 * closed start, invalid link…).
 */
import { forwardRef, useCallback, useEffect, useId, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, Check, CloudOff, Loader2 } from 'lucide-react';

/** h1 when the page's hero is not on screen (steps, review, confirmation), else h2 under the hero's h1. */
export type HeadingLevel = 1 | 2;

export const StepHeading = forwardRef<HTMLHeadingElement, { title: string; intro?: string; eyebrow?: string; level?: HeadingLevel }>(
  ({ title, intro, eyebrow, level = 2 }, ref) => {
    const H = level === 1 ? 'h1' : 'h2';
    return (
      // break-words: a long title from Contenido (one long word too) wraps at 390 px instead of leaving the card.
      <header className="mb-6 break-words">
        {eyebrow ? <p className="mb-1 text-xs font-bold uppercase tracking-[0.12em] text-pink">{eyebrow}</p> : null}
        <H ref={ref} tabIndex={-1} className="scroll-mt-28 font-head text-fluid-xl font-bold text-ink focus:outline-none">{title}</H>
        {intro ? <p className="mt-1.5 text-base leading-relaxed text-muted">{intro}</p> : null}
      </header>
    );
  },
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
          <span aria-hidden="true" className="mb-0.5 block text-xs font-bold uppercase leading-4 tracking-[0.12em] text-pink">{number}</span>
          <span className="sr-only">{number}: </span>
        </>
      ) : null}
      {title}
    </>
  );
}

export interface SummaryItem { id: string; label: string; message: string }

/**
 * One line at the top of a step: «Datos por revisar: 3» (or the server's
 * message when no field is to blame). Each field keeps its own message under
 * it; the focus goes to the first of them (`focusFirstInvalid`) and to this
 * line only when no field can take it. `children` (the review's sections to
 * correct) come under the line.
 */
export const ErrorSummary = forwardRef<HTMLDivElement, { line?: string; detail?: string; children?: ReactNode }>(
  ({ line, detail, children }, ref) => {
    if (!line && !children) return null;
    return (
      <div ref={ref} tabIndex={-1} role="alert" className="mb-6 rounded-sm bg-danger-bg px-3 py-2.5 text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-coral-400/40">
        {line ? (
          <p className="flex items-start gap-2 font-semibold">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <span>{line}</span>
          </p>
        ) : null}
        {detail ? <p className="mt-1 pl-7 text-sm">{detail}</p> : null}
        {children}
      </div>
    );
  },
);
ErrorSummary.displayName = 'ErrorSummary';

/**
 * Focus the first of these fields that is on screen, in the order the page
 * shows them (a radio group focuses its chosen or first option; «Otro país»
 * its text box), else `fallback` (the error line).
 */
export function focusFirstInvalid(ids: string[], fallback?: HTMLElement | null) {
  const els = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => !!el);
  els.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const el = els[0];
  if (!el) {
    fallback?.focus();
    return;
  }
  const target = el.tagName === 'FIELDSET'
    ? document.getElementById(`${el.id}-text`) ?? el.querySelector<HTMLElement>('input:checked') ?? el.querySelector<HTMLElement>('input') ?? el
    : el;
  el.scrollIntoView?.({ block: 'center' });
  target.focus({ preventScroll: true });
}

/** `request(ids, fallback)` moves the focus once the errors it set are on screen (after the next render). */
export function useFocusFirstInvalid() {
  const [tick, setTick] = useState(0);
  const pending = useRef<{ ids: string[]; fallback: RefObject<HTMLElement> } | null>(null);
  useEffect(() => {
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    focusFirstInvalid(next.ids, next.fallback.current);
  }, [tick]);
  return useCallback((ids: string[], fallback: RefObject<HTMLElement>) => {
    pending.current = { ids, fallback };
    setTick((t) => t + 1);
  }, []);
}

/**
 * The browser's «¿Salir del sitio?» prompt while the screen holds edits that
 * are not saved yet. `isUnsaved` is asked when the visitor leaves (so it may
 * read refs); the listener exists only while `active`. Nothing is saved or
 * sent here: it only warns.
 */
export function useUnsavedWarning(active: boolean, isUnsaved: () => boolean = () => true) {
  const check = useRef(isUnsaved);
  useEffect(() => { check.current = isUnsaved; });
  useEffect(() => {
    if (!active) return undefined;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!check.current()) return;
      e.preventDefault();
      // Older browsers show the prompt only when returnValue is set.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active]);
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** «Guardando…» / «Guardado» / «No se pudo guardar», announced politely. */
export function SaveStatus({ state, labels }: { state: SaveState; labels: { saving: string; saved: string; error: string } }) {
  return (
    <p role="status" aria-live="polite" className="flex min-h-[20px] items-center gap-1.5 text-sm font-medium">
      {state === 'saving' ? (
        <span className="inline-flex items-center gap-1.5 text-muted"><Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />{labels.saving}</span>
      ) : state === 'saved' ? (
        <span className="inline-flex items-center gap-1.5 text-success"><Check className="h-4 w-4" aria-hidden="true" />{labels.saved}</span>
      ) : state === 'error' ? (
        <span className="inline-flex items-center gap-1.5 text-danger"><CloudOff className="h-4 w-4" aria-hidden="true" />{labels.error}</span>
      ) : null}
    </p>
  );
}

/** A centred status screen (link sent, link invalid, start closed, already sent). */
export function Panel({ icon, tone = 'neutral', title, children, after, headingRef, level = 2 }: {
  icon: ReactNode;
  tone?: 'neutral' | 'success' | 'warn';
  title: string;
  children?: ReactNode;
  /** Left-aligned content under the message, in the same card (the «enlace nuevo» form). */
  after?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
  level?: HeadingLevel;
}) {
  const H = level === 1 ? 'h1' : 'h2';
  return (
    // break-words: the family's e-mail in «Guardamos su avance» (and any long word) used to run
    // past the card and the screen at 390 px; now it wraps inside the card.
    <div className="card break-words p-6 sm:p-10">
      <div className="text-center">
        <div className={clsx('mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-sm', {
          'bg-cream text-purple': tone === 'neutral',
          'bg-success-bg text-success': tone === 'success',
          'bg-danger-bg text-danger': tone === 'warn',
        })} aria-hidden="true">
          {icon}
        </div>
        <H ref={headingRef} tabIndex={-1} className="font-head text-fluid-xl font-bold text-ink focus:outline-none">{title}</H>
        <div className="mx-auto mt-3 max-w-md text-base leading-relaxed text-muted">{children}</div>
      </div>
      {after ? <div className="mx-auto mt-8 max-w-md">{after}</div> : null}
    </div>
  );
}

/** Two short fields side by side from 640 px (one column on a phone). */
export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('grid grid-cols-1 gap-5 sm:grid-cols-2', className)}>{children}</div>;
}

/** A field that only needs half the width from 640 px (a grade, a phone). */
export const HALF = 'sm:max-w-[50%] sm:pr-2.5';

/** The blocks of a step, one under the other. */
export function Blocks({ children }: { children: ReactNode }) {
  return <div className="space-y-10">{children}</div>;
}

/**
 * A titled block inside a step («Nombre», «Nacimiento», «Contacto») with a
 * one-line hint, so a long step reads as a few short groups. Only a visual
 * group: every block of a step still saves with that step. A screen reader
 * hears the title (and the hint) on entering the group; space (no rule)
 * separates it from what comes before.
 */
export function Block({ title, hint, children }: { title?: string; hint?: string; children: ReactNode }) {
  const id = useId();
  if (!title) return <div className="space-y-5">{children}</div>;
  return (
    <div
      role="group"
      aria-labelledby={`${id}-title`}
      aria-describedby={hint ? `${id}-hint` : undefined}
      className="space-y-5"
    >
      <div>
        <h2 id={`${id}-title`} className="font-head text-base font-bold leading-snug text-ink">{title}</h2>
        {hint ? <p id={`${id}-hint`} className="mt-0.5 text-sm leading-snug text-muted">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}
