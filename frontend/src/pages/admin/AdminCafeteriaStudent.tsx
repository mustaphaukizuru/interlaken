import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, ArrowDownCircle, ArrowUpCircle, RotateCcw, SlidersHorizontal,
  Plus, Minus,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { cafeteriaApi } from '@/services/api';
import type { CafeteriaStudentDetail } from '@/types';
import { DataTable } from '@/components/ui/DataTable';
import { ExportMenu } from '@/components/admin/ExportMenu';
import { useAdjustmentsList, useTransactionsList, CAF_MONEY_VIEWS } from '@/hooks/queries/cafeteria';
import { invalidateEntity } from '@/hooks/queries/keys';
import { apiErrorMessage } from '@/lib/apiErrors';
import type { AdminTransaction } from '@/services/cafeteriaAdmin';
import type { ExportFormat } from '@/services/dataOps';

const txIcon = (type: string) => {
  if (type === 'topup')      return <ArrowUpCircle className="w-4 h-4 text-brand-500" />;
  if (type === 'refund')     return <RotateCcw className="w-4 h-4 text-brand-500" />;
  if (type === 'adjustment') return <SlidersHorizontal className="w-4 h-4 text-purple" />;
  return <ArrowDownCircle className="w-4 h-4 text-subtle" />;
};

const txLabel = (type: string) => {
  if (type === 'topup')      return 'Recarga';
  if (type === 'refund')     return 'Devolución';
  if (type === 'adjustment') return 'Ajuste';
  return 'Compra';
};

const fmtDate = (d: string) => format(new Date(d), "d 'de' MMM yyyy, HH:mm", { locale: es });

