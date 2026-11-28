import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { ExportMenu } from '@/components/admin/ExportMenu';
import type { ExportFormat } from '@/services/dataOps';
import { formatMXN } from '@/lib/format';
import { plural } from '@/lib/plural';
import { schoolToday } from '@/lib/schoolDay';
import { ingresosApi, type IngresosParams } from '@/services/ingresos';

/** «Jue 26 nov»: short, one line, only the first letter capitalized. */
const dayLabel = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  const part = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('es-MX', o).replace('.', '');
  const text = `${part({ weekday: 'short' })} ${d.getDate()} ${part({ month: 'short' })}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/**
 * /admin/ingresos: «Ingresos de cafetería» (owner 2026-11-27, Caja Part 2).
 * Money that came into the wallets, by day and channel: portal card
 * payments, the front desk (cash, card, payment link) and the cafetería POS.
 * Each top-up is counted once (backend `apps/cafeteria/ingresos.py`).
 */
export default function AdminIngresos() {
  const today = schoolToday();
  const [mode, setMode] = useState<'month' | 'range'>('month');
  const [month, setMonth] = useState(today.slice(0, 7));
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const params: IngresosParams = mode === 'month' ? { month } : { from, to };

  const report = useQuery({
    queryKey: ['cafeteria', 'ingresos', params],
    queryFn: async () => (await ingresosApi.report(params)).data,
  });
  const fetchExport = async (fmt: ExportFormat) => (await ingresosApi.export({ ...params, fmt })).data;
  const r = report.data;
  // Days with money first stand out; empty days stay so a month reads complete.
  const rows = r?.rows ?? [];

  return (
    <>
      <PageHeader
        title="Ingresos de cafetería"
        subtitle="Dinero que entró a los saldos, por día y por canal: portal, recepción y caja de cafetería. Cada recarga se cuenta una sola vez."
        actions={<ExportMenu filenamePrefix="ingresos_cafeteria" fetch={(fmt) => fetchExport(fmt)} formats={['xlsx', 'pdf', 'csv']} />}
      />
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <div role="tablist" aria-label="Periodo" className="inline-flex gap-1 rounded-md bg-cream-2 p-1">
            {([['month', 'Mes'], ['range', 'Rango de fechas']] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => setMode(value)}
                className={`min-h-[44px] rounded-sm px-4 text-sm font-semibold ${mode === value ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === 'month' ? (
            <label className="text-sm font-medium text-ink">
              Mes
              <input type="month" value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className="input-field mt-1 block" />
            </label>
          ) : (
            <>
              <label className="text-sm font-medium text-ink">
                Desde
                <input type="date" value={from} max={today} onChange={(e) => e.target.value && setFrom(e.target.value)} className="input-field mt-1 block" />
              </label>
              <label className="text-sm font-medium text-ink">
                Hasta
                <input type="date" value={to} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} className="input-field mt-1 block" />
              </label>
            </>
          )}
        </div>

        {report.isLoading ? <LoadingSpinner /> : report.isError || !r ? <ErrorState onRetry={() => report.refetch()} /> : (
          <>
            <dl className="mt-6 grid gap-3 sm:grid-cols-3 xl:grid-cols-6" aria-label="Totales del periodo">
              {r.channels.map((c) => (
                <div key={c.key} className="rounded-md bg-cream-2 p-3">
                  <dt className="text-xs font-semibold text-muted">{c.label}</dt>
                  <dd className="mt-1 font-head text-lg font-bold text-ink">{formatMXN(r.totals[c.key])}</dd>
                </div>
              ))}
              <div className="rounded-md bg-purple-light p-3">
                <dt className="text-xs font-semibold text-purple">Total</dt>
                <dd className="mt-1 font-head text-lg font-bold text-ink">{formatMXN(r.totals.total)}</dd>
                <dd className="text-xs text-muted">{plural(r.totals.count, 'recarga', 'recargas')}</dd>
              </div>
            </dl>
            {(Number(r.totals.pending_load) > 0 || Number(r.totals.to_verify) > 0) && (
              <p className="mt-3 text-sm text-muted" role="note">
                {Number(r.totals.pending_load) > 0 && <>De recepción, {formatMXN(r.totals.pending_load)} aún no se carga en Loyverse (la app lo reintenta). </>}
                {Number(r.totals.to_verify) > 0 && <>{formatMXN(r.totals.to_verify)} con tarjeta o liga de pago está por verificar en MultiCobros. </>}
                Ambos ya cuentan en el total.
              </p>
            )}
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <caption className="sr-only">Ingresos por día y canal</caption>
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th scope="col" className="py-2 pr-3">Día</th>
                    {r.channels.map((c) => <th key={c.key} scope="col" className="py-2 pr-3 text-right">{c.label}</th>)}
                    <th scope="col" className="py-2 pr-3 text-right">Total</th>
                    <th scope="col" className="py-2 text-right">Recargas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((row) => (
                    <tr key={row.day} className={row.count ? 'text-ink' : 'text-subtle'}>
                      <th scope="row" className="whitespace-nowrap py-2 pr-3 text-left font-medium">{dayLabel(row.day)}</th>
                      {r.channels.map((c) => <td key={c.key} className="py-2 pr-3 text-right tabular-nums">{Number(row[c.key]) ? formatMXN(row[c.key]) : '·'}</td>)}
                      <td className="py-2 pr-3 text-right font-semibold tabular-nums">{Number(row.total) ? formatMXN(row.total) : '·'}</td>
                      <td className="py-2 text-right tabular-nums">{row.count || '·'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line font-semibold text-ink">
                    <th scope="row" className="py-2 pr-3 text-left">Total</th>
                    {r.channels.map((c) => <td key={c.key} className="py-2 pr-3 text-right tabular-nums">{formatMXN(r.totals[c.key])}</td>)}
                    <td className="py-2 pr-3 text-right tabular-nums">{formatMXN(r.totals.total)}</td>
                    <td className="py-2 text-right tabular-nums">{r.totals.count}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
