import { useState } from 'react';
import { FileSignature, Info, Lock } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import type { FieldErrorMap } from '@/lib/apiErrors';
import { fmtDay, fmtDayTime, fromLocalInput, toLocalInput } from '@/lib/caseStages';
import { casesApi, useCaseWrite, type CaseAction, type CaseDetail } from '@/hooks/queries/cases';
import { ChoiceGroup, ErrorSummary, SaveStatus, TextareaField, errorsFrom } from './formKit';
import { ReadOnlyNote, SentRow } from './caseBits';
import { StageCard } from './StageCard';
import type { StepState } from './StageBar';

const LABELS: Record<string, string> = {
  exam_at: 'Fecha del examen',
  exam_results_at: 'Entrega de resultados',
  exam_notes: 'Notas',
  result: 'Resultado',
  reason: 'Motivo',
};

export function examenSummary(d: CaseDetail): string {
  return [
    d.examen.exam_at ? `Examen ${fmtDayTime(d.examen.exam_at)}` : 'Sin fecha de examen',
    d.examen.result ? d.examen.result_label : '',
    d.ficha_link.sent_at ? 'ficha enviada' : '',
  ].filter(Boolean).join(' · ');
}

/**
 * 3 · Examen: date and time, notes, when the results are given, the result
 * (Aceptado / No aceptado with a reason, which closes the case) and the
 * messages: exam date and result. The ficha de inscripción is private: its
 * link goes out only once the result is «Aceptado», in the same message as
 * the result («Enviar resultado y ficha»); «Enviar ficha de inscripción»
 * resends it. Before «Aceptado» the button stays disabled with the reason
 * (an administrator may override it with a written reason).
 */
