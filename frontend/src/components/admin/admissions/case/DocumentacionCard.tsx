import { useState } from 'react';
import { CheckCircle2, CircleAlert, Eye, FileSignature, Info, Lock, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { DocumentChecklist } from '@/components/admin/admissions/DocumentChecklist';
import { RegistrationReviewModal } from '@/components/admin/RegistrationReviewModal';
import type { FieldErrorMap } from '@/lib/apiErrors';
import { fmtDay } from '@/lib/caseStages';
import { casesApi, useCaseWrite, type CaseAction, type CaseDetail, type DocumentsState } from '@/hooks/queries/cases';
import { ErrorSummary, SaveStatus, TextareaField, errorsFrom } from './formKit';
import { ReadOnlyNote } from './caseBits';
import { DiscountEditor } from './DiscountEditor';
import { StageCard } from './StageCard';
import type { StepState } from './StageBar';

const DOC_STATE: Record<DocumentsState['state'], { label: string; icon: typeof CheckCircle2; cls: string }> = {
  complete: { label: 'Documentos completos', icon: CheckCircle2, cls: 'bg-green-50 text-green-700' },
  waived: { label: 'Documentos dispensados', icon: ShieldCheck, cls: 'bg-brand-50 text-brand-700' },
  incomplete: { label: 'Faltan documentos', icon: CircleAlert, cls: 'bg-amber/10 text-amber' },
  unknown: { label: 'Revisión manual', icon: Info, cls: 'bg-cream text-muted' },
};

/** «4 de 7 secciones completas» from the ficha's completeness. */
export function fichaProgress(d: CaseDetail): string {
  const sections = d.ficha?.completeness?.sections;
  if (!sections) return '';
  const all = Object.values(sections);
  return `${all.filter((s) => s.complete).length} de ${all.length} secciones completas`;
}

export function documentacionSummary(d: CaseDetail): string {
  const docs = d.ficha?.documents ?? null;
  const n = d.documentacion.discounts.length;
  return [
    d.ficha ? `Ficha ${d.ficha.status_label.toLowerCase()}` : 'Sin ficha',
    docs ? DOC_STATE[docs.state].label.toLowerCase() : '',
    n ? `${n} ${n === 1 ? 'beca o descuento' : 'becas o descuentos'}` : '',
  ].filter(Boolean).join(' · ');
}

/**
 * 4 · Documentación y acuerdos: the family's ficha (status, progress,
 * «Revisar ficha»), the documents of its level (Fase 4 checklist, two
 * columns), the administrator's waiver, the becas y descuentos agreed and a
 * note of other agreements.
 */
export function DocumentacionCard({ detail, state, open, onToggle, onSend, isAdmin }: {
  detail: CaseDetail;
  state: StepState;
  open: boolean;
  onToggle: () => void;
  onSend: (action: CaseAction) => void;
  isAdmin: boolean;
}) {
  const openCase = detail.stage !== 'cerrado' && detail.stage !== 'inscrito';
  const [reviewing, setReviewing] = useState(false);
  const [waiving, setWaiving] = useState(false);
  const [agreements, setAgreements] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const patch = useCaseWrite(detail.id, (body: Record<string, unknown>) => casesApi.patchStage(detail.id, 'documentacion', body));
  const ficha = detail.ficha;
  const docs = ficha?.documents ?? null;
  const docMeta = docs ? DOC_STATE[docs.state] : null;
  const DocIcon = docMeta?.icon ?? Info;
  const agreementsValue = agreements ?? detail.documentacion.agreements_note;
  const gate = detail.ficha_link;
  // The first ficha link goes with the «Aceptado» result (one message).
  const resultWithFicha = gate.allowed && detail.examen.result === 'aceptado' && !detail.examen.result_sent_at && !gate.sent_at;

  const saveAgreements = () => {
    setErrors({});
    patch.mutate({ agreements_note: agreementsValue }, {
      onSuccess: () => { setAgreements(null); setSaved('Acuerdos guardados.'); },
      onError: (e) => setErrors(errorsFrom(e)),
    });
  };

  const unwaive = () => patch.mutate({ documents_waived: false }, {
    onSuccess: () => toast.success('Se quitó la dispensa: los documentos vuelven a contar.'),
    onError: (e) => toast.error(errorsFrom(e).detail ?? 'No se pudo quitar la dispensa.'),
  });

  return (
    <StageCard stage="documentacion" state={state} open={open} onToggle={onToggle} summary={documentacionSummary(detail)}>
      <div className="rounded-xl2 border border-line p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 font-semibold text-ink"><FileSignature size={17} aria-hidden="true" /> Ficha de inscripción</h3>
            {ficha ? (
              <p className="mt-0.5 text-sm text-muted">
                <span className="font-semibold text-ink">{ficha.status_label}</span>
                {ficha.submitted_at ? ` · enviada el ${fmtDay(ficha.submitted_at)}` : ''}
                {fichaProgress(detail) ? ` · ${fichaProgress(detail)}` : ''}
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-muted">
                {resultWithFicha
                  ? 'Todavía no hay ficha. Envíe el resultado con la liga de la ficha para que la familia la llene.'
                  : 'Todavía no hay ficha. Envíe la liga para que la familia la llene.'}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {ficha && (
              <Button type="button" size="sm" variant="secondary" onClick={() => setReviewing(true)}>
                <Eye size={15} aria-hidden="true" /> Revisar ficha
              </Button>
            )}
            {openCase && (!ficha || ficha.status === 'draft') && (resultWithFicha ? (
              <Button type="button" onClick={() => onSend('send-exam-result')}>Enviar resultado y ficha</Button>
            ) : (
              <Button type="button" onClick={() => onSend('send-ficha-link')}
                disabled={!gate.allowed && !gate.can_override}
                aria-describedby={!gate.allowed && gate.reason ? 'docs-ficha-reason' : undefined}>
                {gate.sent_at ? 'Reenviar liga de la ficha' : 'Enviar liga de la ficha'}
              </Button>
            ))}
          </div>
        </div>
        {openCase && !gate.allowed && gate.reason && (!ficha || ficha.status === 'draft') && (
          <p id="docs-ficha-reason" className="mt-2 flex items-start gap-2 text-xs text-muted">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber" aria-hidden="true" />
            <span>{gate.reason}{gate.can_override ? ' Como administrador puede enviarla antes, con un motivo.' : ''}</span>
          </p>
        )}
      </div>

      {docs && docMeta && (
        <div className={clsx('flex flex-wrap items-start justify-between gap-3 rounded-xl px-3.5 py-3', docMeta.cls)}>
          <p className="flex min-w-0 items-start gap-2 text-sm">
            <DocIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              <strong>{docMeta.label}</strong>
              {docs.detail ? <span className="block text-ink">{docs.detail}</span> : null}
              {docs.state === 'waived' && detail.documentacion.documents_waived_at
                ? <span className="block text-xs text-muted">Desde el {fmtDay(detail.documentacion.documents_waived_at)}</span> : null}
            </span>
          </p>
          {isAdmin && openCase && (docs.state === 'waived'
            ? <Button type="button" size="sm" variant="ghost" onClick={unwaive} loading={patch.isPending}>Quitar dispensa</Button>
            : docs.state === 'incomplete' && <Button type="button" size="sm" variant="ghost" onClick={() => setWaiving(true)}>Dispensar documentos</Button>)}
        </div>
      )}

      {ficha ? <DocumentChecklist registrationId={ficha.id} columns={2} /> : null}

      <DiscountEditor detail={detail} readOnly={!openCase} />

      <div className="space-y-3">
        <TextareaField label="Otros acuerdos con la familia" id="agreements-note" value={agreementsValue}
          disabled={!openCase} onChange={(e) => { setAgreements(e.target.value); setSaved(''); }} error={errors.agreements_note}
          placeholder="Pagará la inscripción en dos partes; entrega el acta original en enero." />
        <ErrorSummary errors={errors} labels={{ agreements_note: 'Acuerdos' }} />
        {openCase ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" size="sm" onClick={saveAgreements} loading={patch.isPending}
              disabled={agreements === null || agreements === detail.documentacion.agreements_note}>Guardar acuerdos</Button>
            <SaveStatus message={saved} />
          </div>
        ) : <ReadOnlyNote stage={detail.stage} />}
      </div>

      <RegistrationReviewModal id={ficha?.id ?? null} open={reviewing && !!ficha} onClose={() => setReviewing(false)} />
      <WaiveDialog open={waiving} onClose={() => setWaiving(false)} detail={detail} />
    </StageCard>
  );
}

/** Administrators only: documents count as complete, with the reason in the history. */
function WaiveDialog({ open, onClose, detail }: { open: boolean; onClose: () => void; detail: CaseDetail }) {
  return (
    <Modal open={open} onClose={onClose} title="Dispensar documentos" maxWidth={480}>
      <WaiveBody detail={detail} onClose={onClose} />
    </Modal>
  );
}

function WaiveBody({ detail, onClose }: { detail: CaseDetail; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const patch = useCaseWrite(detail.id, (body: Record<string, unknown>) => casesApi.patchStage(detail.id, 'documentacion', body));
  return (
    <form noValidate className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      if (!reason.trim()) { setErrors({ documents_waived_reason: 'Escriba por qué se dispensan.' }); return; }
      patch.mutate({ documents_waived: true, documents_waived_reason: reason.trim() }, {
        onSuccess: () => { toast.success('Documentos dispensados.'); onClose(); },
        onError: (err) => setErrors(errorsFrom(err)),
      });
    }}>
      <p className="text-sm text-muted">Los documentos faltantes dejan de bloquear «Marcar como inscrito». La familia puede seguir subiéndolos.</p>
      <TextareaField label="Motivo (obligatorio)" id="waive-reason" value={reason} maxLength={500}
        onChange={(e) => { setReason(e.target.value); setErrors({}); }} error={errors.documents_waived_reason}
        placeholder="El acta está en trámite en el Registro Civil; la entrega en enero." />
      <ErrorSummary errors={errors} labels={{ documents_waived_reason: 'Motivo' }} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button type="submit" loading={patch.isPending}>Dispensar documentos</Button>
      </div>
    </form>
  );
}

export default DocumentacionCard;
