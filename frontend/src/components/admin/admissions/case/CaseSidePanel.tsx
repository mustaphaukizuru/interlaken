import { useState } from 'react';
import { History, Mail, MessageCircle, Phone, StickyNote, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { waHref } from '@/lib/siteContact';
import type { FieldErrorMap } from '@/lib/apiErrors';
import { fmtDay, phoneDigits } from '@/lib/caseStages';
import { casesApi, useCaseWrite, type CaseDetail } from '@/hooks/queries/cases';
import { ErrorSummary, SaveStatus, TextareaField, errorsFrom } from './formKit';
import { InfoRow } from './caseBits';
import { CaseHistory } from './CaseHistory';

const LINK = 'inline-flex min-h-[44px] items-center gap-2 rounded-lg px-2 text-sm font-semibold text-purple hover:bg-purple/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40';

/** WhatsApp greeting the office starts from (the family's first name). */
export function greeting(d: CaseDetail): string {
  const first = (d.parent_name || '').split(' ')[0];
  return `Hola${first ? ` ${first}` : ''}, le saludamos del Colegio Interlaken.`;
}

export function waLink(d: CaseDetail): string | null {
  const digits = phoneDigits(d.parent_phone);
  return digits ? waHref(`52${digits}`, greeting(d)) : null;
}

/**
 * The right column of the Expediente (stacked under the cards below 1024 px):
 * how to reach the family, what the prospect told us, the office's internal
 * notes and the case history.
 */
export function CaseSidePanel({ detail }: { detail: CaseDetail }) {
  const digits = phoneDigits(detail.parent_phone);
  const wa = waLink(detail);
  const [notes, setNotes] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const patch = useCaseWrite(detail.id, (body: Record<string, unknown>) => casesApi.patchStage(detail.id, 'informes', body));
  const notesValue = notes ?? detail.lead.notes;

  return (
    <aside className="space-y-4" aria-label="Contacto, notas e historial">
      <section className="card space-y-3" aria-labelledby="case-contact">
        <h2 id="case-contact" className="flex items-center gap-2 font-head text-[15px] font-bold text-ink">
          <UserRound size={17} aria-hidden="true" /> Contacto
        </h2>
        <div>
          <p className="font-semibold text-ink">{detail.parent_name}</p>
          {detail.lead.relationship && <p className="text-xs text-muted">{detail.lead.relationship}</p>}
        </div>
        <ul className="space-y-0.5">
          {digits && (
            <li>
              <a href={`tel:+52${digits}`} className={LINK}><Phone size={16} aria-hidden="true" /> {detail.parent_phone}</a>
            </li>
          )}
          {wa && (
            <li>
              <a href={wa} target="_blank" rel="noopener noreferrer" className={LINK}><MessageCircle size={16} aria-hidden="true" /> WhatsApp</a>
            </li>
          )}
          {detail.parent_email ? (
            <li>
              <a href={`mailto:${detail.parent_email}`} className={`${LINK} break-all`}><Mail size={16} aria-hidden="true" /> {detail.parent_email}</a>
            </li>
          ) : <li className="px-2 text-sm text-subtle">Sin correo</li>}
        </ul>
        <dl className="grid grid-cols-2 gap-3 border-t border-line pt-3">
          <InfoRow label="Colegio de procedencia" className="col-span-2">{detail.lead.previous_school}</InfoRow>
          <InfoRow label="Edad">{detail.lead.child_age != null ? `${detail.lead.child_age} años` : ''}</InfoRow>
          <InfoRow label="Alta">{fmtDay(detail.created_at)}</InfoRow>
          <InfoRow label="Cómo nos conoció" className="col-span-2">{detail.lead.referral_source}</InfoRow>
          {detail.lead.message && <InfoRow label="Mensaje de la familia" className="col-span-2">{detail.lead.message}</InfoRow>}
        </dl>
      </section>

      <section className="card space-y-3" aria-labelledby="case-notes">
        <h2 id="case-notes" className="flex items-center gap-2 font-head text-[15px] font-bold text-ink">
          <StickyNote size={17} aria-hidden="true" /> Notas internas
        </h2>
        <TextareaField label="Solo para el colegio; la familia no las ve" id="case-notes-text" value={notesValue}
          onChange={(e) => { setNotes(e.target.value); setSaved(''); }} error={errors.notes} rows={4} />
        <ErrorSummary errors={errors} labels={{ notes: 'Notas' }} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" variant="secondary" loading={patch.isPending}
            disabled={notes === null || notes === detail.lead.notes}
            onClick={() => patch.mutate({ notes: notesValue }, {
              onSuccess: () => { setNotes(null); setSaved('Notas guardadas.'); setErrors({}); },
              onError: (e) => setErrors(errorsFrom(e)),
            })}>
            Guardar notas
          </Button>
          <SaveStatus message={saved} />
        </div>
      </section>

      <section className="card space-y-3" aria-labelledby="case-history">
        <h2 id="case-history" className="flex items-center gap-2 font-head text-[15px] font-bold text-ink">
          <History size={17} aria-hidden="true" /> Historial
        </h2>
        <CaseHistory entries={detail.history} />
      </section>
    </aside>
  );
}

export default CaseSidePanel;
