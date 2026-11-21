/**
 * After the ficha is sent: what happens next (review, visit and assessment,
 * documents later) and the way on. `downloadSlot` is where «Descargar mi
 * ficha (PDF)» goes once its endpoint exists (FichaPdfSlot.tsx).
 */
import type { ReactNode, Ref } from 'react';
import { CalendarDays, CheckCircle2 } from 'lucide-react';
import { CmsAnchor } from '@/cms/sections/kit';
import type { FichaCopy } from './copy';

function withName(text: string, name: string): ReactNode {
  const parts = text.split('{nombre}');
  return parts.map((part, i) => <span key={i}>{i > 0 ? <strong className="text-ink">{name}</strong> : null}{part}</span>);
}

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
    <div className="card p-6 sm:p-10">
      <div className="text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-green-light text-green-dark" aria-hidden="true">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h2 ref={headingRef} tabIndex={-1} className="font-head text-fluid-2xl font-bold text-ink focus:outline-none">{copy.t('doneTitle')}</h2>
        <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-muted">{withName(copy.t('doneText'), childName)}</p>
      </div>
      {steps.length ? (
        <div className="mx-auto mt-8 max-w-md">
          <h3 className="text-sm font-bold uppercase tracking-[0.1em] text-subtle">{copy.t('doneStepsTitle')}</h3>
          <ol className="mt-3 space-y-3">
            {steps.map((s, i) => (
              <li key={s} className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-light text-sm font-bold text-purple" aria-hidden="true">{i + 1}</span>
                <span className="pt-0.5 text-[15px] text-ink">{s}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {download ? <div className="mt-8 flex justify-center">{download}</div> : null}
      <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
        <CmsAnchor link={visit} className="btn-pink">
          <CalendarDays className="h-4 w-4" aria-hidden="true" /> {visit.label}
        </CmsAnchor>
        <CmsAnchor link={primary} className="btn-outline">{primary.label}</CmsAnchor>
        <CmsAnchor link={secondary} className="btn inline-flex text-purple hover:bg-cream">{secondary.label}</CmsAnchor>
      </div>
    </div>
  );
}
