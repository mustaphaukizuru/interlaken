import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, ArrowDownCircle, ArrowUpCircle, RotateCcw, SlidersHorizontal,
  Download, Plus, Minus,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { cafeteriaApi, downloadBlob } from '@/services/api';
import type { CafeteriaStudentDetail, CafeteriaTransaction } from '@/types';

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

  const [refundTx, setRefundTx] = useState<CafeteriaTransaction | null>(null);
  const [refundReason, setRefundReason] = useState('');

  const { data, isLoading } = useQuery<CafeteriaStudentDetail>({
    queryKey: ['admin-cafeteria-student', id],
    queryFn: async () => (await cafeteriaApi.getStudentDetail(id)).data,
    enabled: !!id,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-cafeteria-student', id] });
    queryClient.invalidateQueries({ queryKey: ['admin-cafeteria-balances'] });
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
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'No se pudo aplicar el ajuste.');
    },
  });

  const refundMutation = useMutation({
    mutationFn: () => cafeteriaApi.refundTransaction(refundTx!.id, refundReason),
    onSuccess: () => {
      toast.success('Devolución procesada.');
      setRefundTx(null);
      setRefundReason('');
      invalidate();
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'No se pudo procesar la devolución.');
    },
  });

  const doExport = async (fmt: 'csv' | 'pdf') => {
    try {
      const { data: blob } = await cafeteriaApi.exportStudent(id, fmt);
      downloadBlob(blob, `estado_cafeteria_${data?.balance.student.student_id ?? id}.${fmt}`);
    } catch {
      toast.error('No se pudo generar el archivo.');
    }
  };

  if (isLoading) return <LoadingSpinner />;
  if (!data) return <EmptyState icon={ArrowLeft} title="Alumno no encontrado" />;

  const { balance, parents, transactions, adjustments } = data;
  const isLow = parseFloat(balance.balance) <= parseFloat(balance.low_balance_threshold ?? '50');
  const refundable = (t: CafeteriaTransaction) =>
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
          <h1 className="text-fluid-xl font-bold text-ink">{balance.student.user.full_name}</h1>
          <p className="text-muted text-sm mt-0.5">
            Matrícula {balance.student.student_id} · {balance.student.grade} {balance.student.group}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => doExport('csv')}>
            <Download className="w-3.5 h-3.5" /> CSV
          </Button>
          <Button size="sm" variant="secondary" onClick={() => doExport('pdf')}>
            <Download className="w-3.5 h-3.5" /> PDF
          </Button>
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

      {/* Transactions */}
      <Card>
        <h2 className="font-semibold text-ink mb-3">Movimientos</h2>
        {!transactions.length ? (
          <EmptyState icon={ArrowDownCircle} title="Sin movimientos" />
        ) : (
          <div className="w-full overflow-x-auto rounded-xl2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-semibold text-muted">
                  <th className="py-2 pr-4">Fecha</th>
                  <th className="py-2 pr-4">Tipo</th>
                  <th className="py-2 pr-4">Descripción</th>
                  <th className="py-2 pr-4 text-right">Monto</th>
                  <th className="py-2 pr-4 text-right">Saldo</th>
                  <th className="py-2 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {transactions.map((t) => (
                  <tr key={t.id} className="hover:bg-cream">
                    <td className="py-3 pr-4 whitespace-nowrap text-muted">{fmtDate(t.date)}</td>
                    <td className="py-3 pr-4">
                      <span className="inline-flex items-center gap-1.5">{txIcon(t.transaction_type)} {txLabel(t.transaction_type)}</span>
                    </td>
                    <td className="py-3 pr-4 text-muted max-w-xs truncate" title={t.description}>{t.description || '—'}</td>
                    <td className="py-3 pr-4 text-right font-medium text-ink">${parseFloat(t.amount).toFixed(2)}</td>
                    <td className="py-3 pr-4 text-right text-muted">
                      {t.balance_after !== null ? `$${parseFloat(t.balance_after).toFixed(2)}` : '—'}
                    </td>
                    <td className="py-3 text-right">
                      {refundable(t) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => { setRefundTx(t); setRefundReason(''); }}
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Devolver
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Audit trail */}
      <Card>
        <h2 className="font-semibold text-ink mb-3">Historial de ajustes y devoluciones</h2>
        {!adjustments.length ? (
          <EmptyState icon={SlidersHorizontal} title="Sin ajustes registrados" />
        ) : (
          <div className="w-full overflow-x-auto rounded-xl2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-semibold text-muted">
                  <th className="py-2 pr-4">Fecha</th>
                  <th className="py-2 pr-4">Tipo</th>
                  <th className="py-2 pr-4 text-right">Monto</th>
                  <th className="py-2 pr-4">Motivo</th>
                  <th className="py-2 pr-4">Admin</th>
                  <th className="py-2 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {adjustments.map((a) => (
                  <tr key={a.id}>
                    <td className="py-3 pr-4 whitespace-nowrap text-muted">{fmtDate(a.created_at)}</td>
                    <td className="py-3 pr-4">
                      <Badge variant={a.kind === 'refund' ? 'info' : 'neutral'}>{a.kind_display}</Badge>
                    </td>
                    <td className={`py-3 pr-4 text-right font-medium ${parseFloat(a.amount) < 0 ? 'text-coral-600' : 'text-green-700'}`}>
                      {parseFloat(a.amount) < 0 ? '−' : '+'}${Math.abs(parseFloat(a.amount)).toFixed(2)}
                    </td>
                    <td className="py-3 pr-4 text-muted max-w-xs truncate" title={a.reason}>{a.reason}</td>
                    <td className="py-3 pr-4 text-muted">{a.admin_name || '—'}</td>
                    <td className="py-3 text-right text-muted">
                      {a.balance_after !== null ? `$${parseFloat(a.balance_after).toFixed(2)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

      {/* Refund modal */}
      <Modal open={!!refundTx} onClose={() => setRefundTx(null)} title="Confirmar devolución">
        {refundTx && (
          <form
            onSubmit={(e) => { e.preventDefault(); refundMutation.mutate(); }}
            className="space-y-4"
          >
            <p className="text-sm text-muted">
              Se revertirá la {txLabel(refundTx.transaction_type).toLowerCase()} de{' '}
              <span className="font-semibold">${parseFloat(refundTx.amount).toFixed(2)}</span> del{' '}
              {fmtDate(refundTx.date)}. Se ajustará el saldo y se notificará a los tutores.
            </p>
            <Input
              label="Motivo (opcional)"
              maxLength={500}
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setRefundTx(null)}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" variant="danger" loading={refundMutation.isPending}>
                Procesar devolución
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