export function ExamenCard({ detail, state, open, onToggle, onSend }: {
  detail: CaseDetail;
  state: StepState;
  open: boolean;
  onToggle: () => void;
  onSend: (action: CaseAction) => void;
}) {
  const openCase = detail.stage !== 'cerrado' && detail.stage !== 'inscrito';
  const [examAt, setExamAt] = useState<string | null>(null);
  const [resultsAt, setResultsAt] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const [saved, setSaved] = useState('');
  const [result, setResult] = useState<'' | 'aceptado' | 'no_aceptado'>('');
  const [reason, setReason] = useState('');
  const [resultErrors, setResultErrors] = useState<FieldErrorMap>({});
  const [changing, setChanging] = useState(false);

  const patch = useCaseWrite(detail.id, (body: Record<string, unknown>) => casesApi.patchStage(detail.id, 'examen', body));
  const patchResult = useCaseWrite(detail.id, (body: Record<string, unknown>) => casesApi.patchStage(detail.id, 'examen', body));

  const examValue = examAt ?? toLocalInput(detail.examen.exam_at);
  const resultsValue = resultsAt ?? toLocalInput(detail.examen.exam_results_at);
  const notesValue = notes ?? detail.examen.exam_notes;
  const dirty = examAt !== null || resultsAt !== null || notes !== null;

  const save = () => {
    const body: Record<string, unknown> = {};
    if (examAt !== null) body.exam_at = fromLocalInput(examAt);
    if (resultsAt !== null) body.exam_results_at = fromLocalInput(resultsAt);
    if (notes !== null) body.exam_notes = notes;
    if (examValue && resultsValue && resultsValue < examValue) {
      setErrors({ exam_results_at: 'La entrega de resultados debe ser después del examen.' });
      return;
    }
    setErrors({});
    setSaved('');
    patch.mutate(body, {
      onSuccess: (d) => {
        setExamAt(null); setResultsAt(null); setNotes(null);
        setSaved('Guardado.');
        toast.success(d.stage === 'examen' && detail.stage !== 'examen' ? 'Examen agendado. Expediente en «Examen».' : 'Examen guardado.');
      },
      onError: (e) => setErrors(errorsFrom(e)),
    });
  };

  const saveResult = () => {
    if (!result) { setResultErrors({ result: 'Elija el resultado.' }); return; }
    if (result === 'no_aceptado' && !reason.trim()) { setResultErrors({ reason: 'Escriba el motivo: el expediente se cierra.' }); return; }
    setResultErrors({});
    patchResult.mutate({ result, ...(result === 'no_aceptado' ? { reason: reason.trim() } : {}) }, {
      onSuccess: (d) => {
        setResult(''); setReason(''); setChanging(false);
        toast.success(result === 'no_aceptado'
          ? 'Expediente cerrado: no aceptado.'
          : `Aceptado. Expediente en «${d.stage_label}». Siguiente paso: enviar el resultado y la ficha.`);
      },
      onError: (e) => setResultErrors(errorsFrom(e)),
    });
  };

  const gate = detail.ficha_link;
  const scheduled = !!detail.examen.exam_at;
  // «Aceptado» and the link may go out: one message carries the result and the ficha.
  const resultWithFicha = detail.examen.result === 'aceptado' && gate.allowed;

  return (
    <StageCard stage="examen" state={state} open={open} onToggle={onToggle} summary={examenSummary(detail)}>
      {openCase ? (
        <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }} aria-label="Fecha del examen">
          <div className="grid gap-3 sm:grid-cols-2">
            <DateTimeField id="exam-at" label="Fecha y hora del examen" value={examValue} error={errors.exam_at}
              onChange={(v) => { setExamAt(v); setSaved(''); }} />
            <DateTimeField id="exam-results-at" label="Entrega de resultados (opcional)" value={resultsValue} error={errors.exam_results_at}
              onChange={(v) => { setResultsAt(v); setSaved(''); }} />
          </div>
          <TextareaField label="Notas del examen (opcional)" id="exam-notes" value={notesValue} error={errors.exam_notes}
            onChange={(e) => { setNotes(e.target.value); setSaved(''); }} placeholder="Traer lápiz y goma. Dura 2 horas." />
          <ErrorSummary errors={errors} labels={LABELS} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="secondary" loading={patch.isPending} disabled={!dirty}>
              {scheduled ? 'Guardar cambios' : 'Agendar examen'}
            </Button>
            <SaveStatus message={saved} />
          </div>
        </form>
      ) : (
        <dl className="grid gap-3 sm:grid-cols-2 text-sm">
          <div><dt className="text-xs text-subtle">Examen</dt><dd className="text-ink">{fmtDayTime(detail.examen.exam_at) || 'Sin fecha'}</dd></div>
          <div><dt className="text-xs text-subtle">Entrega de resultados</dt><dd className="text-ink">{fmtDayTime(detail.examen.exam_results_at) || 'Sin fecha'}</dd></div>
          {detail.examen.exam_notes && <div className="sm:col-span-2"><dt className="text-xs text-subtle">Notas</dt><dd className="whitespace-pre-line text-ink">{detail.examen.exam_notes}</dd></div>}
        </dl>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <SentRow label="Fecha del examen a la familia" sentAt={detail.examen.date_sent_at} buttonLabel="Enviar fecha"
          onSend={() => onSend('send-exam-date')} disabled={!scheduled || !openCase} hint={scheduled ? 'Sin enviar' : 'Agende primero el examen'} />
        <SentRow label={resultWithFicha ? 'Resultado y ficha a la familia' : 'Resultado a la familia'} sentAt={detail.examen.result_sent_at}
          buttonLabel={resultWithFicha ? 'Enviar resultado y ficha' : 'Enviar resultado'}
          onSend={() => onSend('send-exam-result')} disabled={!detail.examen.result}
          hint={!detail.examen.result ? 'Registre primero el resultado' : resultWithFicha ? 'Sin enviar: lleva la liga de la ficha' : 'Sin enviar'} />
      </div>

      <div className="space-y-3 rounded-md border border-line p-4">
        <h3 className="font-semibold text-ink">Resultado del examen</h3>
        {detail.examen.result && (
          <p className="text-sm text-muted">Registrado: <strong className="text-ink">{detail.examen.result_label}</strong>
            {detail.examen.reason ? ` · ${detail.examen.reason}` : ''}</p>
        )}
        {openCase && detail.examen.result && !changing ? (
          <Button type="button" size="sm" variant="ghost" className="!text-purple" onClick={() => setChanging(true)}>Cambiar el resultado</Button>
        ) : openCase ? (
          <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveResult(); }}>
            <ChoiceGroup
              legend="Resultado"
              name="exam-result"
              value={result}
              disabled={!scheduled}
              onChange={(v) => { setResult(v); setResultErrors({}); }}
              error={resultErrors.result}
              options={[
                { value: 'aceptado', label: 'Aceptado', hint: 'Pasa a «Documentación y acuerdos» y habilita la ficha de inscripción.' },
                { value: 'no_aceptado', label: 'No aceptado', hint: 'Cierra el expediente.', tone: 'negative' },
              ]}
            />
            {!scheduled && <p className="text-xs text-muted">Agende primero la fecha del examen.</p>}
            {result === 'no_aceptado' && (
              <TextareaField label="Motivo (obligatorio)" id="exam-reason" value={reason} maxLength={500}
                onChange={(e) => { setReason(e.target.value); setResultErrors({}); }} error={resultErrors.reason}
                hint="Solo para el expediente: no se envía a la familia." />
            )}
            {resultErrors.detail && <ErrorSummary errors={{ detail: resultErrors.detail }} labels={{}} />}
            <Button type="submit" variant={result === 'no_aceptado' ? 'danger' : 'primary'} loading={patchResult.isPending} disabled={!result || !scheduled}>
              {result === 'no_aceptado' ? 'Guardar y cerrar expediente' : 'Guardar resultado'}
            </Button>
          </form>
        ) : <ReadOnlyNote stage={detail.stage} />}
      </div>

      <div className="space-y-3 rounded-md bg-cream-2 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 font-semibold text-ink"><FileSignature size={16} aria-hidden="true" /> Ficha de inscripción</h3>
            <p className="mt-0.5 text-sm text-muted">
              {gate.sent_at ? `Liga enviada el ${fmtDayTime(gate.sent_at)}.` : 'Liga sin enviar.'}
              {detail.ficha?.invite_expires_at && !detail.ficha.invite_used_at && detail.ficha.status === 'draft'
                ? ` Vence el ${fmtDay(detail.ficha.invite_expires_at)}.` : ''}
              {detail.ficha && detail.ficha.status !== 'draft' ? ` La familia la envió (${detail.ficha.status_label.toLowerCase()}).` : ''}
            </p>
          </div>
          <Button type="button" variant="secondary"
            onClick={() => onSend('send-ficha-link')} disabled={!gate.allowed && !gate.can_override}
            aria-describedby={!gate.allowed && gate.reason ? 'ficha-link-reason' : undefined}>
            {gate.sent_at ? 'Reenviar ficha de inscripción' : 'Enviar ficha de inscripción'}
          </Button>
        </div>
        <p id="ficha-link-reason" role="status" aria-live="polite" className="flex items-start gap-2 text-xs text-muted">
          {!gate.allowed && gate.reason ? (
            <>
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber" aria-hidden="true" />
              <span>{gate.reason}{gate.can_override ? ' Como administrador puede enviarla antes, con un motivo.' : ''}</span>
            </>
          ) : gate.allowed && !gate.sent_at && !detail.examen.result_sent_at ? (
            <>
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-purple" aria-hidden="true" />
              <span>La liga va con el resultado: use «Enviar resultado y ficha».</span>
            </>
          ) : null}
        </p>
      </div>
    </StageCard>
  );
}

function DateTimeField({ id, label, value, onChange, error }: {
  id: string; label: string; value: string; onChange: (v: string) => void; error?: string;
}) {
  return (
    <div className="w-full">
      <label htmlFor={id} className="label">{label}</label>
      <input
        id={id}
        type="datetime-local"
        className="input-field"
        value={value}
        step={300}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <p id={`${id}-error`} className="mt-1.5 text-xs text-coral-600">{error}</p>}
    </div>
  );
}

export default ExamenCard;
