import { useState } from 'react';
import { BadgePercent, Pencil, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import type { FieldErrorMap } from '@/lib/apiErrors';
import {
  casesApi, useCaseSideWrite,
  type CaseDetail, type CaseDiscount, type DiscountDuration, type DiscountInput, type DiscountKind,
} from '@/hooks/queries/cases';
import { ErrorSummary, SelectField, TextareaField, errorsFrom } from './formKit';

export const KIND_OPTIONS: { value: DiscountKind; label: string }[] = [
  { value: 'beca_colegiatura', label: 'Beca en colegiatura' },
  { value: 'descuento_colegiatura', label: 'Descuento en colegiatura' },
  { value: 'inscripcion', label: 'Descuento en inscripción' },
];

export const DURATION_OPTIONS: { value: Exclude<DiscountDuration, ''>; label: string }[] = [
  { value: 'ciclo', label: '1 ciclo (agosto a junio)' },
  { value: '3_meses', label: '3 meses' },
  { value: '6_meses', label: '6 meses' },
  { value: 'permanente', label: 'Permanente' },
  { value: 'personalizado', label: 'Meses a la medida' },
];

const LABELS: Record<string, string> = {
  kind: 'Tipo', percent: 'Porcentaje', amount: 'Monto', duration: 'Duración',
  start_month: 'Desde', end_month: 'Hasta', authorized_by: 'Autorizó', note: 'Nota',
};

/** «2027-08-01» ↔ the value of `<input type="month">` («2027-08»). */
const toMonth = (iso: string | null) => (iso ? iso.slice(0, 7) : '');
const fromMonth = (v: string) => (v ? `${v}-01` : null);

interface FormState {
  kind: DiscountKind;
  mode: 'percent' | 'amount';
  value: string;
  duration: DiscountDuration;
  start: string;
  end: string;
  authorized_by: string;
  note: string;
}

const EMPTY: FormState = { kind: 'beca_colegiatura', mode: 'percent', value: '', duration: 'ciclo', start: '', end: '', authorized_by: '', note: '' };

function fromDiscount(d: CaseDiscount): FormState {
  return {
    kind: d.kind,
    mode: d.percent != null ? 'percent' : 'amount',
    value: String(Number(d.percent ?? d.amount ?? '')),
    duration: d.duration || 'ciclo',
    start: toMonth(d.start_month),
    end: toMonth(d.end_month),
    authorized_by: d.authorized_by,
    note: d.note,
  };
}

function toInput(f: FormState): DiscountInput {
  const tuition = f.kind !== 'inscripcion';
  const custom = tuition && f.duration === 'personalizado';
  const withStart = tuition && f.duration !== 'ciclo';
  return {
    kind: f.kind,
    percent: f.mode === 'percent' ? f.value.trim() : null,
    amount: f.mode === 'amount' ? f.value.trim() : null,
    duration: tuition ? f.duration : '',
    start_month: withStart ? fromMonth(f.start) : null,
    end_month: custom ? fromMonth(f.end) : null,
    authorized_by: f.authorized_by.trim(),
    note: f.note.trim(),
  };
}

/** Client checks that spare a round trip; the server repeats every one. */
function validate(f: FormState): FieldErrorMap {
  const e: FieldErrorMap = {};
  const n = Number(f.value);
  if (!f.value.trim() || !Number.isFinite(n) || n <= 0) e[f.mode] = f.mode === 'percent' ? 'Escriba el porcentaje.' : 'Escriba el monto.';
  else if (f.mode === 'percent' && n > 100) e.percent = 'El porcentaje va de 0.01 a 100.';
  if (f.kind !== 'inscripcion' && f.duration === 'personalizado') {
    if (!f.start || !f.end) e.start_month = 'Indique el primer y el último mes.';
    else if (f.end < f.start) e.end_month = 'El último mes debe ser después del primero.';
  }
  if (!f.authorized_by.trim()) e.authorized_by = 'Indique quién autorizó.';
  return e;
}

/**
 * Becas y descuentos agreed in «Documentación y acuerdos» (record only: the
 * platform charges nothing). Each one reads as one line («Beca 20% en
 * colegiatura · agosto a junio 2028») with who authorized it; editing keeps
 * the history and «Anular» voids it instead of deleting.
 */
export function DiscountEditor({ detail, readOnly }: { detail: CaseDetail; readOnly: boolean }) {
  const [editing, setEditing] = useState<CaseDiscount | 'new' | null>(null);
  const [voiding, setVoiding] = useState<CaseDiscount | null>(null);
  const discounts = detail.documentacion.discounts;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold text-ink"><BadgePercent size={17} aria-hidden="true" /> Becas y descuentos</h3>
        {!readOnly && (
          <Button type="button" size="sm" variant="secondary" onClick={() => setEditing('new')}>
            <Plus size={15} aria-hidden="true" /> Agregar beca o descuento
          </Button>
        )}
      </div>
      {discounts.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-3 py-4 text-sm text-subtle">Sin becas ni descuentos acordados.</p>
      ) : (
        <ul className="space-y-2" aria-label="Becas y descuentos">
          {discounts.map((d) => (
            <li key={d.id} className="rounded-md bg-white px-3.5 py-3 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{d.summary}</p>
                  <p className="text-xs text-muted">
                    Autorizó {d.authorized_by}{d.months ? ` · ${d.months} ${d.months === 1 ? 'mes' : 'meses'}` : ''}
                    {d.created_by ? ` · registró ${d.created_by}` : ''}
                  </p>
                  {d.note && <p className="mt-1 whitespace-pre-line text-sm text-ink">{d.note}</p>}
                </div>
                {!readOnly && (
                  <div className="flex gap-1">
                    <button type="button" onClick={() => setEditing(d)} aria-label={`Editar: ${d.summary}`}
                      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm text-subtle hover:bg-cream hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40">
                      <Pencil size={16} aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => setVoiding(d)} aria-label={`Anular: ${d.summary}`}
                      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm text-coral-700 hover:bg-coral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40">
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Agregar beca o descuento' : 'Editar beca o descuento'} maxWidth={560}>
        {editing !== null && <DiscountForm detail={detail} discount={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Modal>
      <Modal open={!!voiding} onClose={() => setVoiding(null)} title="Anular beca o descuento" maxWidth={460}>
        {voiding && <VoidDiscount detail={detail} discount={voiding} onDone={() => setVoiding(null)} />}
      </Modal>
    </div>
  );
}

export function DiscountForm({ detail, discount, onDone }: { detail: CaseDetail; discount: CaseDiscount | null; onDone: () => void }) {
  const [form, setForm] = useState<FormState>(discount ? fromDiscount(discount) : EMPTY);
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const save = useCaseSideWrite(detail.id, (input: DiscountInput) =>
    discount ? casesApi.updateDiscount(detail.id, discount.id, input) : casesApi.addDiscount(detail.id, input));
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => { setForm((f) => ({ ...f, [k]: v })); setErrors({}); };
  const tuition = form.kind !== 'inscripcion';
  const custom = tuition && form.duration === 'personalizado';

  const submit = () => {
    const local = validate(form);
    if (Object.keys(local).length) { setErrors(local); return; }
    save.mutate(toInput(form), {
      onSuccess: (r) => { toast.success(discount ? 'Beca o descuento actualizado.' : `Agregado: ${r.data.summary}.`); onDone(); },
      onError: (e) => setErrors(errorsFrom(e)),
    });
  };

  return (
    <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <SelectField label="Tipo" id="disc-kind" value={form.kind} options={KIND_OPTIONS} error={errors.kind}
        onChange={(e) => set('kind', e.target.value as DiscountKind)} />
      <fieldset>
        <legend className="label">Valor</legend>
        <div className="flex flex-wrap items-start gap-2">
          <div className="inline-flex rounded-md bg-cream p-1" role="radiogroup" aria-label="Porcentaje o monto fijo">
            {(['percent', 'amount'] as const).map((m) => (
              <label key={m} className={clsx('inline-flex min-h-[40px] cursor-pointer items-center rounded-sm px-4 text-sm font-semibold focus-within:ring-2 focus-within:ring-purple/40',
                form.mode === m ? 'bg-white text-ink shadow-sm' : 'text-muted')}>
                <input type="radio" name="disc-mode" className="sr-only" checked={form.mode === m} onChange={() => set('mode', m)} />
                {m === 'percent' ? 'Porcentaje' : 'Monto fijo'}
              </label>
            ))}
          </div>
          <div className="w-40">
            <Input id="disc-value" label={form.mode === 'percent' ? 'Porcentaje (%)' : 'Monto (MXN)'} type="number" inputMode="decimal"
              min={0} step="0.01" value={form.value} onChange={(e) => set('value', e.target.value)}
              error={errors[form.mode] || errors.percent || errors.amount} />
          </div>
        </div>
      </fieldset>
      {tuition && (
        <>
          <SelectField label="Duración" id="disc-duration" value={form.duration} options={DURATION_OPTIONS} error={errors.duration}
            onChange={(e) => set('duration', e.target.value as DiscountDuration)} />
          {form.duration !== 'ciclo' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input id="disc-start" label={custom ? 'Primer mes' : 'Desde (opcional)'} type="month" value={form.start}
                hint={custom ? undefined : 'Por omisión, agosto del ciclo.'}
                onChange={(e) => set('start', e.target.value)} error={errors.start_month} />
              {custom && (
                <Input id="disc-end" label="Último mes" type="month" value={form.end}
                  onChange={(e) => set('end', e.target.value)} error={errors.end_month} />
              )}
            </div>
          )}
        </>
      )}
      <Input id="disc-auth" label="Autorizó" value={form.authorized_by} onChange={(e) => set('authorized_by', e.target.value)}
        error={errors.authorized_by} placeholder="Dirección general" autoComplete="off" />
      <TextareaField label="Nota (opcional)" id="disc-note" value={form.note} onChange={(e) => set('note', e.target.value)} error={errors.note}
        placeholder="Por hermano inscrito en Secundaria." />
      <ErrorSummary errors={errors} labels={LABELS} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
        <Button type="submit" loading={save.isPending}>{discount ? 'Guardar cambios' : 'Agregar'}</Button>
      </div>
    </form>
  );
}

function VoidDiscount({ detail, discount, onDone }: { detail: CaseDetail; discount: CaseDiscount; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const remove = useCaseSideWrite(detail.id, (why: string) => casesApi.voidDiscount(detail.id, discount.id, why));
  return (
    <form noValidate className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      remove.mutate(reason.trim(), {
        onSuccess: () => { toast.success('Beca o descuento anulado.'); onDone(); },
        onError: (err) => setErrors(errorsFrom(err, 'No se pudo anular.')),
      });
    }}>
      <p className="text-sm text-muted">Se anula <strong className="text-ink">{discount.summary}</strong>. Queda en el historial del expediente.</p>
      <TextareaField label="Motivo (opcional)" id="disc-void-reason" value={reason} maxLength={300}
        onChange={(e) => setReason(e.target.value)} error={errors.reason} />
      <ErrorSummary errors={errors} labels={{ reason: 'Motivo' }} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
        <Button type="submit" variant="danger" loading={remove.isPending}>Anular</Button>
      </div>
    </form>
  );
}

export default DiscountEditor;
