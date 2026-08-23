import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CreditCard, CheckCircle, Clock, XCircle, Coffee, ArrowRight, RotateCcw, FileDown, Wallet, CalendarDays, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/layout/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { ActiveFilterChips } from '@/components/admin/ActiveFilterChips';
import { ADMIN_PAGE_SIZE, toPaged } from '@/lib/pagination';
import { formatMXN } from '@/lib/format';
import { useUrlFilters, useUrlPage } from '@/hooks/useUrlFilters';
import { paymentsApi, downloadBlob, type PaymentSummary } from '@/services/api';
import type { Payment } from '@/types';

const statusMeta: Record<string, { label: string; variant: 'success' | 'warning' | 'error' | 'info' | 'neutral'; icon: typeof Clock; help?: string }> = {
  // Keys MUST match the backend Payment.Status values.
  success:    { label: 'Completado',  variant: 'success', icon: CheckCircle },
  pending:    { label: 'Pendiente',   variant: 'warning', icon: Clock,
                help: 'Si pagó con tarjeta, el saldo se aplica en minutos. Si eligió pago en caja, el colegio lo aplicará al recibir el efectivo.' },
  processing: { label: 'Procesando',  variant: 'info',    icon: Clock,
                help: 'La pasarela está confirmando el cargo. No vuelva a pagar; consulte en unos minutos.' },
  failed:     { label: 'Fallido',     variant: 'error',   icon: XCircle,
                help: 'El banco rechazó el cargo. Puede intentar de nuevo desde Cafetería.' },
  refunded:   { label: 'Reembolsado', variant: 'neutral', icon: RotateCcw,
                help: 'El colegio devolvió este pago; el saldo de cafetería se ajustó.' },
};

/** Pagos is the cafetería wallet's money view: summary, filterable history, export.
 *  Real top-ups happen in Cafetería (gateway redirect); no other fees are sold in-app. */
