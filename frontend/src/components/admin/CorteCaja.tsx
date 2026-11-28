import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AlertTriangle, Lock, Printer, RotateCcw } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { apiErrorMessage } from '@/lib/apiErrors';
import { formatMXN } from '@/lib/format';
import { plural } from '@/lib/plural';
import { schoolToday } from '@/lib/schoolDay';
import { corteApi, type CorteSummary, type DeskMethod } from '@/services/caja';

const METHODS: { key: DeskMethod; label: string; countedLabel: string }[] = [
  { key: 'cash', label: 'Efectivo', countedLabel: 'Efectivo contado' },
  { key: 'card', label: 'Tarjeta', countedLabel: 'Tarjeta según la terminal (opcional)' },
  { key: 'link', label: 'Liga de pago', countedLabel: 'Ligas según el reporte (opcional)' },
];


const longDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/**
 * «Corte de caja» (owner 2026-11-27, Caja Part 2): what one person received at
 * the front desk on one day, by method, against what they counted. Closing
 * locks the day (no voids, no new top-ups) until an administrator reopens it.
 * Each person sees their own; administrators pick anyone.
 */
export function CorteCaja({ isAdmin, meId }: { isAdmin: boolean; meId?: number }) {
  const queryClient = useQueryClient();
  const today = schoolToday();
  const [day, setDay] = useState(today);
  const [userId, setUserId] = useState<number | undefined>(undefined);
  const [counted, setCounted] = useState<Record<DeskMethod, string>>({ cash: '', card: '', link: '' });
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState('');

  const key = ['caja', 'corte', day, userId ?? meId ?? 'me'];
  const summary = useQuery({ queryKey: key, queryFn: async () => (await corteApi.get({ day, user: userId })).data });
  const people = useQuery({
    queryKey: ['caja', 'cortes', day],
    queryFn: async () => (await corteApi.people(day)).data,
    enabled: isAdmin,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['caja'] });
  const close = useMutation({
    mutationFn: async () => (await corteApi.close({
      day, user: userId, counted_cash: counted.cash,
      counted_card: counted.card || undefined, counted_link: counted.link || undefined, note,
    })).data,
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      setConfirming(false);
      toast.success('Corte cerrado.');
      void refresh();
    },
    onError: (e) => { setConfirming(false); toast.error(apiErrorMessage(e, 'No se pudo cerrar el corte.')); },
  });
  const reopen = useMutation({
    mutationFn: async (id: number) => (await corteApi.reopen(id, reason.trim())).data,
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      setReopening(false); setReason('');
      toast.success('Corte reabierto.');
      void refresh();
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo reabrir el corte.')),
  });

  const s = summary.data;
  const closed = !!s?.close?.closed;
  const cashDiff = useMemo(() => {
    if (!s || counted.cash === '' || !Number.isFinite(Number(counted.cash))) return null;
    return Number(counted.cash) - Number(s.expected.cash);
  }, [s, counted.cash]);

  return (
    <div className="space-y-6">
      <Card title="Corte de caja" subtitle="Lo que recibió en recepción en el día, por forma de pago, contra lo que contó.">
        <div className="flex flex-wrap items-end gap-4" data-print="hide">
          <label className="text-sm font-medium text-ink">
            Día
            <input type="date" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} className="input-field mt-1 block" />
          </label>
          {isAdmin && (
            <div className="text-sm font-medium text-ink">
              <label htmlFor="corte-persona">Persona</label>
              <select
                id="corte-persona"
                value={userId ?? ''}
                onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : undefined)}
                className="input-field mt-1 block min-w-[220px]"
              >
                <option value="">Yo</option>
                {(people.data?.people ?? []).filter((p) => p.user.id !== meId).map((p) => (
                  <option key={p.user.id} value={p.user.id}>
                    {p.user.name} · {formatMXN(p.expected_total)}{p.closed ? ' · cerrado' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </Card>

      {summary.isLoading ? <LoadingSpinner /> : summary.isError || !s ? <ErrorState onRetry={() => summary.refetch()} /> : (
        <CorteBody
          s={s}
          closed={closed}
          isAdmin={isAdmin}
          counted={counted}
          setCounted={setCounted}
          note={note}
          setNote={setNote}
          cashDiff={cashDiff}
          onClose={() => setConfirming(true)}
          onReopen={() => { setReason(''); setReopening(true); }}
        />
      )}

      <ConfirmDialog
        open={confirming}
        title="Cerrar corte"
        message={s ? `Se cerrará el corte de ${s.user.name} del ${longDay(s.day)}: esperado ${formatMXN(s.expected_total)}, efectivo contado ${formatMXN(counted.cash || '0')}. Después ya no podrá anular recargas de ese día ni registrar más en él, salvo que un administrador lo reabra.` : ''}
        confirmLabel="Cerrar corte"
        cancelLabel="Volver"
        loading={close.isPending}
        onConfirm={() => close.mutate()}
        onClose={() => setConfirming(false)}
      />
      <ConfirmDialog
        open={reopening}
        title="Reabrir corte"
        message="El corte vuelve a abrirse para corregir recargas. Lo contado queda en la bitácora."
        confirmLabel="Reabrir corte"
        cancelLabel="Volver"
        confirmDisabled={reason.trim() === ''}
        loading={reopen.isPending}
        onConfirm={() => s?.close && reopen.mutate(s.close.id)}
        onClose={() => setReopening(false)}
      >
        <label className="mt-3 block text-sm font-medium text-ink">
          Motivo (obligatorio)
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} className="input-field mt-1 w-full" />
        </label>
      </ConfirmDialog>
    </div>
  );
}

function CorteBody({
  s, closed, isAdmin, counted, setCounted, note, setNote, cashDiff, onClose, onReopen,
}: {
  s: CorteSummary;
  closed: boolean;
  isAdmin: boolean;
  counted: Record<DeskMethod, string>;
  setCounted: (c: Record<DeskMethod, string>) => void;
  note: string;
  setNote: (n: string) => void;
  cashDiff: number | null;
  onClose: () => void;
  onReopen: () => void;
}) {
  const c = s.close;
  return (
    <article className="space-y-6" aria-label={`Corte de caja de ${s.user.name}`}>
      <Card
        title={`${s.user.name} · ${longDay(s.day)}`}
        subtitle={`${plural(s.count, 'recarga', 'recargas')} · esperado ${formatMXN(s.expected_total)}`}
        action={closed ? <Badge variant="success"><Lock size={12} aria-hidden="true" /> Cerrado</Badge> : <Badge variant="warning">Abierto</Badge>}
      >
        <dl className="grid gap-3 sm:grid-cols-3">
          {METHODS.map((m) => (
            <div key={m.key} className="rounded-md bg-cream-2 p-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{m.label}</dt>
              <dd className="mt-1 font-head text-xl font-bold text-ink">{formatMXN((closed && c ? c.expected[m.key] : s.expected[m.key]) ?? '0')}</dd>
            </div>
          ))}
        </dl>
        {s.pending_load.count > 0 && (
          <p className="mt-3 flex items-start gap-2 rounded-md bg-warning-bg p-3 text-sm text-ink" role="status">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber" aria-hidden="true" />
            {plural(s.pending_load.count, 'recarga', 'recargas')} por {formatMXN(s.pending_load.amount)} aún no se {s.pending_load.count === 1 ? 'carga' : 'cargan'} en Loyverse. El dinero ya está en su caja y cuenta en el corte; la app las reintenta sola.
          </p>
        )}
        {s.duplicates.length > 0 && (
          <div className="mt-3 rounded-md bg-warning-bg p-3 text-sm text-ink" role="status">
            <p className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} className="text-amber" aria-hidden="true" /> Posibles duplicados: revíselos antes de cerrar.</p>
            <ul className="mt-1 list-disc pl-6">
              {s.duplicates.map((d) => <li key={`${d.first}-${d.second}`}>{d.student}: {formatMXN(d.amount)} en {d.first} y {d.second}</li>)}
            </ul>
          </div>
        )}
      </Card>

      {closed && c ? (
        <Card
          title="Corte cerrado"
          subtitle={`Cerró ${c.closed_by}${c.closed_at ? ` el ${new Date(c.closed_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}`}
          action={(
            <div className="flex flex-wrap gap-2" data-print="hide">
              <Button variant="secondary" onClick={() => window.print()} className="min-h-[44px]"><Printer size={16} aria-hidden="true" /> Imprimir corte</Button>
              {isAdmin && <Button variant="ghost" onClick={onReopen} className="min-h-[44px]"><RotateCcw size={16} aria-hidden="true" /> Reabrir</Button>}
            </div>
          )}
        >
          <table className="w-full text-sm">
            <caption className="sr-only">Esperado, contado y diferencia por forma de pago</caption>
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th scope="col" className="py-2">Forma de pago</th>
                <th scope="col" className="py-2 text-right">Esperado</th>
                <th scope="col" className="py-2 text-right">Contado</th>
                <th scope="col" className="py-2 text-right">Diferencia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {METHODS.map((m) => {
                const diff = c.difference[m.key];
                const off = diff !== null && Number(diff) !== 0;
                return (
                  <tr key={m.key}>
                    <th scope="row" className="py-2 text-left font-medium text-ink">{m.label}</th>
                    <td className="py-2 text-right">{formatMXN(c.expected[m.key] ?? '0')}</td>
                    <td className="py-2 text-right">{c.counted[m.key] === null ? 'Sin contar' : formatMXN(c.counted[m.key]!)}</td>
                    <td className={`py-2 text-right font-semibold ${off ? 'text-danger' : 'text-ink'}`}>{diff === null ? '' : formatMXN(diff)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {c.note && <p className="mt-3 text-sm text-muted">Nota: {c.note}</p>}
        </Card>
      ) : (
        <Card title="Cerrar el corte" subtitle="Cuente el efectivo de su caja. La tarjeta y las ligas son opcionales: anótelas si tiene el reporte de la terminal o de las ligas." data-print="hide">
          {c?.reopened_at && (
            <p className="mb-3 text-sm text-muted">Reabierto por {c.reopened_by}: {c.reopen_reason}</p>
          )}
          <form
            className="grid gap-4 sm:grid-cols-3"
            onSubmit={(e) => { e.preventDefault(); if (counted.cash !== '') onClose(); }}
          >
            {METHODS.map((m) => (
              <label key={m.key} className="text-sm font-medium text-ink">
                {m.countedLabel}
                <input
                  inputMode="decimal"
                  value={counted[m.key]}
                  onChange={(e) => setCounted({ ...counted, [m.key]: e.target.value.replace(/[^\d.]/g, '') })}
                  className="input-field mt-1 w-full"
                  required={m.key === 'cash'}
                  aria-describedby={m.key === 'cash' ? 'corte-cash-diff' : undefined}
                />
              </label>
            ))}
            <p id="corte-cash-diff" className="text-sm sm:col-span-3" aria-live="polite">
              {cashDiff === null ? `Efectivo esperado: ${formatMXN(s.expected.cash)}.` : cashDiff === 0
                ? 'El efectivo cuadra.'
                : `Diferencia en efectivo: ${formatMXN(cashDiff)} (${cashDiff > 0 ? 'sobra' : 'falta'}).`}
            </p>
            <label className="text-sm font-medium text-ink sm:col-span-3">
              Nota (opcional)
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="input-field mt-1 w-full" />
            </label>
            <div className="sm:col-span-3">
              <Button type="submit" disabled={counted.cash === ''} className="min-h-[48px] w-full sm:w-auto">
                <Lock size={16} aria-hidden="true" /> Cerrar corte
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card title="Recargas del día" subtitle={s.voids.length ? plural(s.voids.length, 'anulada aparte', 'anuladas aparte') : undefined}>
        {!s.topups.length && !s.voids.length ? <p className="text-sm text-muted">No hay recargas registradas ese día.</p> : (
          <ul className="divide-y divide-line" aria-label="Recargas del corte">
            {s.topups.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm text-ink">{r.time} · {r.folio} · {r.student}</span>
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted">{r.desk_method_label}{r.reference ? ` (${r.reference})` : ''}</span>
                  <span className="font-semibold text-ink">{formatMXN(r.amount)}</span>
                  {!r.loaded && <Badge variant="warning">Pendiente de cargar</Badge>}
                  {r.needs_verification && <Badge variant="info">Por verificar</Badge>}
                </span>
              </li>
            ))}
            {s.voids.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm text-muted line-through">{r.time} · {r.folio} · {r.student} · {formatMXN(r.amount)}</span>
                <span className="text-xs text-muted">Anulada{r.voided_by ? ` por ${r.voided_by}` : ''}: {r.void_reason}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </article>
  );
}
