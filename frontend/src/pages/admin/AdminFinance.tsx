import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Receipt, Search, PlusCircle, CheckCircle2, Ban, SlidersHorizontal,
  TrendingUp, Wallet, AlertTriangle, History, Bell, X,
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
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Pagination } from '@/components/ui/Pagination';
import { financeApi } from '@/services/api';
import { toPaged, ADMIN_PAGE_SIZE } from '@/lib/pagination';
import type { Invoice, InvoiceAdjustment, FinanceDashboard } from '@/types';

const statusMeta: Record<string, { label: string; variant: any }> = {
  paid:      { label: 'Pagada',    variant: 'success' },
  pending:   { label: 'Pendiente', variant: 'warning' },
  overdue:   { label: 'Vencida',   variant: 'error' },
  cancelled: { label: 'Cancelada', variant: 'neutral' },
};

type BulkAction = 'mark_paid' | 'cancel' | 'remind';

const bulkMeta: Record<BulkAction, { confirmLabel: string; requireText?: string; verb: (n: number) => string }> = {
  mark_paid: {
    confirmLabel: 'Marcar pagadas',
    verb: (n) => `Se marcarán como pagadas ${n} colegiatura(s) seleccionada(s) y se registrará el pago en caja.`,
  },
  remind: {
    confirmLabel: 'Enviar recordatorio',
    verb: (n) => `Se enviará un recordatorio de pago a los tutores de ${n} colegiatura(s) seleccionada(s).`,
  },
  cancel: {
    confirmLabel: 'Cancelar colegiaturas',
    requireText: 'CANCELAR',
    verb: (n) =>
      `Esto cancelará ${n} colegiatura(s) seleccionada(s). Las facturas quedarán anuladas y no podrán cobrarse. Esta acción no se puede deshacer.`,
  },
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
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [adjustFor, setAdjustFor] = useState<Invoice | null>(null);
  const [cancelFor, setCancelFor] = useState<Invoice | null>(null);
  const [bulkFor, setBulkFor] = useState<BulkAction | null>(null);
  const [historyFor, setHistoryFor] = useState<Invoice | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['finance-dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['finance-admin-invoices'] });
  };

  /** Reset paging + selection whenever the filter set changes. */
  const onFilter = (fn: () => void) => { fn(); setPage(1); setSelected(new Set()); };

  const { data: dashboard } = useQuery<FinanceDashboard>({
    queryKey: ['finance-dashboard', period],
    queryFn: async () => (await financeApi.getDashboard(period)).data,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['finance-admin-invoices', period, statusFilter, search, page],
    queryFn: async () =>
      toPaged<Invoice>(
        (await financeApi.getAdminInvoices({
          period, status: statusFilter || undefined, q: search || undefined, page,
        })).data,
      ),
    placeholderData: keepPreviousData,
  });

  const invoices = data?.results;
  const count = data?.count ?? 0;

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
    onSuccess: () => { toast.success('Factura cancelada.'); setCancelFor(null); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'No se pudo cancelar.'),
  });

  const bulk = useMutation({
    mutationFn: (action: BulkAction) => financeApi.bulkAction([...selected], action),
    onSuccess: ({ data }) => {
      const failed = data?.failed ?? 0;
      if (failed > 0) {
        toast.success(`${data.done} colegiatura(s) actualizada(s); ${failed} con error (estado no aplicable).`);
      } else {
        toast.success(`${data.done} colegiatura(s) actualizada(s).`);
      }
      setBulkFor(null);
      setSelected(new Set());
      invalidate();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'No se pudo completar la acción masiva.'),
  });

  // Selection helpers (scoped to the current page).
  const pageIds = invoices?.map((i) => i.id) ?? [];
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-fluid-xl font-bold text-ink">Finanzas — Colegiaturas</h1>
          <p className="text-muted text-sm mt-0.5">
            Facturación mensual, cobranza y estado de cuenta.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            className="input-field w-auto"
            aria-label="Periodo"
            value={period}
            onChange={(e) => onFilter(() => setPeriod(e.target.value))}
          />
          <Button size="sm" loading={generate.isPending} onClick={() => generate.mutate()}>
            <PlusCircle className="w-4 h-4" /> Generar
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={Wallet} label="Facturado" value={`$${dashboard?.billed ?? '0.00'}`} tone="muted" />
        <KpiCard icon={TrendingUp} label="Cobrado" value={`$${dashboard?.collected ?? '0.00'}`} tone="green" />
        <KpiCard icon={AlertTriangle} label="Pendiente" value={`$${dashboard?.outstanding ?? '0.00'}`} tone="coral" />
        <KpiCard icon={Receipt} label="Tasa de cobro" value={`${dashboard?.collection_rate ?? 0}%`} tone="brand" />
      </div>

      {/* Filters */}
      <Card>
        <div className="flex flex-wrap items-center gap-3 mb-1">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
            <input
              className="input-field pl-9"
              placeholder="Buscar alumno o matrícula…"
              aria-label="Buscar alumno o matrícula"
              value={search}
              onChange={(e) => onFilter(() => setSearch(e.target.value))}
            />
          </div>
          <select
            className="input-field w-auto"
            aria-label="Estado"
            value={statusFilter}
            onChange={(e) => onFilter(() => setStatusFilter(e.target.value))}
          >
            <option value="">Todos los estados</option>
            <option value="pending">Pendiente</option>
            <option value="overdue">Vencida</option>
            <option value="paid">Pagada</option>
            <option value="cancelled">Cancelada</option>
          </select>
        </div>
        <p className="mb-4 text-xs text-subtle">La selección aplica a la página actual.</p>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl2 border border-brand-200 bg-brand-50 px-3 py-2">
            <span className="text-sm font-semibold text-brand-700">
              {selected.size} seleccionada(s)
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => setBulkFor('mark_paid')}>
                <CheckCircle2 className="w-3.5 h-3.5" /> Marcar pagadas
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setBulkFor('remind')}>
                <Bell className="w-3.5 h-3.5" /> Recordatorio
              </Button>
              <Button size="sm" variant="danger" onClick={() => setBulkFor('cancel')}>
                <Ban className="w-3.5 h-3.5" /> Cancelar
              </Button>
            </div>
            <button
              type="button"
              className="ml-auto inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              onClick={() => setSelected(new Set())}
            >
              <X className="w-3.5 h-3.5" /> Quitar selección
            </button>
          </div>
        )}

        {isLoading ? (
          <LoadingSpinner />
        ) : !invoices?.length ? (
          <EmptyState
            icon={Receipt}
            title={search || statusFilter ? 'Sin resultados' : 'Sin colegiaturas'}
            description={
              search || statusFilter
                ? 'Ninguna colegiatura coincide con los filtros.'
                : 'Genere las colegiaturas del periodo con el botón «Generar».'
            }
          />
        ) : (
          <>
            {/* Mobile: stacked cards */}
            <ul className="space-y-3 md:hidden">
              {invoices.map((inv) => {
                const meta = statusMeta[inv.status] ?? statusMeta.pending;
                const open = inv.status === 'pending' || inv.status === 'overdue';
                return (
                  <li key={inv.id} className="rounded-xl2 border border-line p-4">
                    <div className="flex items-start gap-1">
                      <label className="-ml-2 flex h-11 w-11 flex-shrink-0 cursor-pointer items-center justify-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-brand-600"
                          checked={selected.has(inv.id)}
                          onChange={() => toggle(inv.id)}
                          aria-label={`Seleccionar la colegiatura de ${inv.student_name}`}
                        />
                      </label>
                      <div className="min-w-0 flex-1 pt-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium text-ink truncate">{inv.student_name}</p>
                            <p className="text-xs text-subtle">{inv.student_code} · {inv.grade}</p>
                          </div>
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                        </div>
                        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <dt className="text-xs font-semibold text-muted">Periodo</dt>
                            <dd className="text-muted">{inv.period_label}</dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold text-muted">Vence</dt>
                            <dd className="text-muted">{format(new Date(inv.due_date), 'd MMM yyyy', { locale: es })}</dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold text-muted">Monto</dt>
                            <dd className="font-semibold text-ink">${parseFloat(inv.amount).toFixed(2)}</dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold text-muted">Saldo</dt>
                            <dd className="text-muted">${parseFloat(inv.balance_due).toFixed(2)}</dd>
                          </div>
                        </dl>
                        <div className="mt-3 flex flex-wrap items-center gap-1">
                          <InvoiceActions
                            inv={inv}
                            open={open}
                            markPaid={markPaid}
                            cancel={cancel}
                            onAdjust={setAdjustFor}
                            onCancel={setCancelFor}
                            onHistory={setHistoryFor}
                          />
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Desktop: dense table */}
            <div className="admin-table-wrap hidden md:block">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th className="w-10">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand-600 align-middle"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Seleccionar todas las colegiaturas de la página"
                      />
                    </th>
                    <th>Alumno</th>
                    <th>Periodo</th>
                    <th>Vence</th>
                    <th className="num">Monto</th>
                    <th className="num">Saldo</th>
                    <th>Estado</th>
                    <th className="num">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => {
                    const meta = statusMeta[inv.status] ?? statusMeta.pending;
                    const open = inv.status === 'pending' || inv.status === 'overdue';
                    return (
                      <tr key={inv.id} className={selected.has(inv.id) ? 'bg-brand-50/60' : undefined}>
                        <td>
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-brand-600 align-middle"
                            checked={selected.has(inv.id)}
                            onChange={() => toggle(inv.id)}
                            aria-label={`Seleccionar la colegiatura de ${inv.student_name}`}
                          />
                        </td>
                        <td className="font-medium text-ink">
                          {inv.student_name}
                          <span className="block text-xs text-subtle">{inv.student_code} · {inv.grade}</span>
                        </td>
                        <td className="text-muted">{inv.period_label}</td>
                        <td className="text-muted whitespace-nowrap">
                          {format(new Date(inv.due_date), 'd MMM yyyy', { locale: es })}
                        </td>
                        <td className="num font-semibold text-ink">${parseFloat(inv.amount).toFixed(2)}</td>
                        <td className="num text-muted">${parseFloat(inv.balance_due).toFixed(2)}</td>
                        <td><Badge variant={meta.variant}>{meta.label}</Badge></td>
                        <td>
                          <div className="flex items-center justify-end gap-1">
                            <InvoiceActions
                              inv={inv}
                              open={open}
                              markPaid={markPaid}
                              cancel={cancel}
                              onAdjust={setAdjustFor}
                              onCancel={setCancelFor}
                              onHistory={setHistoryFor}
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

        <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} count={count} onChange={setPage} itemLabel="colegiaturas" />
      </Card>

      <AdjustModal invoice={adjustFor} onClose={() => setAdjustFor(null)} onDone={invalidate} />

      <AuditTrailModal invoice={historyFor} onClose={() => setHistoryFor(null)} />

      {/* Single-invoice cancel — irreversible: type-to-confirm */}
      <ConfirmDialog
        open={!!cancelFor}
        title="Cancelar colegiatura"
        confirmLabel="Cancelar colegiatura"
        requireText="CANCELAR"
        loading={cancel.isPending}
        onClose={() => setCancelFor(null)}
        onConfirm={() => cancelFor && cancel.mutate(cancelFor.id)}
        message={
          cancelFor && (
            <>
              Esto cancelará la colegiatura de{' '}
              <span className="font-semibold text-ink">{cancelFor.student_name}</span> del periodo{' '}
              <span className="font-semibold text-ink">{cancelFor.period_label}</span> por{' '}
              <span className="font-semibold text-ink">${parseFloat(cancelFor.amount).toFixed(2)}</span>.
              La factura quedará anulada y no podrá cobrarse. Esta acción no se puede deshacer.
            </>
          )
        }
      />

      {/* Bulk action confirm — cancel is irreversible (type-to-confirm) */}
      <ConfirmDialog
        open={!!bulkFor}
        title={bulkFor ? bulkMeta[bulkFor].confirmLabel : ''}
        confirmLabel={bulkFor ? bulkMeta[bulkFor].confirmLabel : ''}
        requireText={bulkFor ? bulkMeta[bulkFor].requireText : undefined}
        loading={bulk.isPending}
        onClose={() => setBulkFor(null)}
        onConfirm={() => bulkFor && bulk.mutate(bulkFor)}
        message={bulkFor ? bulkMeta[bulkFor].verb(selected.size) : ''}
      />
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
  onCancel,
  onHistory,
}: {
  inv: Invoice;
  open: boolean;
  markPaid: InvoiceMutation;
  cancel: InvoiceMutation;
  onAdjust: (inv: Invoice) => void;
  onCancel: (inv: Invoice) => void;
  onHistory: (inv: Invoice) => void;
}) {
  return (
    <>
      {open && (
        <Button size="sm" variant="ghost" title="Marcar pagada"
          aria-label={`Marcar pagada la colegiatura de ${inv.student_name}`}
          loading={markPaid.isPending && markPaid.variables === inv.id}
          onClick={() => markPaid.mutate(inv.id)}>
          <CheckCircle2 className="w-4 h-4 text-green-700" />
        </Button>
      )}
      {inv.status !== 'cancelled' && inv.status !== 'paid' && (
        <Button size="sm" variant="ghost" title="Ajustar monto"
          aria-label={`Ajustar la colegiatura de ${inv.student_name}`}
          onClick={() => onAdjust(inv)}>
          <SlidersHorizontal className="w-4 h-4 text-muted" />
        </Button>
      )}
      <Button size="sm" variant="ghost" title="Historial de ajustes"
        aria-label={`Ver historial de ajustes de ${inv.student_name}`}
        onClick={() => onHistory(inv)}>
        <History className="w-4 h-4 text-muted" />
      </Button>
      {open && (
        <Button size="sm" variant="ghost" title="Cancelar"
          aria-label={`Cancelar la colegiatura de ${inv.student_name}`}
          loading={cancel.isPending && cancel.variables === inv.id}
          onClick={() => onCancel(inv)}>
          <Ban className="w-4 h-4 text-coral-600" />
        </Button>
      )}
    </>
  );
}

function KpiCard({ icon: Icon, label, value, tone }: {
  icon: any; label: string; value: string; tone: 'muted' | 'green' | 'coral' | 'brand';
}) {
  const tones: Record<string, string> = {
    muted: 'text-muted bg-cream',
    green: 'text-green-700 bg-green-50',
    coral: 'text-coral-700 bg-coral-50',
    brand: 'text-brand-700 bg-brand-50',
  };
  return (
    <Card className="flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tones[tone]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-subtle">{label}</p>
        <p className="text-lg font-bold text-ink truncate">{value}</p>
      </div>
    </Card>
  );
}

/** Audit trail (who/what/when/why) for one invoice — InvoiceAdjustment feed. */
function AuditTrailModal({ invoice, onClose }: { invoice: Invoice | null; onClose: () => void }) {
  const { data, isLoading } = useQuery<{ adjustments: InvoiceAdjustment[] }>({
    queryKey: ['finance-admin-invoice-detail', invoice?.id],
    queryFn: async () => (await financeApi.getAdminInvoice(invoice!.id)).data,
    enabled: !!invoice,
  });

  const adjustments = data?.adjustments ?? [];
  const fmt = (d: string) => format(new Date(d), "d MMM yyyy, HH:mm", { locale: es });

  return (
    <Modal open={!!invoice} onClose={onClose} title="Historial de ajustes">
      {invoice && (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            {invoice.student_name} · {invoice.period_label}
          </p>
          {isLoading ? (
            <LoadingSpinner />
          ) : !adjustments.length ? (
            <EmptyState icon={History} title="Sin ajustes registrados" />
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th className="num">Monto</th>
                    <th>Motivo</th>
                    <th>Admin</th>
                  </tr>
                </thead>
                <tbody>
                  {adjustments.map((a) => (
                    <tr key={a.id}>
                      <td data-label="Fecha" className="whitespace-nowrap text-muted">{fmt(a.created_at)}</td>
                      <td data-label="Tipo"><Badge variant="info">{a.kind_display}</Badge></td>
                      <td data-label="Monto" className={`num font-medium ${parseFloat(a.amount) < 0 ? 'text-coral-600' : 'text-green-700'}`}>
                        {parseFloat(a.amount) < 0 ? '−' : '+'}${Math.abs(parseFloat(a.amount)).toFixed(2)}
                      </td>
                      <td data-label="Motivo" className="text-muted max-w-xs truncate" title={a.reason}>{a.reason}</td>
                      <td data-label="Admin" className="text-muted">{a.admin_name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
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
          <p className="text-sm text-muted">
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