export default function PaymentsPage() {
  const [page, setPage] = useUrlPage();
  const { get, set } = useUrlFilters();
  const status = get('estado');
  const student = get('alumno');
  const from = get('desde');
  const to = get('hasta');
  const params = { page, status: status || undefined, student: student || undefined, from: from || undefined, to: to || undefined };

  const summary = useQuery({
    queryKey: ['payments-summary'],
    queryFn: async () => (await paymentsApi.getSummary()).data,
  });
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['payments', params],
    queryFn: async () => toPaged<Payment>((await paymentsApi.getMyPayments(params)).data),
    placeholderData: keepPreviousData,
  });
  const receipt = useMutation({
    mutationFn: async (id: number) => ({ id, blob: (await paymentsApi.getReceipt(id)).data as Blob }),
    onSuccess: ({ id, blob }) => downloadBlob(blob, `comprobante_${id}.pdf`),
    onError: () => toast.error('No se pudo generar el comprobante.'),
  });
  const exportCsv = useMutation({
    mutationFn: async () => (await paymentsApi.exportMyPayments(params)).data as Blob,
    onSuccess: (blob) => downloadBlob(blob, 'pagos.csv'),
    onError: () => toast.error('No se pudo generar el archivo.'),
  });

  const payments = data?.results;
  const count = data?.count ?? 0;
  const children = summary.data?.per_child ?? [];
  const chips = [
    ...(status ? [{ key: 'estado', label: `Estado: ${statusMeta[status]?.label ?? status}`, onClear: () => set({ estado: null, page: null }) }] : []),
    ...(student ? [{ key: 'alumno', label: `Alumno: ${children.find((c) => String(c.student_id) === student)?.name ?? student}`, onClear: () => set({ alumno: null, page: null }) }] : []),
    ...(from || to ? [{ key: 'fecha', label: `Fechas: ${from || '…'} a ${to || '…'}`, onClear: () => set({ desde: null, hasta: null, page: null }) }] : []),
  ];

  return (
    <>
      <PageHeader
        title="Pagos"
        subtitle="Recargas de cafetería pagadas en línea o en caja, y su historial."
        actions={(
          <Button variant="secondary" loading={exportCsv.isPending} onClick={() => exportCsv.mutate()}>
            <FileDown size={16} aria-hidden="true" /> Exportar CSV
          </Button>
        )}
      />

      <SummaryTiles summary={summary.data} loading={summary.isLoading} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <ActionCard
          to="/portal/cafeteria"
          icon={Coffee}
          title="Recargar cafetería"
          desc="Agrega saldo a la cuenta de cafetería de tus hijos."
          gradient="from-green to-green-dark"
        />
      </div>

      <Card title="Historial de pagos">
        <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label" htmlFor="pf-alumno">Alumno</label>
            <select id="pf-alumno" className="input-field min-h-[44px]" value={student} onChange={(e) => set({ alumno: e.target.value || null, page: null })}>
              <option value="">Todos</option>
              {children.map((c) => <option key={c.student_id} value={c.student_id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="pf-estado">Estado</label>
            <select id="pf-estado" className="input-field min-h-[44px]" value={status} onChange={(e) => set({ estado: e.target.value || null, page: null })}>
              <option value="">Todos</option>
              {Object.entries(statusMeta).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="pf-desde">Desde</label>
            <input id="pf-desde" type="date" className="input-field" value={from} onChange={(e) => set({ desde: e.target.value || null, page: null })} />
          </div>
          <div>
            <label className="label" htmlFor="pf-hasta">Hasta</label>
            <input id="pf-hasta" type="date" className="input-field" value={to} onChange={(e) => set({ hasta: e.target.value || null, page: null })} />
          </div>
        </div>
        <ActiveFilterChips chips={chips} onClearAll={() => set({ estado: null, alumno: null, desde: null, hasta: null, page: null })} />

        {isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : isLoading ? (
          <ListSkeleton />
        ) : !payments?.length ? (
          <EmptyState
            icon={CreditCard}
            title={chips.length ? 'Sin pagos con esos filtros' : 'Sin pagos'}
            description="Los pagos realizados aparecerán aquí."
            action={
              <Link to="/portal/cafeteria" className="btn-secondary text-sm">
                <Coffee className="h-4 w-4" /> Recargar cafetería
              </Link>
            }
          />
        ) : (
          <>
            <div className="divide-y divide-cream">
              {payments.map((p) => {
                const meta = statusMeta[p.status] ?? statusMeta.pending;
                const Icon = meta.icon;
                return (
                  <div key={p.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-cream">
                          <Icon className="h-4 w-4 text-muted" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink">
                            {p.student_name ? `Recarga · ${p.student_name}` : 'Recarga cafetería'}
                          </p>
                          <p className="text-xs text-subtle">
                            {format(new Date(p.created_at), "d MMM yyyy, HH:mm", { locale: es })}
                            {p.gateway_label ? ` · ${p.gateway_label}` : ''}
                            {p.gateway_tx_id ? ` · Ref. ${p.gateway_tx_id}` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-shrink-0 items-center justify-between gap-3 pl-12 sm:block sm:pl-0 sm:text-right">
                        <p className="text-sm font-bold text-ink">{formatMXN(p.amount)}</p>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                      </div>
                    </div>
                    {(p.status === 'success' || p.status === 'refunded') && (
                      <div className="mt-2 pl-12">
                        <button type="button" onClick={() => receipt.mutate(p.id)} disabled={receipt.isPending && receipt.variables === p.id}
                          className="inline-flex min-h-[32px] items-center gap-1 text-xs font-semibold text-purple hover:underline disabled:opacity-60">
                          <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Descargar comprobante (PDF)
                        </button>
                      </div>
                    )}
                    {meta.help && (
                      <p className="mt-2 pl-12 text-xs text-muted">
                        {meta.help}
                        {p.status === 'failed' && (
                          <> <Link to="/portal/cafeteria" className="font-semibold text-purple hover:underline">Reintentar</Link></>
                        )}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} count={count} onChange={setPage} itemLabel="pagos" />
          </>
        )}
      </Card>
    </>
  );
}

function SummaryTiles({ summary, loading }: { summary?: PaymentSummary; loading: boolean }) {
  const tiles = [
    { icon: Wallet, label: 'Recargado este mes', value: summary ? formatMXN(summary.month_total) : '—', sub: summary ? `${summary.month_count} pago(s)` : '' },
    { icon: CalendarDays, label: 'Última recarga', value: summary?.last_success ? formatMXN(summary.last_success.amount) : '—',
      sub: summary?.last_success ? format(new Date(summary.last_success.created_at), 'd MMM yyyy', { locale: es }) : 'Sin recargas aún' },
    { icon: Clock, label: 'Pendientes', value: summary ? String(summary.pending_count) : '—', sub: 'por confirmar' },
  ];
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-3" aria-busy={loading}>
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl2 border border-line bg-white p-4 shadow-card">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-subtle">
            <t.icon size={14} aria-hidden="true" /> {t.label}
          </div>
          <div className="mt-1 font-head text-2xl font-extrabold text-ink">{loading ? '…' : t.value}</div>
          {t.sub && <div className="text-xs text-muted">{t.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function ActionCard({ to, icon: Icon, title, desc, gradient }: {
  to: string; icon: typeof Coffee; title: string; desc: string; gradient: string;
}) {
  return (
    <Link
      to={to}
      className="hover-lift group flex items-center gap-4 rounded-xl2 border border-line bg-white p-5 shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
    >
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${gradient} text-white shadow-purple`}>
        <Icon className="h-6 w-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-head text-base font-bold text-ink">{title}</span>
        <span className="mt-0.5 block text-sm text-muted">{desc}</span>
      </span>
      <ArrowRight className="h-5 w-5 shrink-0 text-subtle transition group-hover:translate-x-1 group-hover:text-purple" />
    </Link>
  );
}
