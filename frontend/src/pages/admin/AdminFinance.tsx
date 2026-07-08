import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Receipt, Search, PlusCircle, CheckCircle2, Ban, SlidersHorizontal,
  TrendingUp, Wallet, AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { financeApi } from '@/services/api';
import type { Invoice, FinanceDashboard } from '@/types';

const statusMeta: Record<string, { label: string; variant: any }> = {
  paid:      { label: 'Pagada',    variant: 'success' },
  pending:   { label: 'Pendiente', variant: 'warning' },
  overdue:   { label: 'Vencida',   variant: 'error' },
  cancelled: { label: 'Cancelada', variant: 'neutral' },
};

/** Current period as YYYY-MM (local). */
function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function AdminFinance() {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState(currentPeriod());
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [adjustFor, setAdjustFor] = useState<Invoice | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['finance-dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['finance-admin-invoices'] });
  };

  const { data: dashboard } = useQuery<FinanceDashboard>({
    queryKey: ['finance-dashboard', period],
    queryFn: async () => (await financeApi.getDashboard(period)).data,
  });

  const { data: invoices, isLoading } = useQuery<Invoice[]>({
    queryKey: ['finance-admin-invoices', period, statusFilter, search],
    queryFn: async () => {
      const { data } = await financeApi.getAdminInvoices({
        period, status: statusFilter || undefined, q: search || undefined,
      });
      return data.results ?? data;
    },
  });

  const generate = useMutation({
    mutationFn: () => financeApi.generate(period),
    onSuccess: ({ data }) => {
      toast.success(`Generación: ${data.created} nuevas, ${data.existing} existentes, ${data.skipped} omitidas.`);
      invalidate();
    },
    onError: () => toast.error('No fue posible generar las colegiaturas.'),
  });

  const markPaid = useMutation({
    mutationFn: (id: number) => financeApi.markPaid(id, 'Pago registrado en caja'),
    onSuccess: () => { toast.success('Marcada como pagada.'); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Error al marcar pagada.'),
  });

  const cancel = useMutation({
    mutationFn: (id: number) => financeApi.cancelInvoice(id, 'Cancelada por administración'),
    onSuccess: () => { toast.success('Factura cancelada.'); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'No se pudo cancelar.'),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-fluid-xl font-bold text-slate-900">Finanzas — Colegiaturas</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Facturación mensual, cobranza y estado de cuenta.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            className="input-field w-auto"
            aria-label="Periodo"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
          <Button size="sm" loading={generate.isPending} onClick={() => generate.mutate()}>
            <PlusCircle className="w-4 h-4" /> Generar
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={Wallet} label="Facturado" value={`$${dashboard?.billed ?? '0.00'}`} tone="slate" />
        <KpiCard icon={TrendingUp} label="Cobrado" value={`$${dashboard?.collected ?? '0.00'}`} tone="emerald" />
        <KpiCard icon={AlertTriangle} label="Pendiente" value={`$${dashboard?.outstanding ?? '0.00'}`} tone="red" />
        <KpiCard icon={Receipt} label="Tasa de cobro" value={`${dashboard?.collection_rate ?? 0}%`} tone="brand" />
      </div>

      {/* Filters */}
      <Card>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              className="input-field pl-9"
              placeholder="Buscar alumno o matrícula…"
              aria-label="Buscar alumno o matrícula"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="input-field w-auto"
            aria-label="Estado"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">Todos los estados</option>
            <option value="pending">Pendiente</option>
            <option value="overdue">Vencida</option>
            <option value="paid">Pagada</option>
            <option value="cancelled">Cancelada</option>
          </select>
        </div>

        {isLoading ? (
          <LoadingSpinner />
        ) : !invoices?.length ? (
          <EmptyState
            icon={Receipt}
            title="Sin colegiaturas"
            description="Genere las colegiaturas del periodo con el botón «Generar»."
          />
        ) : (
          <>
            {/* Mobile: stacked cards */}
            <ul className="space-y-3 md:hidden">
              {invoices.map((inv) => {
                const meta = statusMeta[inv.status] ?? statusMeta.pending;
                const open = inv.status === 'pending' || inv.status === 'overdue';
                return (
                  <li key={inv.id} className="rounded-xl2 border border-slate-100 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 truncate">{inv.student_name}</p>
                        <p className="text-xs text-slate-400">{inv.student_code} · {inv.grade}</p>
                      </div>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <dt className="text-xs font-semibold text-slate-500">Periodo</dt>
                        <dd className="text-slate-600">{inv.period_label}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold text-slate-500">Vence</dt>
                        <dd className="text-slate-500">{format(new Date(inv.due_date), 'd MMM yyyy', { locale: es })}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold text-slate-500">Monto</dt>
                        <dd className="font-semibold text-slate-900">${parseFloat(inv.amount).toFixed(2)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold text-slate-500">Saldo</dt>
                        <dd className="text-slate-700">${parseFloat(inv.balance_due).toFixed(2)}</dd>
                      </div>
                    </dl>
                    <div className="mt-3 flex flex-wrap items-center gap-1">
                      <InvoiceActions
                        inv={inv}
                        open={open}
                        markPaid={markPaid}
                        cancel={cancel}
                        onAdjust={setAdjustFor}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Desktop: table */}
            <div className="hidden md:block w-full overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-semibold text-slate-500">
                    <th className="py-2 pr-4">Alumno</th>
                    <th className="py-2 pr-4">Periodo</th>
                    <th className="py-2 pr-4">Vence</th>
                    <th className="py-2 pr-4 text-right">Monto</th>
                    <th className="py-2 pr-4 text-right">Saldo</th>
                    <th className="py-2 pr-4">Estado</th>
                    <th className="py-2 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {invoices.map((inv) => {
                    const meta = statusMeta[inv.status] ?? statusMeta.pending;
                    const open = inv.status === 'pending' || inv.status === 'overdue';
                    return (
                      <tr key={inv.id} className="hover:bg-slate-50/50">
                        <td className="py-3 pr-4 font-medium text-slate-900">
                          {inv.student_name}
                          <span className="block text-xs text-slate-400">{inv.student_code} · {inv.grade}</span>
                        </td>
                        <td className="py-3 pr-4 text-slate-600">{inv.period_label}</td>
                        <td className="py-3 pr-4 text-slate-500 whitespace-nowrap">
                          {format(new Date(inv.due_date), 'd MMM yyyy', { locale: es })}
                        </td>
                        <td className="py-3 pr-4 text-right font-semibold text-slate-900">${parseFloat(inv.amount).toFixed(2)}</td>
                        <td className="py-3 pr-4 text-right text-slate-700">${parseFloat(inv.balance_due).toFixed(2)}</td>
                        <td className="py-3 pr-4"><Badge variant={meta.variant}>{meta.label}</Badge></td>
                        <td className="py-3">
                          <div className="flex items-center justify-end gap-1">
                            <InvoiceActions
                              inv={inv}
                              open={open}
                              markPaid={markPaid}
                              cancel={cancel}
                              onAdjust={setAdjustFor}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <AdjustModal invoice={adjustFor} onClose={() => setAdjustFor(null)} onDone={invalidate} />
    </div>
  );
}

type InvoiceMutation = {
  isPending: boolean;
  variables?: number;
  mutate: (id: number) => void;
};

function InvoiceActions({
  inv,
  open,
  markPaid,
  cancel,
  onAdjust,
}: {
  inv: Invoice;
  open: boolean;
  markPaid: InvoiceMutation;
  cancel: InvoiceMutation;
  onAdjust: (inv: Invoice) => void;
}) {
  return (
    <>
      {open && (
        <Button size="sm" variant="ghost" title="Marcar pagada"
          aria-label={`Marcar pagada la colegiatura de ${inv.student_name}`}
          loading={markPaid.isPending && markPaid.variables === inv.id}
          onClick={() => markPaid.mutate(inv.id)}>
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
        </Button>
      )}
      {inv.status !== 'cancelled' && inv.status !== 'paid' && (
        <Button size="sm" variant="ghost" title="Ajustar monto"
          aria-label={`Ajustar la colegiatura de ${inv.student_name}`}
          onClick={() => onAdjust(inv)}>
          <SlidersHorizontal className="w-4 h-4 text-slate-500" />
        </Button>
      )}
      {open && (
        <Button size="sm" variant="ghost" title="Cancelar"
          aria-label={`Cancelar la colegiatura de ${inv.student_name}`}
          loading={cancel.isPending && cancel.variables === inv.id}
          onClick={() => cancel.mutate(inv.id)}>
          <Ban className="w-4 h-4 text-red-500" />
        </Button>
      )}
    </>
  );
}

function KpiCard({ icon: Icon, label, value, tone }: {
  icon: any; label: string; value: string; tone: 'slate' | 'emerald' | 'red' | 'brand';
}) {
  const tones: Record<string, string> = {
    slate: 'text-slate-600 bg-slate-100',
    emerald: 'text-emerald-700 bg-emerald-50',
    red: 'text-red-700 bg-red-50',
    brand: 'text-brand-700 bg-brand-50',
  };
  return (
    <Card className="flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tones[tone]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-400">{label}</p>
        <p className="text-lg font-bold text-slate-900 truncate">{value}</p>
      </div>
    </Card>
  );
}

function AdjustModal({ invoice, onClose, onDone }: {
  invoice: Invoice | null; onClose: () => void; onDone: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const adjust = useMutation({
    mutationFn: () => financeApi.adjustInvoice(invoice!.id, parseFloat(amount), reason),
    onSuccess: () => {
      toast.success('Ajuste aplicado.');
      setAmount(''); setReason('');
      onDone();
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'No se pudo aplicar el ajuste.'),
  });

  return (
    <Modal open={!!invoice} onClose={onClose} title="Ajustar colegiatura">
      {invoice && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            {invoice.student_name} · {invoice.period_label}. Use un monto negativo para acreditar
            (descuento) o positivo para un cargo adicional.
          </p>
          <div>
            <label className="label" htmlFor="adjust-amount">Monto (MXN)</label>
            <input
              id="adjust-amount"
              type="number"
              className="input-field"
              placeholder="-500.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="adjust-reason">Motivo</label>
            <input
              id="adjust-reason"
              className="input-field"
              placeholder="Ej. Beca especial, corrección de monto…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
            <Button
              loading={adjust.isPending}
              disabled={!amount || parseFloat(amount) === 0 || !reason.trim()}
              onClick={() => adjust.mutate()}
              className="flex-1"
            >
              Aplicar ajuste
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
