import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Link2, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { bookingsApi } from '@/services/api';
import { apiErrorStatus, type FieldErrorMap } from '@/lib/apiErrors';
import { fmtDay, phoneDigits } from '@/lib/caseStages';
import { casesApi, useCaseWrite, type CaseAction, type CaseBooking, type CaseDetail } from '@/hooks/queries/cases';
import { ChoiceGroup, ErrorSummary, SaveStatus, TextareaField, errorsFrom } from './formKit';
import { ReadOnlyNote, SentRow } from './caseBits';
import { StageCard } from './StageCard';
import type { StepState } from './StageBar';

type VisitOutcome = '' | 'agenda_examen' | 'no_interesa' | 'no_asistio';

const STATUS_TONE: Record<string, string> = {
  pending: 'bg-amber/10 text-amber ring-amber/30',
  confirmed: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  attended: 'bg-green-50 text-green-700 ring-green-600/20',
  no_show: 'bg-coral-50 text-coral-700 ring-coral-600/20',
  cancelled: 'bg-cream text-muted ring-subtle/25',
};

export function visitaSummary(d: CaseDetail): string {
  const b = d.visita.bookings[0];
  return [
    b ? `Visita ${fmtDay(b.date)}, ${b.start_time} (${b.status_label.toLowerCase()})` : 'Sin visita agendada',
    d.visita.outcome ? d.visita.outcome_label : '',
  ].filter(Boolean).join(' · ');
}

/**
 * 2 · Visita guiada: the visits linked to the case (the family books through
 * the link; the office can link one it booked by phone), the outcome
 * («Asistió y agenda examen», «Asistió, no le interesa», «No asistió» with
 * reagendar) and the reason when the outcome closes the case.
 */
