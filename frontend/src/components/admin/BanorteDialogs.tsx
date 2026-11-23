import { useEffect, useRef, useState, type FormEvent } from 'react';
import { formatMXN } from '@/lib/format';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { CheckCircle2, Clock } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { CopyButton } from '@/components/admin/CopyButton';
import { paymentsApi } from '@/services/api';
import { apiErrorMessage } from '@/lib/apiErrors';
import { invalidateEntity } from '@/hooks/queries/keys';
import { CAF_MONEY_VIEWS, CAF_TOPUPS } from '@/hooks/queries/cafeteria';
import { PAYMENTS_ENTITY } from '@/hooks/queries/payments';
import { cleanReferencia, REFERENCIA_HINT, referenciaProblem } from '@/lib/referencia';
import type { BanorteOperation, BanorteVerifyResult, TopUpLogEntry } from '@/types';

/** What the MultiCobros dialogs read of a payment: a deposit-log row, or a row
 *  of «Subir reporte de MultiCobros» (which knows only these fields). */
export type BanorteRow = Pick<TopUpLogEntry, 'payment_id' | 'student_name' | 'amount' | 'created_at'> & {
  loyverse_code?: string;
  banorte: (Pick<BanorteOperation, 'control_number' | 'mode'> & Partial<BanorteOperation>) | null;
};

/** The values read in the MultiCobros report, offered (never sent) as the form's start. */
export interface ReconcilePrefill {
  referencia: string;
  codigo_aut: string;
  amount: string;
}

/** One money format everywhere (es-MX grouping): display only. */
const mxn = formatMXN;
const when = (d?: string | null) => (d ? format(new Date(d), "d MMM yyyy, HH:mm", { locale: es }) : '-');

/** Where staff look an operation up (same words as docs/BANORTE-INTEGRATION.md). */
export const MULTICOBROS_PATH = 'MultiCobros → Analítica → Reportes → Transacciones Payworks 2';

/** What staff need to find the operation in MultiCobros: date, PAGO id (Referencia 1), control number. */
function OperationFacts({ row }: { row: BanorteRow }) {
  const b = row.banorte;
  if (!b) return null;
  return (
    <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 rounded-sm bg-cream px-3 py-2 text-xs leading-5 text-ink">
      <dt className="text-muted">Alumno</dt><dd>{row.student_name}</dd>
      <dt className="text-muted">Monto</dt><dd className="font-semibold">{mxn(row.amount)}</dd>
      <dt className="text-muted">Fecha</dt><dd>{when(b.created_at ?? row.created_at)}</dd>
      <dt className="text-muted">Referencia 1</dt>
      <dd className="flex items-center gap-1 font-mono">
        PAGO{row.payment_id}
        <CopyButton value={`PAGO${row.payment_id}`} label="Referencia 1" className="-my-1" />
      </dd>
      <dt className="text-muted">Número de control</dt>
      <dd className="flex items-center gap-1 font-mono">
        {b.control_number}
        <CopyButton value={b.control_number} label="número de control" className="-my-1" />
      </dd>
      {b.mode !== 'PRD' && (<><dt className="text-muted">Modo</dt><dd>Simulación ({b.mode}), sin cargo real</dd></>)}
    </dl>
  );
}

