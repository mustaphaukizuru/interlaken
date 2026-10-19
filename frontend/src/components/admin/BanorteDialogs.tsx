import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { paymentsApi } from '@/services/api';
import { apiErrorMessage } from '@/lib/apiErrors';
import { invalidateEntity } from '@/hooks/queries/keys';
import { CAF_MONEY_VIEWS, CAF_TOPUPS } from '@/hooks/queries/cafeteria';
import { PAYMENTS_ENTITY } from '@/hooks/queries/payments';
import type { TopUpLogEntry } from '@/types';

const mxn = (v: string | number | null | undefined) => `$${parseFloat(String(v ?? 0)).toFixed(2)}`;
const when = (d?: string | null) => (d ? format(new Date(d), "d MMM yyyy, HH:mm", { locale: es }) : '-');

/** Where staff look an operation up (same words as docs/BANORTE-INTEGRATION.md). */
const MULTICOBROS_PATH = 'MultiCobros → Analítica → Reportes → Transacciones Payworks 2';

/** What staff need to find the operation in MultiCobros: date, PAGO id (Referencia 1), control number. */
function OperationFacts({ row }: { row: TopUpLogEntry }) {
  const b = row.banorte;
  if (!b) return null;
  return (
    <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 rounded-lg bg-cream px-3 py-2 text-xs leading-5 text-ink">
      <dt className="text-muted">Alumno</dt><dd>{row.student_name}</dd>
      <dt className="text-muted">Monto</dt><dd className="font-semibold">{mxn(row.amount)}</dd>
      <dt className="text-muted">Fecha</dt><dd>{when(b.created_at ?? row.created_at)}</dd>
      <dt className="text-muted">Referencia 1</dt><dd className="font-mono">PAGO{row.payment_id}</dd>
      <dt className="text-muted">Número de control</dt><dd className="font-mono">{b.control_number}</dd>
      {b.mode !== 'PRD' && (<><dt className="text-muted">Modo</dt><dd>Simulación ({b.mode}), sin cargo real</dd></>)}
    </dl>
  );
}

function useInvalidateMoney() {
  const queryClient = useQueryClient();
  return () => invalidateEntity(queryClient, CAF_TOPUPS, [...CAF_MONEY_VIEWS, PAYMENTS_ENTITY]);
}

/** "Verificar en MultiCobros": staff type back the referencia and the amount they
 *  read in MultiCobros; the server checks both against the payment. */
export function VerifyBanorteDialog({ row, onClose }: { row: TopUpLogEntry | null; onClose: () => void }) {
  return (
    <Modal open={!!row} onClose={onClose} title="Verificar operación en MultiCobros" maxWidth={480}>
      {row && <VerifyForm row={row} onClose={onClose} />}
    </Modal>
  );
}

function VerifyForm({ row, onClose }: { row: TopUpLogEntry; onClose: () => void }) {
  const invalidate = useInvalidateMoney();
  const [referencia, setReferencia] = useState('');
  const [amount, setAmount] = useState('');
  const verify = useMutation({
    mutationFn: () => paymentsApi.verifyBanorte(row.payment_id!, { referencia: referencia.trim(), amount: amount.trim() }),
    onSuccess: () => {
      toast.success('Operación verificada en MultiCobros.');
      onClose();
      void invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'No se pudo registrar la verificación.')),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (referencia.trim() && amount.trim()) verify.mutate();
  };
  return (
    <form className="space-y-4" onSubmit={submit}>
      <p className="text-sm text-muted">
        En {MULTICOBROS_PATH}, busque el número de control y confirme que aparece <strong>Aprobada</strong>.
        Escriba la referencia y el monto tal como los muestra MultiCobros.
      </p>
      <OperationFacts row={row} />
      <Input label="Referencia en MultiCobros" inputMode="numeric" autoComplete="off" required value={referencia} onChange={(e) => setReferencia(e.target.value)} />
      <Input label="Monto en MultiCobros" inputMode="decimal" autoComplete="off" required value={amount} onChange={(e) => setAmount(e.target.value)} />
      <p className="text-xs text-muted">Si no aparece o el monto no coincide, no la cargue en el POS y avise a dirección.</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
        <Button type="submit" size="sm" loading={verify.isPending} disabled={!referencia.trim() || !amount.trim()}>
          Sí, aparece aprobada
        </Button>
      </div>
    </form>
  );
}

/** "Conciliar con MultiCobros" for a pending, expired, superseded or unanswered
 *  card attempt: credit it once when MultiCobros shows it approved, or close it
 *  when it is not there. Never a manual balance adjustment. */