export function VisitaCard({ detail, state, open, onToggle, onSend }: {
  detail: CaseDetail;
  state: StepState;
  open: boolean;
  onToggle: () => void;
  onSend: (action: CaseAction) => void;
}) {
  const openCase = detail.stage !== 'cerrado' && detail.stage !== 'inscrito';
  const [outcome, setOutcome] = useState<VisitOutcome>('');
  const [reschedule, setReschedule] = useState(true);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const [saved, setSaved] = useState('');
  const [linking, setLinking] = useState(false);
  const [changing, setChanging] = useState(false);
  const patch = useCaseWrite(detail.id, (body: Record<string, unknown>) => casesApi.patchStage(detail.id, 'visita', body));

  const closes = outcome === 'no_interesa' || (outcome === 'no_asistio' && !reschedule);
  const noteValue = note ?? detail.visita.note;

  const save = () => {
    if (!outcome && note === null) { setErrors({ outcome: 'Elija el resultado de la visita.' }); return; }
    if (closes && !reason.trim()) { setErrors({ reason: 'Escriba el motivo: el expediente se cierra.' }); return; }
    const body: Record<string, unknown> = {};
    if (outcome) body.outcome = outcome;
    if (outcome === 'no_asistio') body.reschedule = reschedule;
    if (closes) body.reason = reason.trim();
    if (note !== null && note !== detail.visita.note) body.note = note;
    setErrors({});
    patch.mutate(body, {
      onSuccess: (d) => {
        setOutcome(''); setReason(''); setNote(null); setChanging(false);
        setSaved('Guardado.');
        toast.success(closes ? 'Expediente cerrado.' : outcome ? `Resultado guardado. Expediente en «${d.stage_label}».` : 'Nota guardada.');
      },
      onError: (e) => setErrors(errorsFrom(e)),
    });
  };

  return (
    <StageCard stage="visita" state={state} open={open} onToggle={onToggle} summary={visitaSummary(detail)}>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-ink">Visitas del expediente</h3>
          {openCase && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setLinking(true)}>
              <Link2 size={15} aria-hidden="true" /> Vincular una visita
            </Button>
          )}
        </div>
        {detail.visita.bookings.length === 0 ? (
          <p className="rounded-md border border-dashed border-line px-3 py-4 text-sm text-subtle">
            Aún no hay visitas. Envíe la liga de visita: la que agende la familia aparece aquí.
          </p>
        ) : (
          <ul className="space-y-2" aria-label="Visitas vinculadas">
            {detail.visita.bookings.map((b) => <BookingLine key={b.id} booking={b} />)}
          </ul>
        )}
      </div>

      {openCase && (
        <SentRow label="Liga para agendar la visita" sentAt={detail.informes.visit_link_sent_at} buttonLabel="Enviar liga de visita"
          onSend={() => onSend('send-visit-link')} />
      )}

      <div className="space-y-3 rounded-md border border-line p-4">
        <h3 className="font-semibold text-ink">Resultado de la visita</h3>
        {detail.visita.outcome && (
          <p className="text-sm text-muted">Registrado: <strong className="text-ink">{detail.visita.outcome_label}</strong>
            {detail.visita.outcome_at ? ` · ${fmtDay(detail.visita.outcome_at)}` : ''}</p>
        )}
        {openCase && detail.visita.outcome && !changing ? (
          <div className="space-y-2">
            {detail.visita.note && <p className="text-sm text-ink">{detail.visita.note}</p>}
            <Button type="button" size="sm" variant="ghost" className="!text-purple" onClick={() => setChanging(true)}>Cambiar el resultado o la nota</Button>
          </div>
        ) : openCase ? (
          <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <ChoiceGroup
              legend="¿Cómo terminó la visita?"
              name="visit-outcome"
              value={outcome}
              onChange={(v) => { setOutcome(v); setErrors({}); setSaved(''); }}
              error={errors.outcome}
              options={[
                { value: 'agenda_examen', label: 'Asistió y agenda examen', hint: 'Pasa a «Examen».' },
                { value: 'no_interesa', label: 'Asistió, no le interesa', hint: 'Cierra el expediente.', tone: 'negative' },
                { value: 'no_asistio', label: 'No asistió', hint: 'Reagende o cierre.', tone: 'negative' },
              ]}
            />
            {outcome === 'no_asistio' && (
              <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm text-ink">
                <input type="checkbox" className="h-4 w-4 rounded-sm border-line text-purple focus:ring-purple/40"
                  checked={reschedule} onChange={(e) => setReschedule(e.target.checked)} />
                Reagendar la visita (la familia sigue interesada)
              </label>
            )}
            {closes && (
              <TextareaField label="Motivo del cierre (obligatorio)" id="visit-reason" value={reason} maxLength={500}
                onChange={(e) => { setReason(e.target.value); setErrors({}); }} error={errors.reason}
                placeholder="No respondió a dos llamadas para reagendar." />
            )}
            <TextareaField label="Nota de la visita (opcional)" id="visit-note" value={noteValue} maxLength={500}
              onChange={(e) => { setNote(e.target.value); setSaved(''); }} error={errors.note}
              placeholder="Vino con la abuela; preguntó por el transporte." />
            {(errors.detail || errors.booking) && <ErrorSummary errors={{ detail: errors.detail || errors.booking }} labels={{}} />}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant={closes ? 'danger' : 'primary'} loading={patch.isPending}
                disabled={!outcome && (note === null || note === detail.visita.note)}>
                {closes ? 'Guardar y cerrar expediente' : outcome ? 'Guardar resultado' : 'Guardar nota'}
              </Button>
              <SaveStatus message={saved} />
            </div>
          </form>
        ) : <ReadOnlyNote stage={detail.stage} />}
      </div>

      <LinkVisitDialog open={linking} onClose={() => setLinking(false)} detail={detail} />
    </StageCard>
  );
}

function BookingLine({ booking: b }: { booking: CaseBooking }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white px-3.5 py-2.5 text-sm shadow-card">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 font-semibold text-ink">
          <CalendarClock className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
          {fmtDay(b.date)}, {b.start_time} a {b.end_time}
        </p>
        <p className="pl-6 text-xs text-muted">
          {b.visit_type_label}{b.num_attendees > 1 ? ` · ${b.num_attendees} personas` : ''}
          {b.outcome_label ? ` · Resultado: ${b.outcome_label}` : ''}
        </p>
        {b.outcome_note && <p className="pl-6 text-xs text-ink">{b.outcome_note}</p>}
      </div>
      <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', STATUS_TONE[b.status] ?? STATUS_TONE.cancelled)}>
        {b.status_label}
      </span>
    </li>
  );
}

