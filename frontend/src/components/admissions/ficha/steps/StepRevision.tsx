/**
 * Paso 7 · Revisión y firma: every answer grouped by step («Paso 1 de 7:
 * Información del alumno»…, then «Quién llena la ficha») with «Editar», the
 * short privacy paragraph with the link to the Aviso, the acceptance, the
 * photo consent and the full name typed as the signature.
 */
import { AlertCircle, Pencil } from 'lucide-react';
import { CmsAnchor } from '@/cms/sections/kit';
import { displayValue, isHidden, stepField } from '../choices';
import { numberedTitle } from '../copy';
import { Field } from '../fields';
import { useFichaForm } from '../context';
import { NumberedTitle } from '../parts';
import type { FieldErrors, Values } from '../types';

/** A section of the review; `number` («Paso 2 de 7») for the wizard's numbered steps. */
export interface ReviewSection { key: string; title: string; number?: string }

export function StepRevision({ sections, all, errors, incomplete, onEdit }: {
  sections: ReviewSection[];
  all: Record<string, Values>;
  errors: Record<string, FieldErrors>;
  /** Sections the completeness map or the server's answer marks as missing data. */
  incomplete: Set<string>;
  onEdit: (key: string) => void;
}) {
  const { schema, copy } = useFichaForm();
  const privacyLink = copy.link('privacyLink');
  return (
    <div className="space-y-8">
      <div className="space-y-4">
        {sections.map(({ key, title, number }) => {
          const step = schema.steps.find((s) => s.key === key);
          if (!step) return null;
          const values = all[key] ?? {};
          const skipped = step.skip_if && values[step.skip_if.field] === step.skip_if.equals;
          const sectionErrors = errors[key] ?? {};
          const rows = step.fields.filter((f) => f.name !== 'not_applicable' && !isHidden(f, values));
          const headingId = `review-${key}`;
          return (
            <section key={key} aria-labelledby={headingId} className="rounded-md bg-white shadow-card">
              <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
                <h3 id={headingId} className="min-w-0 break-words text-[15px] font-bold leading-snug text-ink">
                  <NumberedTitle number={number} title={title} />
                </h3>
                <button
                  type="button"
                  onClick={() => onEdit(key)}
                  className="-mr-2 inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-sm px-3 text-sm font-semibold text-purple hover:bg-cream focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
                  aria-label={`${copy.t('reviewEdit')}: ${numberedTitle(number, title)}`}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" /> {copy.t('reviewEdit')}
                </button>
              </div>
              {incomplete.has(key) || Object.keys(sectionErrors).length ? (
                <div className="flex items-start gap-2 border-b border-amber-bright/40 bg-amber-bright/10 px-4 py-2.5 text-sm text-ink">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="font-semibold">{copy.t('reviewMissing')}</p>
                    {Object.entries(sectionErrors).length ? (
                      <ul className="mt-1 space-y-0.5 text-muted">
                        {Object.entries(sectionErrors).map(([name, msg]) => (
                          <li key={name}>{stepField(step, name)?.label ?? name}: {msg}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {skipped ? (
                <p className="px-4 py-3 text-[15px] text-muted">{copy.t('reviewNotApplicable')}</p>
              ) : (
                <dl className="divide-y divide-line-2 px-4">
                  {rows.map((f) => {
                    const shown = displayValue(schema, f, values[f.name], { yes: copy.t('reviewYes'), no: copy.t('reviewNo') });
                    return (
                      <div key={f.name} className="grid grid-cols-1 gap-0.5 py-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
                        <dt className="text-sm text-muted">{f.label}</dt>
                        <dd className={shown === null ? 'text-sm italic text-subtle' : 'break-words text-[15px] text-ink'}>
                          {shown ?? copy.t('reviewEmpty')}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              )}
            </section>
          );
        })}
      </div>

      <section className="space-y-4 rounded-md border border-purple/20 bg-purple-light/30 p-4 sm:p-5">
        <h3 className="text-[15px] font-bold text-ink">{copy.t('privacyTitle')}</h3>
        <p className="text-[15px] leading-relaxed text-muted">
          {copy.t('privacyText')}{' '}
          {privacyLink.href ? (
            <CmsAnchor link={privacyLink} className="font-semibold text-purple underline underline-offset-2">{privacyLink.label}</CmsAnchor>
          ) : null}
        </p>
        <Field name="accept_privacy" as="checkbox" />
        <Field name="consent_photos_media" as="checkbox" />
        <h3 className="pt-2 text-[15px] font-bold text-ink">{copy.t('signTitle')}</h3>
        <Field name="signed_name" autoComplete="name" />
      </section>
    </div>
  );
}