export default function AdminCafeteriaStudent() {
  const { studentId } = useParams<{ studentId: string }>();
  const id = Number(studentId);
  const queryClient = useQueryClient();

  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustSign, setAdjustSign] = useState<1 | -1>(1);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');

  const [refundTx, setRefundTx] = useState<AdminTransaction | null>(null);
  // Ledger and adjustment trail are paged server-side (they grow without bound).
  const [txPage, setTxPage] = useState(1);
  const [adjPage, setAdjPage] = useState(1);
  const [refundReason, setRefundReason] = useState('');

  const { data, isLoading, isError, refetch } = useQuery<CafeteriaStudentDetail>({
    queryKey: ['admin-cafeteria-student', id],
    queryFn: async () => (await cafeteriaApi.getStudentDetail(id, { ledger: 0 })).data,
    enabled: !!id,
  });
  const txs = useTransactionsList({ student: id, page: txPage }, { enabled: !!id });
  const adjs = useAdjustmentsList({ student: id, page: adjPage }, { enabled: !!id });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-cafeteria-student', id] });
    void invalidateEntity(queryClient, CAF_MONEY_VIEWS[0], CAF_MONEY_VIEWS);
  };

  const adjustMutation = useMutation({
    mutationFn: () =>
      cafeteriaApi.adjustBalance(id, adjustSign * parseFloat(adjustAmount), adjustReason),
    onSuccess: () => {
      toast.success('Ajuste aplicado.');
      setShowAdjust(false);
      setAdjustAmount('');
      setAdjustReason('');
      invalidate();
    },
    onError: (e: unknown) => toast.error(apiErrorMessage(e, 'No se pudo aplicar el ajuste.')),
  });

  const refundMutation = useMutation({
    mutationFn: () => cafeteriaApi.refundTransaction(refundTx!.id, refundReason),
    onSuccess: () => {
      toast.success('Devolución procesada.');
      setRefundTx(null);
      setRefundReason('');
      invalidate();
    },
    onError: (e: unknown) => toast.error(apiErrorMessage(e, 'No se pudo procesar la devolución.')),
  });

  // The statement (header + full ledger) is its own document, not a list view.
  const fetchStatement = async (fmt: ExportFormat) =>
    (await cafeteriaApi.exportStudent(id, fmt === 'pdf' ? 'pdf' : 'csv')).data as Blob;

  if (isLoading) return <LoadingSpinner />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;
  if (!data) return <EmptyState icon={ArrowLeft} title="Alumno no encontrado" />;

  const { balance, parents, loyverse } = data;
  const isLow = parseFloat(balance.balance) <= parseFloat(balance.low_balance_threshold ?? '50');
  const refundable = (t: AdminTransaction) =>
    t.transaction_type === 'purchase' || t.transaction_type === 'topup';

  return (
    <div className="space-y-6">
      <div>
        <Link to="/admin/cafeteria" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
          <ArrowLeft className="w-4 h-4" /> Volver a cafetería
        </Link>
      </div>

      {/* Header: student + balance + actions */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-head text-fluid-xl font-bold leading-tight tracking-[-0.3px] text-ink">{balance.student.user.full_name}</h1>
          <p className="text-muted text-sm mt-0.5">
            Matrícula {balance.student.student_id} · {balance.student.grade} {balance.student.group}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportMenu
            label="Estado de cuenta"
            formats={['csv', 'pdf']}
            filenamePrefix={`estado_cafeteria_${balance.student.student_id}`}
            fetch={(fmt) => fetchStatement(fmt)}
          />
          <Button size="sm" onClick={() => { setAdjustSign(1); setShowAdjust(true); }}>
            <SlidersHorizontal className="w-3.5 h-3.5" /> Ajustar saldo
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-subtle">Saldo actual</p>
          <p className="mt-1 text-2xl font-bold text-ink">${parseFloat(balance.balance).toFixed(2)}</p>
          <Badge variant={isLow ? 'warning' : 'success'} className="mt-2">
            {isLow ? 'Saldo bajo' : 'Normal'}
          </Badge>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-subtle">Última sincronización</p>
          <p className="mt-1 text-sm text-muted">
            {balance.last_synced ? fmtDate(balance.last_synced) : '—'}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-subtle">Padres/Tutores</p>
          {parents.length ? (
            <ul className="mt-1 space-y-0.5 text-sm text-muted">
              {parents.map((p) => (
                <li key={p.id} className="truncate" title={p.email}>{p.full_name}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-subtle">Sin tutores vinculados</p>
          )}
        </Card>
      </div>

      {/* Loyverse customer snapshot — full visit history + lifetime spend */}
      {loyverse && (
        <Card>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-semibold text-ink">Información de Loyverse</h2>
            <span className="text-[11px] text-subtle">
              Sincronizado {fmtDate(loyverse.synced_at)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
            {[
              { label: 'Visitas', value: loyverse.total_visits.toLocaleString('es-MX') },
              { label: 'Gasto total', value: `$${parseFloat(loyverse.total_spent).toFixed(2)}` },
              { label: 'Puntos', value: parseFloat(loyverse.total_points).toFixed(2) },
              { label: 'Grado (Loyverse)', value: loyverse.address_code || '—' },
              { label: 'Primera visita', value: loyverse.first_visit ? fmtDate(loyverse.first_visit) : '—' },
              { label: 'Última visita', value: loyverse.last_visit ? fmtDate(loyverse.last_visit) : '—' },
              { label: 'Teléfono', value: loyverse.phone_number || '—' },
              { label: 'Alta en Loyverse', value: loyverse.loyverse_created_at ? fmtDate(loyverse.loyverse_created_at) : '—' },
            ].map((f) => (
              <div key={f.label}>
                <p className="text-xs font-semibold uppercase tracking-wide text-subtle">{f.label}</p>
                <p className="mt-0.5 text-sm font-medium text-ink">{f.value}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Transactions */}
      <Card>
        <h2 className="font-semibold text-ink mb-3">Movimientos</h2>
        {(
          <DataTable<AdminTransaction>
            rows={txs.data?.results}
            rowKey={(t) => t.id}
            page={txPage}
            count={txs.data?.count ?? 0}
            onPage={setTxPage}
            itemLabel="movimientos"
            isLoading={txs.isLoading}
            isError={txs.isError}
            onRetry={() => txs.refetch()}
            caption="Movimientos del alumno"
            empty={{ icon: ArrowDownCircle, title: 'Sin movimientos' }}
            columns={[
              { header: 'Fecha', className: 'whitespace-nowrap text-muted', cell: (t) => fmtDate(t.date) },
              { header: 'Tipo', cell: (t) => <span className="inline-flex items-center gap-1.5">{txIcon(t.transaction_type)} {txLabel(t.transaction_type)}</span> },
              { header: 'Descripción', className: 'text-muted', cell: (t) => <span className="block min-w-0 max-w-xs truncate" title={t.description}>{t.description || '—'}</span> },
              { header: 'Monto', align: 'right', className: 'font-medium text-ink', cell: (t) => `$${parseFloat(t.amount).toFixed(2)}` },
              { header: 'Saldo', align: 'right', className: 'text-muted', cell: (t) => (t.applied === false ? <span className="text-xs" title="Compra anterior al alta: ya estaba incluida en el saldo inicial">incl. saldo inicial</span> : t.balance_after !== null ? `$${parseFloat(t.balance_after).toFixed(2)}` : '—') },
              {
                header: 'Acción', align: 'right',
                cell: (t) => refundable(t) && (
                  <Button size="sm" variant="ghost" onClick={() => { setRefundTx(t); setRefundReason(''); }}>
                    <RotateCcw className="w-3.5 h-3.5" /> Devolver
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>

      {/* Audit trail */}
      <Card>
        <h2 className="font-semibold text-ink mb-3">Historial de ajustes y devoluciones</h2>
        {(
          <DataTable
            rows={adjs.data?.results}
            rowKey={(a) => a.id}
            page={adjPage}
            count={adjs.data?.count ?? 0}
            onPage={setAdjPage}
            itemLabel="ajustes"
            isLoading={adjs.isLoading}
            isError={adjs.isError}
            onRetry={() => adjs.refetch()}
            caption="Historial de ajustes y devoluciones"
            empty={{ icon: SlidersHorizontal, title: 'Sin ajustes registrados' }}
            columns={[
              { header: 'Fecha', className: 'whitespace-nowrap text-muted', cell: (a) => fmtDate(a.created_at) },
              { header: 'Tipo', cell: (a) => <Badge variant={a.kind === 'refund' ? 'info' : 'neutral'}>{a.kind_display}</Badge> },
              {
                header: 'Monto', align: 'right',
                cell: (a) => (
                  <span className={`font-medium ${parseFloat(a.amount) < 0 ? 'text-coral-600' : 'text-green-700'}`}>
                    {parseFloat(a.amount) < 0 ? '−' : '+'}${Math.abs(parseFloat(a.amount)).toFixed(2)}
                  </span>
                ),
              },
              { header: 'Motivo', className: 'text-muted', cell: (a) => <span className="block min-w-0 max-w-xs truncate" title={a.reason}>{a.reason}</span> },
              { header: 'Admin', className: 'text-muted', cell: (a) => a.admin_name || '—' },
              { header: 'Saldo', align: 'right', className: 'text-muted', cell: (a) => (a.balance_after !== null ? `$${parseFloat(a.balance_after).toFixed(2)}` : '—') },
            ]}
          />
        )}
      </Card>

      {/* Adjust modal */}
      <Modal open={showAdjust} onClose={() => setShowAdjust(false)} title="Ajuste manual de saldo">
        <form
          onSubmit={(e) => { e.preventDefault(); adjustMutation.mutate(); }}
          className="space-y-4"
        >
          <div className="flex gap-2">
            <Button
              type="button"
              variant={adjustSign === 1 ? 'primary' : 'secondary'}
              size="sm"
              className="flex-1"
              onClick={() => setAdjustSign(1)}
            >
              <Plus className="w-3.5 h-3.5" /> Abonar
            </Button>
            <Button
              type="button"
              variant={adjustSign === -1 ? 'danger' : 'secondary'}
              size="sm"
              className="flex-1"
              onClick={() => setAdjustSign(-1)}
            >
              <Minus className="w-3.5 h-3.5" /> Descontar
            </Button>
          </div>
          <Input
            label="Monto (MXN)"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={adjustAmount}
            onChange={(e) => setAdjustAmount(e.target.value)}
          />
          <Input
            label="Motivo"
            required
            maxLength={500}
            value={adjustReason}
            onChange={(e) => setAdjustReason(e.target.value)}
            placeholder="Ej. Reembolso de cortesía, corrección…"
          />
          <p className="text-xs text-muted">
            Este movimiento queda registrado en la auditoría y se notifica a los tutores.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowAdjust(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              size="sm"
              variant={adjustSign === -1 ? 'danger' : 'primary'}
              loading={adjustMutation.isPending}
              disabled={!adjustAmount || !adjustReason}
            >
              {adjustSign === 1 ? 'Abonar' : 'Descontar'} ${adjustAmount || '0.00'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Refund — irreversible money movement: type-to-confirm */}
      <ConfirmDialog
        open={!!refundTx}
        title="Confirmar devolución"
        confirmLabel="Procesar devolución"
        requireText="DEVOLVER"
        loading={refundMutation.isPending}
        onClose={() => setRefundTx(null)}
        onConfirm={() => refundMutation.mutate()}
        message={
          refundTx && (
            <>
              Se revertirá la {txLabel(refundTx.transaction_type).toLowerCase()} de{' '}
              <span className="font-semibold text-ink">${parseFloat(refundTx.amount).toFixed(2)}</span> del{' '}
              {fmtDate(refundTx.date)}. Se ajustará el saldo y se notificará a los tutores.
              Esta acción no se puede deshacer.
            </>
          )
        }
      >
        <Input
          label="Motivo (opcional)"
          maxLength={500}
          value={refundReason}
          onChange={(e) => setRefundReason(e.target.value)}
        />
      </ConfirmDialog>
    </div>
  );
}