interface FoundBooking {
  id: number;
  slot_date: string;
  slot_start_time: string;
  visit_type: string;
  parent_name: string;
  parent_email: string;
  parent_phone: string;
  child_name: string;
  status: string;
}

/** Link a visit the office booked by phone (or before the case existed). */
function LinkVisitDialog({ open, onClose, detail }: { open: boolean; onClose: () => void; detail: CaseDetail }) {
  return (
    <Modal open={open} onClose={onClose} title="Vincular una visita" maxWidth={560}>
      <LinkVisitBody detail={detail} onClose={onClose} />
    </Modal>
  );
}

function LinkVisitBody({ detail, onClose }: { detail: CaseDetail; onClose: () => void }) {
  const initial = detail.parent_email || phoneDigits(detail.parent_phone) || detail.parent_name;
  const [term, setTerm] = useState(initial);
  const [q, setQ] = useState(initial);
  const [picked, setPicked] = useState<number | null>(null);
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const linked = new Set(detail.visita.bookings.map((b) => b.id));
  const search = useQuery({
    queryKey: ['admin', 'bookings', 'link-search', q],
    queryFn: async () => {
      const { data } = await bookingsApi.getAdminBookings({ q, page_size: 10, ordering: '-date' });
      return ((data.results ?? data) as FoundBooking[]).filter((b) => !linked.has(b.id));
    },
    enabled: q.trim().length >= 2,
    retry: false,
  });
  const patch = useCaseWrite(detail.id, (booking: number) => casesApi.patchStage(detail.id, 'visita', { booking }));
  const forbidden = apiErrorStatus(search.error) === 403;

  return (
    <div className="space-y-4">
      <form className="flex gap-2" role="search" onSubmit={(e) => { e.preventDefault(); setQ(term.trim()); setPicked(null); }}>
        <label htmlFor="link-visit-q" className="sr-only">Buscar visitas por celular, correo o nombre</label>
        <input id="link-visit-q" className="input-field flex-1" value={term} onChange={(e) => setTerm(e.target.value)}
          placeholder="Celular, correo o nombre" />
        <Button type="submit" variant="secondary"><Search size={16} aria-hidden="true" /> Buscar</Button>
      </form>
      <div aria-live="polite">
        {forbidden ? (
          <p className="rounded-md bg-amber/10 px-3 py-2 text-sm text-ink">Su cuenta no tiene acceso a Visitas. Pida a quien lleva la agenda que vincule la visita.</p>
        ) : search.isLoading ? (
          <p className="text-sm text-subtle">Buscando…</p>
        ) : search.isError ? (
          <p className="text-sm text-coral-700">No se pudo buscar. Intente de nuevo.</p>
        ) : search.data && search.data.length === 0 ? (
          <p className="text-sm text-subtle">No hay visitas sin vincular con «{q}».</p>
        ) : search.data ? (
          <fieldset>
            <legend className="label">Elija la visita</legend>
            <ul className="space-y-2">
              {search.data.map((b) => (
                <li key={b.id}>
                  <label className={clsx('flex min-h-[48px] cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm', picked === b.id ? 'border-purple bg-purple/5' : 'border-line')}>
                    <input type="radio" name="link-visit" className="mt-0.5" checked={picked === b.id} onChange={() => setPicked(b.id)} />
                    <span className="min-w-0 font-semibold text-ink">
                      {fmtDay(b.slot_date)}, {String(b.slot_start_time).slice(0, 5)} · {b.parent_name}
                      <span className="block break-words text-xs font-normal text-muted">{[b.child_name, b.parent_phone, b.parent_email].filter(Boolean).join(' · ')}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ) : null}
      </div>
      <ErrorSummary errors={errors} labels={{ booking: 'Visita' }} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button type="button" disabled={!picked} loading={patch.isPending} onClick={() => picked && patch.mutate(picked, {
          onSuccess: () => { toast.success('Visita vinculada al expediente.'); onClose(); },
          onError: (e) => setErrors(errorsFrom(e, 'No se pudo vincular la visita.')),
        })}>
          Vincular visita
        </Button>
      </div>
    </div>
  );
}

export default VisitaCard;
