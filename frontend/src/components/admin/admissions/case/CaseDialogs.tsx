import { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import type { FieldErrorMap } from '@/lib/apiErrors';
import { CLOSE_OUTCOMES, OPEN_STAGES, stageIndex, stageMeta } from '@/lib/caseStages';
import { casesApi, useCaseWrite, type CaseDetail } from '@/hooks/queries/cases';
import { ErrorSummary, SelectField, TextareaField, errorsFrom } from './formKit';

const FOOTER = 'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end';

/** «Cambiar etapa»: forward moves are free, going back needs a note (audited). */
export function MoveDialog({ open, onClose, detail }: { open: boolean; onClose: () => void; detail: CaseDetail }) {
  return (
    <Modal open={open} onClose={onClose} title="Cambiar de etapa" maxWidth={480}>
      <MoveBody detail={detail} onClose={onClose} />
    </Modal>
  );
}

function MoveBody({ detail, onClose }: { detail: CaseDetail; onClose: () => void }) {
  const options = OPEN_STAGES.filter((s) => s !== detail.stage).map((s) => ({ value: s, label: stageMeta(s).label }));
  const [stage, setStage] = useState<string>(options[0]?.value ?? '');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const back = stageIndex(stage) < stageIndex(detail.stage);
  const move = useCaseWrite(detail.id, (v: { stage: string; note: string }) => casesApi.move(detail.id, v));

  const submit = () => {
    if (back && !note.trim()) { setErrors({ note: 'Escriba por qué regresa el expediente.' }); return; }
    move.mutate({ stage, note: note.trim() }, {
      onSuccess: (d) => { toast.success(`Expediente en «${d.stage_label}».`); onClose(); },
      onError: (e) => setErrors(errorsFrom(e, 'No se pudo cambiar la etapa.')),
    });
  };

  return (
    <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <p className="text-sm text-muted">
        Normalmente la etapa avanza sola al registrar cada resultado. Use esto para corregir. Para cerrar o inscribir use sus propios botones.
      </p>
      <SelectField label="Nueva etapa" value={stage} options={options} onChange={(e) => { setStage(e.target.value); setErrors({}); }} error={errors.stage} />
      <TextareaField
        label={back ? 'Motivo del regreso (obligatorio)' : 'Nota (opcional)'}
        value={note}
        maxLength={500}
        onChange={(e) => { setNote(e.target.value); setErrors({}); }}
        error={errors.note}
        hint="Queda en el historial del expediente."
      />
      <ErrorSummary errors={errors.detail ? { detail: errors.detail } : {}} labels={{}} />
      <div className={FOOTER}>
        <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button type="submit" loading={move.isPending} disabled={!stage}>Cambiar etapa</Button>
      </div>
    </form>
  );
}

/** «Cerrar expediente»: outcome and reason (required); it can be reopened later. */
export function CloseDialog({ open, onClose, detail, defaultOutcome = 'no_interesa' }: {
  open: boolean; onClose: () => void; detail: CaseDetail; defaultOutcome?: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Cerrar expediente" maxWidth={480}>
      <CloseBody detail={detail} onClose={onClose} defaultOutcome={defaultOutcome} />
    </Modal>
  );
}

function CloseBody({ detail, onClose, defaultOutcome }: { detail: CaseDetail; onClose: () => void; defaultOutcome: string }) {
  const [outcome, setOutcome] = useState(defaultOutcome);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const close = useCaseWrite(detail.id, (v: { outcome: string; reason: string }) => casesApi.close(detail.id, v));

  const submit = () => {
    if (!reason.trim()) { setErrors({ reason: 'Escriba el motivo del cierre.' }); return; }
    close.mutate({ outcome, reason: reason.trim() }, {
      onSuccess: () => { toast.success('Expediente cerrado.'); onClose(); },
      onError: (e) => setErrors(errorsFrom(e, 'No se pudo cerrar el expediente.')),
    });
  };

  return (
    <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <p className="text-sm text-muted">
        El expediente de {detail.child_name} deja de aparecer entre los activos. Podrá reabrirlo cuando la familia regrese.
      </p>
      <SelectField label="Motivo de cierre" value={outcome} options={CLOSE_OUTCOMES} onChange={(e) => setOutcome(e.target.value)} error={errors.outcome} />
      <TextareaField label="Detalle (obligatorio)" value={reason} maxLength={500}
        onChange={(e) => { setReason(e.target.value); setErrors({}); }} error={errors.reason}
        placeholder="Eligió otro colegio por la distancia." />
      <ErrorSummary errors={errors.detail ? { detail: errors.detail } : {}} labels={{}} />
      <div className={FOOTER}>
        <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button type="submit" variant="danger" loading={close.isPending}>Cerrar expediente</Button>
      </div>
    </form>
  );
}

/** «Reabrir»: back to the stage it was closed in (or another open one), with a note. */
export function ReopenDialog({ open, onClose, detail }: { open: boolean; onClose: () => void; detail: CaseDetail }) {
  return (
    <Modal open={open} onClose={onClose} title="Reabrir expediente" maxWidth={480}>
      <ReopenBody detail={detail} onClose={onClose} />
    </Modal>
  );
}

function ReopenBody({ detail, onClose }: { detail: CaseDetail; onClose: () => void }) {
  const from = detail.closed?.from_stage && OPEN_STAGES.includes(detail.closed.from_stage as never) ? detail.closed.from_stage : 'informes';
  const [stage, setStage] = useState(from);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const reopen = useCaseWrite(detail.id, (v: { note: string; stage: string }) => casesApi.reopen(detail.id, v));

  const submit = () => {
    if (!note.trim()) { setErrors({ note: 'Escriba por qué se reabre.' }); return; }
    reopen.mutate({ note: note.trim(), stage }, {
      onSuccess: (d) => { toast.success(`Expediente reabierto en «${d.stage_label}».`); onClose(); },
      onError: (e) => setErrors(errorsFrom(e, 'No se pudo reabrir el expediente.')),
    });
  };

  return (
    <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <SelectField label="Reabrir en la etapa" value={stage}
        options={OPEN_STAGES.map((s) => ({ value: s, label: `${stageMeta(s).label}${s === from ? ' (donde se cerró)' : ''}` }))}
        onChange={(e) => setStage(e.target.value)} error={errors.stage} />
      <TextareaField label="Motivo (obligatorio)" value={note} maxLength={500}
        onChange={(e) => { setNote(e.target.value); setErrors({}); }} error={errors.note}
        placeholder="La familia volvió a llamar para agendar la visita." />
      <ErrorSummary errors={errors.detail ? { detail: errors.detail } : {}} labels={{}} />
      <div className={FOOTER}>
        <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button type="submit" loading={reopen.isPending}>Reabrir expediente</Button>
      </div>
    </form>
  );
}
