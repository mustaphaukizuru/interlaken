/**
 * After the ficha is sent: what happens next (review, visit and assessment,
 * documents later) and the way on. `downloadSlot` is where «Descargar mi
 * ficha (PDF)» goes once its endpoint exists (FichaPdfSlot.tsx).
 *
 * One primary action (`doneVisit`, today «Ver los documentos requeridos»)
 * with an icon that follows where its link goes, then the other two links
 * (`donePrimary`, `doneSecondary`) as plain secondary links. The heading is
 * the page's h1: the hero is not on screen here.
 */
import type { ReactNode, Ref } from 'react';
import { ArrowRight, CalendarDays, CheckCircle2, CircleDollarSign, FileText } from 'lucide-react';
import { CmsAnchor } from '@/cms/sections/kit';
import type { FichaCopy } from './copy';

function withName(text: string, name: string): ReactNode {
  const parts = text.split('{nombre}');
  return parts.map((part, i) => <span key={i}>{i > 0 ? <strong className="text-ink">{name}</strong> : null}{part}</span>);
}

/** The primary action's icon from its destination (the school may point it elsewhere in Contenido). */
function HrefIcon({ href }: { href: string }) {
  const cls = 'h-5 w-5';
  if (/agendar|visita/.test(href)) return <CalendarDays className={cls} aria-hidden="true" />;
  if (/document/.test(href)) return <FileText className={cls} aria-hidden="true" />;
  if (/costo|pago/.test(href)) return <CircleDollarSign className={cls} aria-hidden="true" />;
  return <ArrowRight className={cls} aria-hidden="true" />;
}

const SECONDARY = 'inline-flex min-h-[44px] items-center gap-1.5 rounded-sm px-2 font-semibold text-purple underline underline-offset-4 hover:text-purple-mid focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40';

export function FichaDone({ copy, childName, headingRef, download }: {
  copy: FichaCopy;
  childName: string;
  headingRef?: Ref<HTMLHeadingElement>;
  download?: ReactNode;
}) {
  const steps = copy.list('doneSteps');
  const visit = copy.link('doneVisit');
  const primary = copy.link('donePrimary');
  const secondary = copy.link('doneSecondary');
  return (
    // break-words: a long name (or a long word in the school's copy) wraps inside the card at 390 px.
    <div className="card break-words p-6 sm:p-10">
      <div className="text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-sm bg-success-bg text-success" aria-hidden="true">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h1 ref={headingRef} tabIndex={-1} className="font-head text-fluid-2xl font-bold text-ink focus:outline-none">{copy.t('doneTitle')}</h1>
        <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-muted">{withName(copy.t('doneText'), childName)}</p>
      </div>
      {steps.length ? (
        <div className="mx-auto mt-8 max-w-md">
          <h2 className="text-sm font-bold uppercase tracking-[0.1em] text-subtle">{copy.t('doneStepsTitle')}</h2>
          <ol className="mt-3 space-y-3">
            {steps.map((s, i) => (
              <li key={s} className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-light text-sm font-bold text-purple" aria-hidden="true">{i + 1}</span>
                <span className="pt-0.5 text-base text-ink">{s}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <div className="mt-8 flex flex-col items-center gap-4">
        {visit.label ? (
          <CmsAnchor link={visit} className="btn-pink w-full justify-center sm:w-auto">
            <HrefIcon href={visit.href ?? ''} /> {visit.label}
          </CmsAnchor>
        ) : null}
        {download}
        <div className="flex flex-col items-center gap-x-6 sm:flex-row sm:flex-wrap sm:justify-center">
          {primary.label ? <CmsAnchor link={primary} className={SECONDARY}>{primary.label}</CmsAnchor> : null}
          {secondary.label ? <CmsAnchor link={secondary} className={SECONDARY}>{secondary.label}</CmsAnchor> : null}
        </div>
      </div>
    </div>
  );
}