export function useInvalidateMoney() {
  const queryClient = useQueryClient();
  return () => {
    // Verifying (or reconciling) changes «Por verificar» and the Cafetería count too.
    void queryClient.invalidateQueries({ queryKey: ['badges'] });
    return invalidateEntity(queryClient, CAF_TOPUPS, [...CAF_MONEY_VIEWS, PAYMENTS_ENTITY]);
  };
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

type VerifyOutcome = { applied: boolean; title: string; text: string };

/** What the dialog says after «Sí, aparece aprobada»: the server applies the
 *  top-up at once when Loyverse already has it. `null`: nothing to add (a
 *  top-up already in the balance, or an older server). */
function verifyOutcome(row: TopUpLogEntry, data: BanorteVerifyResult): VerifyOutcome | null {
  const who = row.student_name;
  switch (data.apply_state) {
    case 'applied':
      return {
        applied: true,
        title: `Verificada y aplicada · nuevo saldo ${mxn(data.balance)}`,
        text: `La recarga de ${mxn(row.amount)} ya está en el saldo de ${who}. Se avisó a la familia.`,
      };
    case 'waiting_verification':
      return {
        applied: false,
        title: 'Verificada · falta verificar otra recarga de este alumno',
        text: `Loyverse ya tiene esta recarga junto con otra de ${who} sin verificar. Verifique esa también en «Por aplicar» y las dos se suman al saldo.`,
      };
    case 'auto_waiting':
      return {
        applied: false,
        title: 'Verificada · la app la carga en Loyverse en unos minutos',
        text: `No la cargue a mano en el POS: la app la carga sola y la suma al saldo de ${who}. Cárguela usted solo si recibe el aviso «Cargar a mano».`,
      };
    case 'waiting_pos':
      return {
        applied: false,
        title: 'Verificada · se aplicará cuando esté cargada en Loyverse',
        text: `Cargue ${mxn(row.amount)} al cliente ${row.loyverse_code || 'del alumno'} en el POS. La app la aplica sola en unos minutos.`,
      };
    case 'pos_unknown':
      return {
        applied: false,
        title: 'Verificada · se aplicará cuando esté cargada en Loyverse',
        text: 'No se pudo consultar Loyverse en este momento. Si ya la cargó en el POS, la app la aplica sola en unos minutos.',
      };
    default:
      return null;
  }
}

function VerifyForm({ row, onClose }: { row: TopUpLogEntry; onClose: () => void }) {
  const invalidate = useInvalidateMoney();
  const [referencia, setReferencia] = useState('');
  const [amount, setAmount] = useState('');
  const [outcome, setOutcome] = useState<VerifyOutcome | null>(null);
  // The submit button goes away with the form: keep keyboard focus in the dialog.
  const done = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (outcome) done.current?.focus(); }, [outcome]);
  const refProblem = referenciaProblem(referencia, row.banorte?.control_number);
  const verify = useMutation({
    mutationFn: () => paymentsApi.verifyBanorte(row.payment_id!, { referencia: cleanReferencia(referencia), amount: amount.trim() }),
    onSuccess: ({ data }) => {
      void invalidate();
      const said = verifyOutcome(row, data);
      if (said) {
        setOutcome(said);
        return;
      }
      toast.success('Operación verificada en MultiCobros.');
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'No se pudo registrar la verificación.')),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (referencia.trim() && amount.trim() && !refProblem) verify.mutate();
  };
  if (outcome) {
    const Icon = outcome.applied ? CheckCircle2 : Clock;
    return (
      <div className="space-y-4">
        <div
          role="status"
          className={`flex items-start gap-3 rounded-sm border px-3 py-3 ${outcome.applied ? 'border-green-600/30 bg-green-50' : 'border-amber/40 bg-amber/10'}`}
        >
          <Icon className={`mt-0.5 h-5 w-5 flex-shrink-0 ${outcome.applied ? 'text-green-700' : 'text-amber'}`} aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold text-ink">{outcome.title}</p>
            <p className="mt-1 text-sm text-muted">{outcome.text}</p>
          </div>
        </div>
        <div className="flex justify-end">
          <Button ref={done} type="button" size="sm" onClick={onClose}>Listo</Button>
        </div>
      </div>
    );
  }
  return (
    <form className="space-y-4" onSubmit={submit}>
      <p className="text-sm text-muted">
        En {MULTICOBROS_PATH}, busque el número de control y confirme que aparece <strong>Aprobada</strong>.
        Escriba la referencia y el monto tal como los muestra MultiCobros.
      </p>
      <OperationFacts row={row} />
      <Input label="Referencia en MultiCobros" inputMode="numeric" autoComplete="off" required value={referencia}
        hint={REFERENCIA_HINT} error={refProblem || undefined} onChange={(e) => setReferencia(e.target.value)} />
      <Input label="Monto en MultiCobros" inputMode="decimal" autoComplete="off" required value={amount} onChange={(e) => setAmount(e.target.value)} />
      <p className="text-xs text-muted">Si no aparece o el monto no coincide, no la cargue en el POS y avise a dirección.</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
        <Button type="submit" size="sm" loading={verify.isPending} disabled={!referencia.trim() || !amount.trim() || !!refProblem}>
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
      {row && <ReconcileBanorteForm row={row} onClose={onClose} />}
    </Modal>
  );
}

/** The «Conciliar con MultiCobros» form itself. «Subir reporte de MultiCobros»
 *  shows it inside its own dialog with `prefill` (the report's values, still
 *  editable and checked by the server like typed ones); `onDone` runs after
 *  the server accepted it, before `onClose`. */
export function ReconcileBanorteForm({ row, onClose, prefill, onDone }: {
  row: BanorteRow;
  onClose: () => void;
  prefill?: ReconcilePrefill;
  onDone?: () => void;
}) {
  const invalidate = useInvalidateMoney();
  const b = row.banorte;
  const [outcome, setOutcome] = useState<'approved' | 'not_found'>('approved');
  const [referencia, setReferencia] = useState(prefill?.referencia ?? '');
  const [codigoAut, setCodigoAut] = useState(prefill?.codigo_aut ?? '');
  const [amount, setAmount] = useState(prefill?.amount ?? '');
  const [note, setNote] = useState('');
  const refProblem = outcome === 'approved' ? referenciaProblem(referencia, b?.control_number) : '';
  const reconcile = useMutation({
    mutationFn: () => paymentsApi.reconcileBanorte(row.payment_id!, outcome === 'approved'
      ? { outcome, referencia: cleanReferencia(referencia), codigo_aut: codigoAut.trim(), amount: amount.trim(), note: note.trim() }
      : { outcome, note: note.trim() }),
    onSuccess: ({ data }) => {
      if (data.detail === 'already_processed') toast.success('Ya estaba conciliada.');
      else if (outcome === 'approved' && data.payment?.topup?.status === 'paid') {
        toast.success(`Pago conciliado: ${mxn(row.amount)} de ${row.student_name} quedó en «Por aplicar». Cárguelo en el POS.`);
      } else if (outcome === 'approved') toast.success(`Pago conciliado: se acreditaron ${mxn(row.amount)} a ${row.student_name}.`);
      else toast.success('Marcada como «No aparece en MultiCobros».');
      onDone?.();
      onClose();
      void invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'No se pudo conciliar el pago.')),
  });
  const ready = outcome === 'approved'
    ? !!(referencia.trim() && codigoAut.trim() && amount.trim()) && !refProblem
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
      {prefill && (
        <p className="rounded-sm border border-brand-600/20 bg-brand-50 px-3 py-2 text-xs text-ink">
          Los datos vienen del reporte de MultiCobros que subió. Revíselos antes de conciliar.
        </p>
      )}
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
            <Input label="Referencia Payworks" inputMode="numeric" autoComplete="off" required value={referencia}
              hint={REFERENCIA_HINT} error={refProblem || undefined} onChange={(e) => setReferencia(e.target.value)} />
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
