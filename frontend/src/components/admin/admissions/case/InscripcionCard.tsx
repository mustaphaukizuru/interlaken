import { useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap, Plus, Receipt, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import type { FieldErrorMap } from '@/lib/apiErrors';
import { fmtDay, todayLocal } from '@/lib/caseStages';
import {
  casesApi, useCaseSideWrite, type CaseDetail, type CasePayment, type PaymentInput, type PaymentMethod,
} from '@/hooks/queries/cases';
import { ErrorSummary, SelectField, TextareaField, errorsFrom } from './formKit';
import { EnrollDialog } from './EnrollDialog';
import { GateList } from './caseBits';
import { StageCard } from './StageCard';
import type { StepState } from './StageBar';

export const METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'tarjeta', label: 'Tarjeta' },
  { value: 'otro', label: 'Otro' },
];

const PAYMENT_LABELS: Record<string, string> = {
  paid_on: 'Fecha de pago', amount: 'Monto', method: 'Forma de pago', reference: 'Referencia', note: 'Nota',
};

export function inscripcionSummary(d: CaseDetail): string {
  if (d.stage === 'inscrito') return `Inscrito${d.inscrito.enrolled_at ? ` el ${fmtDay(d.inscrito.enrolled_at)}` : ''}`;
  const n = d.inscrito.payments.length;
  const pending = d.inscrito.gates.items.filter((g) => !g.ok).length;
  return [n ? `${n} ${n === 1 ? 'pago registrado' : 'pagos registrados'}` : 'Sin pago registrado',
    pending ? `faltan ${pending} de ${d.inscrito.gates.items.length} requisitos` : 'listo para inscribir'].join(' · ');
}

/**
 * 5 · Inscripción: the inscripción payment(s) the school received (record
 * only), the gates of «Marcar como inscrito» (stage, ficha sent, documents,
 * payment) and the button that creates the student and the family logins.
 */
