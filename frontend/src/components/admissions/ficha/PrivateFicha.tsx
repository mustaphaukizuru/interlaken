/**
 * /pre-registro without a personal link: «La ficha de inscripción es
 * personal». The school sends the ficha to each family after the admission
 * exam, once the child is admitted (Expediente «Enviar resultado y ficha»).
 * This panel shows the three steps that lead there, the way to start (a
 * visit, or WhatsApp for informes) and, for a family whose link expired, a
 * new one by email (ResumeForm), all in one card. Every word is a CMS
 * prop (copy.ts «Ficha personal (sin enlace)»). Its heading is an h2 under
 * the hero's h1.
 */
import type { Ref } from 'react';
import { CalendarDays, Lock } from 'lucide-react';
import { CmsAnchor } from '@/cms/sections/kit';
import { WhatsAppIcon } from '@/components/icons/WhatsAppIcon';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { waHref } from '@/lib/siteContact';
import type { FichaCopy } from './copy';
import { ResumeForm } from './ResumeForm';

export function PrivateFicha({ copy, headingRef }: { copy: FichaCopy; headingRef?: Ref<HTMLHeadingElement> }) {
  const site = useSiteSettings();
  const steps = copy.list('privateSteps');
  const visit = copy.link('privateVisit');
  const wa = site.whatsapp_number ? waHref(site.whatsapp_number, copy.t('privateWaMessage')) : '';
  const stepsId = 'ficha-private-steps';
  return (
    <>
      <section className="card break-words p-6 sm:p-10" aria-labelledby="ficha-private-title">
        <div className="text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-sm bg-cream text-purple" aria-hidden="true">
            <Lock className="h-8 w-8" />
          </div>
          <h2 id="ficha-private-title" ref={headingRef} tabIndex={-1} className="font-head text-fluid-xl font-bold text-ink focus:outline-none">
            {copy.t('privateTitle')}
          </h2>
          <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-muted">{copy.t('privateText')}</p>
        </div>
        {steps.length ? (
          <div className="mx-auto mt-8 max-w-md">
            <h3 id={stepsId} className="text-sm font-bold uppercase tracking-[0.1em] text-subtle">{copy.t('privateStepsTitle')}</h3>
            <ol className="mt-3 space-y-3" aria-labelledby={stepsId}>
              {steps.map((s, i) => (
                <li key={`${i}-${s}`} className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-light text-sm font-bold text-purple" aria-hidden="true">{i + 1}</span>
                  <span className="pt-0.5 text-base text-ink">{s}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
          <CmsAnchor link={visit} className="btn-pink min-h-[44px] justify-center">
            <CalendarDays className="h-5 w-5" aria-hidden="true" /> {visit.label}
          </CmsAnchor>
          {wa ? (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-outline min-h-[44px] justify-center">
              <WhatsAppIcon className="h-5 w-5" aria-hidden="true" /> {copy.t('privateWhatsapp')}
            </a>
          ) : null}
        </div>
        {site.phone_display && site.phone_e164 ? (
          <p className="mt-4 text-center text-sm text-subtle">
            {copy.t('privateCall')}{' '}
            <a href={`tel:${site.phone_e164}`} className="inline-flex min-h-[44px] items-center font-semibold text-purple underline underline-offset-2">
              {site.phone_display}
            </a>
          </p>
        ) : null}
        <div className="mx-auto mt-8 max-w-md"><ResumeForm copy={copy} /></div>
      </section>
    </>
  );
}
