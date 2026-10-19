import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { AlarmClock, CheckCircle2, ShieldCheck, Undo2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { BulkActionBar } from '@/components/admin/BulkActionBar';
import { BulkConfirmDialog } from '@/components/admin/BulkConfirmDialog';
import { ExportMenu } from '@/components/admin/ExportMenu';
import { VerifyBanorteDialog } from '@/components/admin/BanorteDialogs';
import { APPLY_PAID_ACTION } from '@/components/admin/paidTopUpActions';
import { idsParam, type BulkResult, type ExportFormat } from '@/services/dataOps';
import { cafeteriaAdminApi, type TopUpBulkResult } from '@/services/cafeteriaAdmin';
import { useRowSelection } from '@/hooks/useRowSelection';
import { invalidateEntity } from '@/hooks/queries/keys';
import { CAF_MONEY_VIEWS, CAF_TOPUPS, useTopUpsBulk, useTopUpsExport, useTopUpsList } from '@/hooks/queries/cafeteria';
import { PAYMENTS_ENTITY } from '@/hooks/queries/payments';
import { apiErrorCode, apiErrorMessage, apiFieldErrors } from '@/lib/apiErrors';
import { LIVE } from '@/lib/live';
import { schoolToday } from '@/lib/topupApply';
import type { TopUpLogEntry } from '@/types';

const mxn = (v: string | number | null | undefined) => `$${parseFloat(String(v ?? 0)).toFixed(2)}`;
const when = (d?: string | null) => (d ? format(new Date(d), "d MMM, HH:mm", { locale: es }) : '—');

/** Loyverse (last sync) minus the wallet: what staff typed in and the app has not applied yet. */
const loyverseGap = (d: TopUpLogEntry) =>
  d.loyverse_points == null || d.wallet_balance == null
    ? null
    : parseFloat(d.loyverse_points) - parseFloat(d.wallet_balance);

function useInvalidateMoney() {
  const queryClient = useQueryClient();
  return () => invalidateEntity(queryClient, CAF_TOPUPS, [...CAF_MONEY_VIEWS, PAYMENTS_ENTITY]);
}

/**
 * "Por aplicar": card top-ups paid by families and not in their balance yet.
 * The 7:30 routine: type each amount into the student's Loyverse customer;
 * the app applies it on its own within minutes (or press «Aplicar»).
 */
export function PaidTopUpQueue() {
  const [page, setPage] = useState(1);
  const filters = { needs_apply: 1, ordering: 'apply_due_at' };
  const { data, isLoading, isError, refetch } = useTopUpsList({ page, ...filters }, LIVE);
  const count = data?.count ?? 0;
  const selection = useRowSelection(count, 'apply');
  const bulk = useTopUpsBulk();
  const exportTopups = useTopUpsExport();
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState<TopUpLogEntry | null>(null);
  const [refunding, setRefunding] = useState<TopUpLogEntry | null>(null);
  const [verifying, setVerifying] = useState<TopUpLogEntry | null>(null);
  const overdue = (data?.results ?? []).filter((d) => d.apply_overdue).length;

  const columns: Column<TopUpLogEntry>[] = [
    {
      id: 'due', header: 'Se aplica', hideable: false, className: 'whitespace-nowrap',
      cell: (d) => (
        <span className="block">
          <span className={d.apply_overdue ? 'font-semibold text-coral' : 'text-ink'}>{when(d.apply_due_at)}</span>
          {d.apply_overdue && <Badge variant="error">Vencida</Badge>}
          <span className="block text-xs text-subtle">Pagada {when(d.processed_at)}</span>
        </span>
      ),
    },
    {
      id: 'student', header: 'Alumno', minWidth: 170, className: 'font-medium text-ink',
      cell: (d) => (
        <span className="block">
          <Link to={`/admin/cafeteria/${d.student_id}`} className="hover:text-brand-700">{d.student_name}</Link>
          <span className="block text-xs text-subtle">{d.student_code}</span>
        </span>
      ),
    },
    {
      id: 'loyverse', header: 'Cliente Loyverse', className: 'font-mono text-xs text-ink',
      cell: (d) => d.loyverse_code || <span className="font-sans text-subtle">—</span>,
    },
    { id: 'amount', header: 'Monto', align: 'right', hideable: false, className: 'font-semibold text-ink', cell: (d) => mxn(d.amount) },
    {
      id: 'pos', header: 'Loyverse / App', minWidth: 150,
      cell: (d) => {
        const gap = loyverseGap(d);
        return (
          <span className="block text-xs text-muted">
            {d.loyverse_points != null ? `${mxn(d.loyverse_points)} / ${mxn(d.wallet_balance)}` : '—'}
            {gap != null && gap >= parseFloat(d.amount) && (
              <span className="mt-0.5 block font-semibold text-green-700">Ya está en Loyverse; se aplica sola en minutos</span>
            )}
          </span>
        );
      },
    },
    { id: 'folio', header: 'Folio', className: 'font-mono text-xs text-ink', cell: (d) => d.payment_id ?? '—' },
    {
      id: 'bank', header: 'Banorte', cell: (d) => (
        d.banorte?.needs_verification ? <Badge variant="warning">Sin verificar</Badge>
          : d.banorte?.simulation ? <Badge variant="neutral">Simulación</Badge>
          : d.banorte?.verified_at ? <span className="text-xs text-green-700">Verificada</span>
          : <span className="text-xs text-subtle">—</span>
      ),
    },
  ];

  const fetchExport = (fmt: ExportFormat, { selectedOnly }: { selectedOnly: boolean }) =>
    exportTopups.mutateAsync({
      ...filters, fmt,
      ids: selectedOnly && !selection.allMatching ? idsParam(selection.ids) : undefined,
    });

  return (
    <Card>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <h2 className="flex items-center gap-2 font-head text-base font-semibold text-ink">
            <AlarmClock className="h-4 w-4 text-purple" aria-hidden="true" /> Por aplicar (carga de las 7:30)
            {overdue > 0 && <Badge variant="error">{overdue} vencida{overdue === 1 ? '' : 's'}</Badge>}
          </h2>
          <p className="mt-1 text-sm text-muted">
            Recargas con tarjeta ya cobradas que aún no están en el saldo. Cargue cada monto al cliente de
            Loyverse del alumno: la app lo detecta y lo aplica sola en unos minutos (o use «Aplicar»). Así el
            portal nunca muestra dinero que la caja no tiene. Si la familia envía el comprobante por WhatsApp
            para usarlo hoy, búsquela por folio y cárguela en ese momento.
          </p>
        </div>
        <ExportMenu filenamePrefix="recargas_por_aplicar" selectedCount={selection.count} fetch={fetchExport} />
      </div>
      <DataTable<TopUpLogEntry>
        tableId="cafeteria-pos-apply"
        columns={columns}
        rows={data?.results}
        rowKey={(d) => d.id}
        rowLabel={(d) => `recarga por aplicar de ${d.student_name}`}
        caption="Recargas por aplicar"
        page={page}
        count={count}
        onPage={setPage}
        itemLabel="recargas"
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        selection={selection}
        bulkBar={(
          <BulkActionBar
            count={selection.count}
            allMatching={selection.allMatching}
            allMatchingCount={count}
            onSelectAllMatching={selection.onSelectAllMatching}
            onClear={selection.onClear}
            actions={[APPLY_PAID_ACTION]}
            onAction={() => setConfirming(true)}
            itemLabel="recargas"
          />
        )}
        rowActions={(d) => (
          <div className="flex flex-wrap justify-end gap-2">
            {d.banorte?.needs_verification ? (
              <Button size="sm" variant="secondary" onClick={() => setVerifying(d)}>
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Verificar en MultiCobros
              </Button>
            ) : (
              <Button size="sm" onClick={() => setApplying(d)} aria-label={`Aplicar la recarga de ${d.student_name}`}>
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Aplicar
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setRefunding(d)} aria-label={`Devolver el pago de ${d.student_name}`}>
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> Devolver
            </Button>
          </div>
        )}
        empty={{ icon: CheckCircle2, title: 'Nada por aplicar', description: 'Todas las recargas con tarjeta ya están en el saldo de los alumnos.' }}
      />
      <BulkConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        action={confirming ? APPLY_PAID_ACTION : null}
        entityLabel="recargas"
        ids={selection.ids}
        allMatching={selection.allMatching}
        filters={filters}
        execute={(body) => bulk.mutateAsync(body)}
        onDone={() => selection.onClear()}
        renderPlan={(plan: BulkResult) => {
          const total = (plan as TopUpBulkResult).total;
          return (
            <p className="text-xs">
              Antes de aplicar cada una se confirma que Loyverse ya la muestra; las que no, quedan pendientes.
              {total ? <> Total: <strong className="text-ink">{mxn(total)}</strong>.</> : null}
            </p>
          );
        }}
      />
      <ApplyPaidDialog row={applying} onClose={() => setApplying(null)} />
      <RefundPaidDialog row={refunding} onClose={() => setRefunding(null)} />
      <VerifyBanorteDialog row={verifying} onClose={() => setVerifying(null)} />
    </Card>
  );
}

/**
 * «Aplicadas hoy»: every card top-up that reached a wallet today and how. The
 * person who did the 7:30 load checks it against what they typed: a row
 * «Detectada en Loyverse» they did not load means the app matched a cash
 * recarga of the same amount, and the family's card payment is still owed.
 */
export function AppliedTodayList() {
  const [page, setPage] = useState(1);
  const filters = { applied_on: schoolToday(), ordering: '-applied_at' };
  const { data, isLoading, isError, refetch } = useTopUpsList({ page, ...filters }, LIVE);
  const count = data?.count ?? 0;
  const columns: Column<TopUpLogEntry>[] = [
    { id: 'at', header: 'Hora', hideable: false, className: 'whitespace-nowrap text-muted', cell: (d) => when(d.applied_at) },
    {
      id: 'student', header: 'Alumno', minWidth: 170, className: 'font-medium text-ink',
      cell: (d) => (
        <span className="block">
          <Link to={`/admin/cafeteria/${d.student_id}`} className="hover:text-brand-700">{d.student_name}</Link>
          <span className="block text-xs text-subtle">{d.student_code}</span>
        </span>
      ),
    },
    { id: 'loyverse', header: 'Cliente Loyverse', className: 'font-mono text-xs text-ink', cell: (d) => d.loyverse_code || '—' },
    { id: 'amount', header: 'Monto', align: 'right', hideable: false, className: 'font-semibold text-ink', cell: (d) => mxn(d.amount) },
    {
      id: 'how', header: 'Cómo se aplicó', minWidth: 190,
      cell: (d) => (
        <span className="block text-xs">
          <Badge variant={d.applied_via === 'override' ? 'warning' : d.applied_via === 'pos_sync' ? 'info' : 'success'}>
            {d.applied_via_display || '—'}
          </Badge>
          {d.applied_by_name && <span className="mt-0.5 block text-subtle">{d.applied_by_name}</span>}
        </span>
      ),
    },
    { id: 'folio', header: 'Folio', className: 'font-mono text-xs text-ink', cell: (d) => d.payment_id ?? '—' },
  ];
  return (
    <Card>
      <div className="mb-4 max-w-2xl">
        <h2 className="flex items-center gap-2 font-head text-base font-semibold text-ink">
          <CheckCircle2 className="h-4 w-4 text-green-700" aria-hidden="true" /> Aplicadas hoy
        </h2>
        <p className="mt-1 text-sm text-muted">
          Compárelas con lo que cargó en el POS. Si aparece «Detectada en Loyverse» en una recarga que usted no
          cargó, el sistema la relacionó con una recarga en efectivo del mismo monto: cargue también la recarga
          con tarjeta y avise a dirección.
        </p>
      </div>
      <DataTable<TopUpLogEntry>
        tableId="cafeteria-pos-applied-today"
        columns={columns}
        rows={data?.results}
        rowKey={(d) => d.id}
        rowLabel={(d) => `recarga aplicada de ${d.student_name}`}
        caption="Recargas aplicadas hoy"
        page={page}
        count={count}
        onPage={setPage}
        itemLabel="recargas"
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        empty={{ icon: CheckCircle2, title: 'Ninguna aplicada hoy', description: 'Aquí aparecen las recargas con tarjeta que llegan al saldo durante el día.' }}
      />
    </Card>
  );
}

/** What staff must type at the POS. */
function LoadFacts({ row }: { row: TopUpLogEntry }) {
  return (
    <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 rounded-lg bg-cream px-3 py-2 text-xs leading-5 text-ink">
      <dt className="text-muted">Alumno</dt><dd>{row.student_name} <span className="text-subtle">({row.student_code})</span></dd>
      <dt className="text-muted">Cliente Loyverse</dt><dd className="font-mono">{row.loyverse_code || '—'}</dd>
      <dt className="text-muted">Monto a cargar</dt><dd className="font-semibold">{mxn(row.amount)}</dd>
      <dt className="text-muted">Folio</dt><dd className="font-mono">{row.payment_id ?? '—'}</dd>
    </dl>
  );
}

/** «Aplicar»: the server checks Loyverse first; if it cannot confirm the load, staff
 *  may still apply with a reason (it then stays in «Cargar en POS»). */
export function ApplyPaidDialog({ row, onClose }: { row: TopUpLogEntry | null; onClose: () => void }) {
  return (
    <Modal open={!!row} onClose={onClose} title="Aplicar recarga cargada en el POS" maxWidth={500}>
      {row && <ApplyPaidForm key={row.id} row={row} onClose={onClose} />}
    </Modal>
  );
}

function ApplyPaidForm({ row, onClose }: { row: TopUpLogEntry; onClose: () => void }) {
  const invalidate = useInvalidateMoney();
  const [refusal, setRefusal] = useState<{ message: string; code?: string; points?: string; wallet?: string } | null>(null);
  const [force, setForce] = useState(false);
  const [note, setNote] = useState('');
  const apply = useMutation({
    mutationFn: () => cafeteriaAdminApi.applyPaidTopUp(row.id, force ? { force: true, note: note.trim() } : {}),
    onSuccess: ({ data }) => {
      toast.success(data.detail || 'Recarga aplicada.');
      onClose();
      void invalidate();
    },
    onError: (err) => {
      const fields = apiFieldErrors(err);
      const code = apiErrorCode(err);
      if (code === 'already_applied') {
        toast.success('Esta recarga ya estaba aplicada.');
        onClose();
        void invalidate();
        return;
      }
      setRefusal({
        message: apiErrorMessage(err, 'No se pudo aplicar la recarga.'),
        code,
        points: fields.loyverse_points,
        wallet: fields.wallet_balance,
      });
    },
  });
  const canForce = refusal?.code === 'pos_not_loaded' || refusal?.code === 'pos_unknown';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (force && !note.trim()) return;
    apply.mutate();
  };
  return (
    <form className="space-y-4" onSubmit={submit}>
      <p className="text-sm text-muted">
        Confirme que ya cargó este monto al cliente del alumno en el POS de Loyverse. Antes de sumarlo al
        saldo, el sistema revisa que Loyverse lo muestre.
      </p>
      <LoadFacts row={row} />
      {refusal && (
        <div role="alert" className="space-y-1 rounded-lg border border-coral/40 bg-coral-50 px-3 py-2 text-sm text-ink">
          <p>{refusal.message}</p>
          {refusal.points && (
            <p className="text-xs text-muted">Loyverse: {mxn(refusal.points)} · App: {mxn(refusal.wallet)}</p>
          )}
        </div>
      )}
      {canForce && (
        <div className="space-y-2 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-sm text-ink">
          <label className="flex min-h-[44px] cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-line text-purple focus:ring-purple/40"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
            />
            <span>
              Aplicar sin la confirmación de Loyverse. Quedará en «Cargar en POS» hasta que marque que está
              cargada. Úselo solo si está seguro (por ejemplo, el alumno compró justo después de la carga).
            </span>
          </label>
          {force && (
            <Input label="Motivo (obligatorio)" maxLength={500} required value={note} onChange={(e) => setNote(e.target.value)} />
          )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
        <Button type="submit" size="sm" loading={apply.isPending} disabled={force && !note.trim()}>
          {force ? 'Aplicar sin verificar' : refusal ? 'Reintentar' : 'Ya la cargué: aplicar'}
        </Button>
      </div>
    </form>
  );
}

/** «Devolver»: the card was refunded in MultiCobros before the top-up was applied. */
export function RefundPaidDialog({ row, onClose }: { row: TopUpLogEntry | null; onClose: () => void }) {
  return (
    <Modal open={!!row} onClose={onClose} title="Devolver pago sin aplicar" maxWidth={500}>
      {row && <RefundPaidForm key={row.id} row={row} onClose={onClose} />}
    </Modal>
  );
}

function RefundPaidForm({ row, onClose }: { row: TopUpLogEntry; onClose: () => void }) {
  const invalidate = useInvalidateMoney();
  const realCharge = !!row.banorte && !row.banorte.simulation;
  const [note, setNote] = useState('');
  const [bankDone, setBankDone] = useState(false);
  const [notInPos, setNotInPos] = useState(false);
  const refund = useMutation({
    mutationFn: () => cafeteriaAdminApi.refundPaidTopUp(row.id, {
      note: note.trim(), bank_refund_confirmed: bankDone, pos_not_loaded_confirmed: notInPos,
    }),
    onSuccess: () => {
      toast.success('Pago devuelto. La recarga no se aplicó.');
      onClose();
      void invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'No se pudo registrar la devolución.')),
  });
  const ready = !!note.trim() && notInPos && (!realCharge || bankDone);
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (ready) refund.mutate(); }}>
      <p className="text-sm text-muted">
        Para una recarga que todavía no se aplica. El saldo no cambia; se avisa a la familia.
      </p>
      <LoadFacts row={row} />
      <Input label="Motivo" maxLength={500} required value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="space-y-1 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-sm text-ink">
        {realCharge && (
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5">
            <input type="checkbox" className="h-4 w-4 rounded border-line text-purple focus:ring-purple/40" checked={bankDone} onChange={(e) => setBankDone(e.target.checked)} />
            Ya hice la devolución del cargo en MultiCobros (Banorte)
          </label>
        )}
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5">
          <input type="checkbox" className="h-4 w-4 rounded border-line text-purple focus:ring-purple/40" checked={notInPos} onChange={(e) => setNotInPos(e.target.checked)} />
          Este monto no está cargado en el POS de Loyverse (o ya lo quité)
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
        <Button type="submit" size="sm" variant="danger" loading={refund.isPending} disabled={!ready}>
          Devolver pago
        </Button>
      </div>
    </form>
  );
}

export default PaidTopUpQueue;