export function ReconcileBanorteDialog({ row, onClose }: { row: TopUpLogEntry | null; onClose: () => void }) {
  return (
    <Modal open={!!row} onClose={onClose} title="Conciliar con MultiCobros" maxWidth={520}>
      {row && <ReconcileForm row={row} onClose={onClose} />}
    </Modal>
  );
}

function ReconcileForm({ row, onClose }: { row: TopUpLogEntry; onClose: () => void }) {
  const invalidate = useInvalidateMoney();
  const b = row.banorte;
  const [outcome, setOutcome] = useState<'approved' | 'not_found'>('approved');
  const [referencia, setReferencia] = useState('');
  const [codigoAut, setCodigoAut] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const reconcile = useMutation({
    mutationFn: () => paymentsApi.reconcileBanorte(row.payment_id!, outcome === 'approved'
      ? { outcome, referencia: referencia.trim(), codigo_aut: codigoAut.trim(), amount: amount.trim(), note: note.trim() }
      : { outcome, note: note.trim() }),
    onSuccess: ({ data }) => {
      if (data.detail === 'already_processed') toast.success('Ya estaba conciliada.');
      else if (outcome === 'approved' && data.payment?.topup?.status === 'paid') {
        toast.success(`Pago conciliado: ${mxn(row.amount)} de ${row.student_name} quedó en «Por aplicar». Cárguelo en el POS.`);
      } else if (outcome === 'approved') toast.success(`Pago conciliado: se acreditaron ${mxn(row.amount)} a ${row.student_name}.`);
      else toast.success('Marcada como «No aparece en MultiCobros».');
      onClose();
      void invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'No se pudo conciliar el pago.')),
  });
  const ready = outcome === 'approved'
    ? !!(referencia.trim() && codigoAut.trim() && amount.trim())
    : !!note.trim();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) reconcile.mutate();
  };
  const radio = 'h-4 w-4 border-line text-purple focus:ring-purple/40';
  return (
    <form className="space-y-4" onSubmit={submit}>
      <p className="text-sm text-muted">
        Banorte no nos dio una respuesta confiable de este pago
        {b?.review_reason ? <> ({b.review_reason})</> : b?.failure_label ? <> ({b.failure_label.toLowerCase()})</> : null}.
        En {MULTICOBROS_PATH}, búsquelo por número de control o por Referencia 1.
      </p>
      <OperationFacts row={row} />
      {b?.last_error && <p className="text-xs text-amber">Detalle: {b.last_error}</p>}
      <fieldset className="space-y-1">
        <legend className="label">¿Qué muestra MultiCobros?</legend>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm text-ink">
          <input type="radio" name="outcome" className={radio} checked={outcome === 'approved'} onChange={() => setOutcome('approved')} />
          Aparece <strong>Aprobada</strong>
        </label>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm text-ink">
          <input type="radio" name="outcome" className={radio} checked={outcome === 'not_found'} onChange={() => setOutcome('not_found')} />
          No aparece (o aparece declinada)
        </label>
      </fieldset>
      {outcome === 'approved' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Referencia Payworks" inputMode="numeric" autoComplete="off" required value={referencia} onChange={(e) => setReferencia(e.target.value)} />
            <Input label="Número de autorización" autoComplete="off" required value={codigoAut} onChange={(e) => setCodigoAut(e.target.value)} />
          </div>
          <Input label="Monto en MultiCobros" inputMode="decimal" autoComplete="off" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Input label="Nota (opcional)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          <p className="text-xs text-muted">
            El pago de {mxn(row.amount)} de {row.student_name} queda registrado una sola vez y la operación verificada;
            la recarga pasa a «Por aplicar» y llega al saldo cuando se carga en el POS. Si después llega la respuesta
            de Banorte, no cambia nada.
          </p>
        </>
      ) : (
        <>
          <Input label="Nota" required maxLength={500} placeholder="Qué buscó y qué encontró en MultiCobros" value={note} onChange={(e) => setNote(e.target.value)} />
          <p className="text-xs text-muted">
            Se cierra como «No aparece en MultiCobros» sin mover saldo. Si más tarde llega una aprobación real de Banorte, se registrará como pagada.
          </p>
        </>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
        <Button type="submit" size="sm" loading={reconcile.isPending} disabled={!ready}>
          {outcome === 'approved' ? 'Conciliar y acreditar' : 'Marcar como no encontrada'}
        </Button>
      </div>
    </form>
  );
}