export function InscripcionCard({ detail, state, open, onToggle, isAdmin, enrollOpen, setEnrollOpen }: {
  detail: CaseDetail;
  state: StepState;
  open: boolean;
  onToggle: () => void;
  isAdmin: boolean;
  enrollOpen: boolean;
  setEnrollOpen: (open: boolean) => void;
}) {
  const enrolled = detail.stage === 'inscrito';
  const closed = detail.stage === 'cerrado';
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<CasePayment | null>(null);
  const gates = detail.inscrito.gates;
  const docsGate = gates.items.find((g) => g.key === 'documents');
  const onlyDocsMissing = !gates.ready && gates.items.every((g) => g.ok || g.key === 'documents');
  const canEnroll = !enrolled && !closed && (gates.ready || (isAdmin && onlyDocsMissing && !!docsGate?.overridable));
  const student = detail.ficha?.student;

  return (
    <StageCard stage="inscrito" title="Inscripción" state={state} open={open} onToggle={onToggle} summary={inscripcionSummary(detail)}>
      {enrolled && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-green-50 px-3.5 py-3 text-sm text-green-700">
          <p className="flex items-center gap-2 font-semibold">
            <GraduationCap size={18} aria-hidden="true" /> Inscrito{detail.inscrito.enrolled_at ? ` el ${fmtDay(detail.inscrito.enrolled_at)}` : ''}
            {student ? ` · matrícula ${student.student_id}` : ''}
          </p>
          {student && <Link to={`/admin/alumnos/${student.id}`} className="font-semibold text-purple underline">Abrir la ficha del alumno</Link>}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-semibold text-ink"><Receipt size={17} aria-hidden="true" /> Pago de inscripción</h3>
          {!closed && (
            <Button type="button" size="sm" variant="secondary" onClick={() => setAdding(true)}>
              <Plus size={15} aria-hidden="true" /> Registrar pago
            </Button>
          )}
        </div>
        <p className="text-xs text-muted">Solo registro: la plataforma no cobra la inscripción.</p>
        {detail.inscrito.payments.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-3 py-4 text-sm text-subtle">Sin pagos registrados.</p>
        ) : (
          <ul className="space-y-2" aria-label="Pagos de inscripción">
            {detail.inscrito.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-line bg-white px-3.5 py-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{p.summary}</p>
                  <p className="text-xs text-muted">{p.recorded_by ? `Registró ${p.recorded_by}` : ''}{p.note ? `${p.recorded_by ? ' · ' : ''}${p.note}` : ''}</p>
                </div>
                {!closed && !enrolled && (
                  <button type="button" onClick={() => setVoiding(p)} aria-label={`Anular el pago: ${p.summary}`}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-coral-700 hover:bg-coral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40">
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {!enrolled && (
        <div className="space-y-3 rounded-xl2 border border-line bg-cream-2 p-4">
          <h3 className="font-semibold text-ink">Para marcar como inscrito</h3>
          <GateList items={gates.items} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="green" onClick={() => setEnrollOpen(true)} disabled={!canEnroll}>
              <GraduationCap size={17} aria-hidden="true" /> Marcar como inscrito
            </Button>
            {!gates.ready && (
              <p className="text-xs text-muted">
                {canEnroll ? 'Solo faltan documentos: como administrador puede dispensarlos al inscribir.' : 'Complete los requisitos que faltan.'}
              </p>
            )}
          </div>
        </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Registrar pago de inscripción" maxWidth={520}>
        {adding && <PaymentForm detail={detail} onDone={() => setAdding(false)} />}
      </Modal>
      <Modal open={!!voiding} onClose={() => setVoiding(null)} title="Anular pago" maxWidth={460}>
        {voiding && <VoidPayment detail={detail} payment={voiding} onDone={() => setVoiding(null)} />}
      </Modal>
      <EnrollDialog open={enrollOpen} onClose={() => setEnrollOpen(false)} detail={detail} isAdmin={isAdmin} />
    </StageCard>
  );
}

export function PaymentForm({ detail, onDone }: { detail: CaseDetail; onDone: () => void }) {
  const [form, setForm] = useState<PaymentInput>({ paid_on: todayLocal(), amount: '', method: 'transferencia', reference: '', note: '' });
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const add = useCaseSideWrite(detail.id, (input: PaymentInput) => casesApi.addPayment(detail.id, input));
  const set = <K extends keyof PaymentInput>(k: K, v: PaymentInput[K]) => { setForm((f) => ({ ...f, [k]: v })); setErrors({}); };

  const submit = () => {
    const e: FieldErrorMap = {};
    if (!form.paid_on) e.paid_on = 'Indique la fecha del pago.';
    else if (form.paid_on > todayLocal()) e.paid_on = 'La fecha de pago no puede ser futura.';
    const n = Number(form.amount);
    if (!form.amount.trim() || !Number.isFinite(n) || n <= 0) e.amount = 'El monto debe ser mayor que cero.';
    if (Object.keys(e).length) { setErrors(e); return; }
    add.mutate({ ...form, amount: form.amount.trim(), reference: form.reference.trim(), note: form.note.trim() }, {
      onSuccess: (r) => { toast.success(`Pago registrado: ${r.data.summary}.`); onDone(); },
      onError: (err) => setErrors(errorsFrom(err)),
    });
  };

  return (
    <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input id="pay-date" label="Fecha de pago" type="date" max={todayLocal()} value={form.paid_on}
          onChange={(e) => set('paid_on', e.target.value)} error={errors.paid_on} />
        <Input id="pay-amount" label="Monto (MXN)" type="number" inputMode="decimal" min={0} step="0.01" value={form.amount}
          onChange={(e) => set('amount', e.target.value)} error={errors.amount} />
        <SelectField id="pay-method" label="Forma de pago" value={form.method} options={METHOD_OPTIONS}
          onChange={(e) => set('method', e.target.value as PaymentMethod)} error={errors.method} />
        <Input id="pay-ref" label="Referencia (opcional)" value={form.reference} maxLength={100} autoComplete="off"
          onChange={(e) => set('reference', e.target.value)} error={errors.reference} />
      </div>
      <TextareaField id="pay-note" label="Nota (opcional)" value={form.note} maxLength={300}
        onChange={(e) => set('note', e.target.value)} error={errors.note} />
      <ErrorSummary errors={errors} labels={PAYMENT_LABELS} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
        <Button type="submit" loading={add.isPending}>Registrar pago</Button>
      </div>
    </form>
  );
}

function VoidPayment({ detail, payment, onDone }: { detail: CaseDetail; payment: CasePayment; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const remove = useCaseSideWrite(detail.id, (why: string) => casesApi.voidPayment(detail.id, payment.id, why));
  return (
    <form noValidate className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      if (!reason.trim()) { setErrors({ reason: 'Indique por qué se anula el registro.' }); return; }
      remove.mutate(reason.trim(), {
        onSuccess: () => { toast.success('Pago anulado.'); onDone(); },
        onError: (err) => setErrors(errorsFrom(err, 'No se pudo anular el pago.')),
      });
    }}>
      <p className="text-sm text-muted">Se anula <strong className="text-ink">{payment.summary}</strong>. El registro queda en el historial.</p>
      <TextareaField label="Motivo (obligatorio)" id="pay-void-reason" value={reason} maxLength={300}
        onChange={(e) => { setReason(e.target.value); setErrors({}); }} error={errors.reason} placeholder="Se registró dos veces." />
      <ErrorSummary errors={errors} labels={{ reason: 'Motivo' }} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
        <Button type="submit" variant="danger" loading={remove.isPending}>Anular pago</Button>
      </div>
    </form>
  );
}

export default InscripcionCard;
