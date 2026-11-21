import { useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { FieldErrorMap } from '@/lib/apiErrors';
import { casesApi, useCaseWrite, type CaseAction, type CaseDetail } from '@/hooks/queries/cases';
import { ChoiceGroup, ErrorSummary, SaveStatus, SelectField, TextareaField, errorsFrom, useDraft } from './formKit';
import { ReadOnlyNote, gradeOptionsWith, relationshipOptionsWith, SentRow, cycleOptionsWith } from './caseBits';
import { StageCard } from './StageCard';
import type { StepState } from './StageBar';

const LABELS: Record<string, string> = {
  child_name: 'Nombre del alumno',
  parent_name: 'Tutor',
  parent_phone: 'Celular',
  parent_email: 'Correo',
  previous_school: 'Colegio de procedencia',
  child_age: 'Edad',
  grade_applying: 'Grado',
  cycle: 'Ciclo',
  relationship: 'Parentesco',
  referral_source: 'Cómo nos conoció',
  reason: 'Motivo',
  outcome: 'Resultado',
};

type Fields = {
  child_name: string;
  parent_name: string;
  parent_phone: string;
  parent_email: string;
  previous_school: string;
  child_age: string;
  grade_applying: string;
  cycle: string;
  relationship: string;
  referral_source: string;
};

export function informesSummary(d: CaseDetail): string {
  const parts = [
    d.informes.costs_sent_at ? 'Cuotas enviadas' : 'Cuotas sin enviar',
    d.informes.visit_link_sent_at ? 'liga de visita enviada' : '',
    d.informes.outcome_label && d.informes.outcome ? d.informes.outcome_label : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

/**
 * 1 · Informes: the seven details the office takes on the first call
 * (editable at any stage), sending the costs and the visit link, and the
 * outcome: «Continúa a visita guiada» or «No le interesa» (closes, with a reason).
 */
export function InformesCard({ detail, state, open, onToggle, onSend }: {
  detail: CaseDetail;
  state: StepState;
  open: boolean;
  onToggle: () => void;
  onSend: (action: CaseAction) => void;
}) {
  const openCase = detail.stage !== 'cerrado' && detail.stage !== 'inscrito';
  const server: Fields = {
    child_name: detail.child_name,
    parent_name: detail.parent_name,
    parent_phone: detail.parent_phone,
    parent_email: detail.parent_email,
    previous_school: detail.lead.previous_school,
    child_age: detail.lead.child_age == null ? '' : String(detail.lead.child_age),
    grade_applying: detail.grade_applying,
    cycle: detail.cycle,
    relationship: detail.lead.relationship,
    referral_source: detail.lead.referral_source,
  };
  const form = useDraft(server);
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const [saved, setSaved] = useState('');
  const [outcome, setOutcome] = useState<'' | 'continua_visita' | 'no_interesa'>('');
  const [reason, setReason] = useState('');
  const [outcomeErrors, setOutcomeErrors] = useState<FieldErrorMap>({});
  const [changing, setChanging] = useState(false);

  const patch = useCaseWrite(detail.id, (body: Record<string, unknown>) => casesApi.patchStage(detail.id, 'informes', body));
  const patchOutcome = useCaseWrite(detail.id, (body: Record<string, unknown>) => casesApi.patchStage(detail.id, 'informes', body));

  const save = () => {
    const body: Record<string, unknown> = { ...form.changed };
    if ('child_age' in body) body.child_age = form.value('child_age') === '' ? null : Number(form.value('child_age'));
    setErrors({});
    setSaved('');
    patch.mutate(body, {
      onSuccess: () => { form.reset(); setSaved('Datos guardados.'); toast.success('Datos de informes guardados.'); },
      onError: (e) => setErrors(errorsFrom(e)),
    });
  };

  const saveOutcome = () => {
    if (!outcome) { setOutcomeErrors({ outcome: 'Elija el resultado.' }); return; }
    if (outcome === 'no_interesa' && !reason.trim()) { setOutcomeErrors({ reason: 'Escriba el motivo: el expediente se cierra.' }); return; }
    setOutcomeErrors({});
    patchOutcome.mutate({ outcome, ...(outcome === 'no_interesa' ? { reason: reason.trim() } : {}) }, {
      onSuccess: (d) => {
        setOutcome('');
        setReason('');
        setChanging(false);
        toast.success(outcome === 'no_interesa' ? 'Expediente cerrado: no le interesa.' : `Resultado guardado. Expediente en «${d.stage_label}».`);
      },
      onError: (e) => setOutcomeErrors(errorsFrom(e)),
    });
  };

  const field = (k: keyof Fields) => ({
    value: form.value(k),
    onChange: (e: { target: { value: string } }) => { form.set(k, e.target.value); setSaved(''); },
    error: errors[k],
  });

  return (
    <StageCard stage="informes" state={state} open={open} onToggle={onToggle} summary={informesSummary(detail)}>
      <div className="grid gap-3 sm:grid-cols-2">
        <SentRow label="Cuotas del nivel (PDF)" sentAt={detail.informes.costs_sent_at} buttonLabel="Enviar cuotas"
          onSend={() => onSend('send-costs')} />
        <SentRow label="Liga para agendar la visita" sentAt={detail.informes.visit_link_sent_at} buttonLabel="Enviar liga de visita"
          onSend={() => onSend('send-visit-link')} disabled={!openCase} />
      </div>

      <form noValidate onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-4" aria-label="Datos de informes">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Nombre del alumno" id="inf-child" autoComplete="off" {...field('child_name')} />
          <Input label="Tutor" id="inf-parent" autoComplete="off" {...field('parent_name')} />
          <Input label="Celular" id="inf-phone" type="tel" inputMode="tel" autoComplete="off" {...field('parent_phone')} />
          <Input label="Correo (opcional)" id="inf-email" type="email" autoComplete="off" {...field('parent_email')} />
          <Input label="Colegio de procedencia" id="inf-school" autoComplete="off" {...field('previous_school')} />
          <Input label="Edad" id="inf-age" type="number" min={0} max={25} inputMode="numeric" {...field('child_age')} />
          <SelectField label="Grado al que ingresa" id="inf-grade" options={gradeOptionsWith(server.grade_applying)} {...field('grade_applying')} />
          <SelectField label="Ciclo" id="inf-cycle" options={cycleOptionsWith(server.cycle)} {...field('cycle')} />
          <SelectField label="Parentesco" id="inf-rel" placeholder="Sin dato" options={relationshipOptionsWith(server.relationship)} {...field('relationship')} />
          <Input label="Cómo nos conoció (opcional)" id="inf-ref" autoComplete="off" {...field('referral_source')} />
        </div>
        <ErrorSummary errors={errors} labels={LABELS} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="secondary" loading={patch.isPending} disabled={!form.dirty}>Guardar datos</Button>
          {form.dirty && <Button type="button" variant="ghost" onClick={() => { form.reset(); setErrors({}); }}>Descartar cambios</Button>}
          <SaveStatus message={saved} />
        </div>
      </form>

      <div className="space-y-3 rounded-xl2 border border-line p-4">
        <h3 className="font-semibold text-ink">Resultado de informes</h3>
        {detail.informes.outcome && (
          <p className="text-sm text-muted">Registrado: <strong className="text-ink">{detail.informes.outcome_label}</strong></p>
        )}
        {openCase && detail.informes.outcome && !changing ? (
          <Button type="button" size="sm" variant="ghost" className="!text-purple" onClick={() => setChanging(true)}>Cambiar el resultado</Button>
        ) : openCase ? (
          <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveOutcome(); }}>
            <ChoiceGroup
              legend="¿Cómo terminó la llamada de informes?"
              name="informes-outcome"
              value={outcome}
              onChange={(v) => { setOutcome(v); setOutcomeErrors({}); }}
              error={outcomeErrors.outcome}
              options={[
                { value: 'continua_visita', label: 'Continúa a visita guiada', hint: 'Pasa a «Visita guiada».' },
                { value: 'no_interesa', label: 'No le interesa', hint: 'Cierra el expediente (se puede reabrir).', tone: 'negative' },
              ]}
            />
            {outcome === 'no_interesa' && (
              <TextareaField label="Motivo (obligatorio)" id="inf-reason" value={reason} maxLength={500}
                onChange={(e) => { setReason(e.target.value); setOutcomeErrors({}); }} error={outcomeErrors.reason}
                placeholder="Busca un colegio con horario extendido." />
            )}
            {outcomeErrors.detail && <ErrorSummary errors={{ detail: outcomeErrors.detail }} labels={{}} />}
            <Button type="submit" variant={outcome === 'no_interesa' ? 'danger' : 'primary'} loading={patchOutcome.isPending} disabled={!outcome}>
              {outcome === 'no_interesa' ? 'Guardar y cerrar expediente' : 'Guardar resultado'}
            </Button>
          </form>
        ) : <ReadOnlyNote stage={detail.stage} />}
      </div>
    </StageCard>
  );
}

export default InformesCard;
