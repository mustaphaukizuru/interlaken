import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AlertTriangle, Ban, CheckCircle2, Clock, Printer, ScanLine, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { apiErrorMessage, apiErrorStatus } from '@/lib/apiErrors';
import { formatMXN } from '@/lib/format';
import { plural } from '@/lib/plural';
import { useAuthStore } from '@/store/authStore';
import {
  cajaApi, newIdempotencyKey,
  type CajaAccount, type CajaOutcome, type CajaTopUp, type DeskMethod,
} from '@/services/caja';

/** The portal's own maximum ($1,000, `CAFETERIA_TOPUP_MAX`): the server refuses more. */
const MAX = 1000;
const QUICK = [100, 200, 500];
const METHODS: { value: DeskMethod; label: string; reference?: string }[] = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'card', label: 'Tarjeta en recepción', reference: 'Número de autorización de la terminal' },
  { value: 'link', label: 'Liga de pago', reference: 'Folio de la liga de pago' },
];
const TODAY_KEY = ['caja', 'today'];
const time = (iso: string) => new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

function accountLine(a: Pick<CajaAccount, 'tipo' | 'grade' | 'group' | 'puesto_label' | 'code'>): string {
  const where = a.tipo === 'personal' ? (a.puesto_label || 'Personal') : `${a.grade}${a.group ? ` ${a.group}` : ''}`;
  return [where, a.code].filter(Boolean).join(' · ');
}

/**
 * /admin/caja: money received at the front desk (owner 2026-11-27). Scan the
 * credential or type the matrícula, confirm the child, record amount and
 * method. The server writes Loyverse FIRST and credits the wallet only when
 * Loyverse shows the new balance, so the desk never touches the POS.
 */
export default function AdminCaja() {
  const queryClient = useQueryClient();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const scanRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [matches, setMatches] = useState<CajaAccount[] | null>(null);
  const [account, setAccount] = useState<CajaAccount | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<DeskMethod>('cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [key, setKey] = useState(newIdempotencyKey);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [done, setDone] = useState<{ topup: CajaTopUp; outcome: CajaOutcome } | null>(null);

  const reset = () => {
    setCode(''); setMatches(null); setAccount(null); setAmount(''); setMethod('cash');
    setReference(''); setNote(''); setKey(newIdempotencyKey()); setDone(null);
    setTimeout(() => scanRef.current?.focus(), 0);
  };

  // The desk scans the credential with a USB scanner, which types into the
  // focused field: put the cursor there as the page opens.
  useEffect(() => { scanRef.current?.focus(); }, []);

  const lookup = useMutation({
    mutationFn: async (c: string) => (await cajaApi.lookup(c)).data.results,
    onSuccess: (rows) => {
      setMatches(rows);
      setAccount(rows.length === 1 ? rows[0] : null);
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo buscar la cuenta.')),
  });

  const today = useQuery({
    queryKey: TODAY_KEY,
    queryFn: async () => (await cajaApi.today()).data.results,
  });

  const create = useMutation({
    mutationFn: async (confirmDuplicate: boolean) => (await cajaApi.create({
      student: account!.id, amount, desk_method: method, reference: reference.trim(),
      note: note.trim(), idempotency_key: key, confirm_duplicate: confirmDuplicate,
    })).data,
    onSuccess: (data) => {
      setDuplicate(null);
      setDone({ topup: data.topup, outcome: data.outcome });
      void queryClient.invalidateQueries({ queryKey: TODAY_KEY });
    },
    onError: (e) => {
      const body = (e as { response?: { data?: { code?: string; detail?: string } } }).response?.data;
      if (apiErrorStatus(e) === 409 && body?.code === 'possible_duplicate') {
        setDuplicate(body.detail ?? 'Hace unos minutos se registró una recarga igual.');
        return;
      }
      toast.error(apiErrorMessage(e, 'No se pudo registrar la recarga.'));
    },
  });

  const amountNum = Number(amount);
  const methodDef = METHODS.find((m) => m.value === method)!;
  const amountError = amount === '' ? '' : (!Number.isFinite(amountNum) || amountNum <= 0)
    ? 'Escriba un monto válido.' : amountNum > MAX ? `El máximo es ${formatMXN(MAX)} por recarga.` : '';
  const canSubmit = !!account?.linked && amount !== '' && !amountError
    && (!methodDef.reference || reference.trim() !== '') && !create.isPending;

  const onScan = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim();
    if (c.length < 2) return;
    setDone(null);
    lookup.mutate(c);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (canSubmit) create.mutate(false);
  };

  return (
    <>
      <PageHeader
        title="Caja"
        subtitle="Registre aquí el dinero que recibe en recepción. La app lo carga primero en Loyverse y luego en el saldo: no lo cargue también en el POS."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title="Registrar recarga">
          {done ? (
            <Outcome done={done} onNew={reset} />
          ) : (
            <div className="space-y-5">
              <form onSubmit={onScan} className="flex flex-col gap-2 sm:flex-row sm:items-end" role="search">
                <label className="flex-1 text-sm font-medium text-ink">
                  Credencial o matrícula
                  <input
                    ref={scanRef}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Escanee la credencial o escriba la matrícula"
                    className="input-field mt-1 w-full"
                    autoComplete="off"
                    inputMode="text"
                  />
                </label>
                <Button type="submit" variant="secondary" loading={lookup.isPending} className="min-h-[44px]">
                  <ScanLine size={16} aria-hidden="true" /> Buscar
                </Button>
              </form>

              {matches && matches.length === 0 && (
                <p className="rounded-md bg-cream-2 p-3 text-sm text-muted" role="status">
                  No encontramos ninguna cuenta activa con ese código. Revise la matrícula o escanee de nuevo.
                </p>
              )}
              {matches && matches.length > 1 && !account && (
                <div role="group" aria-label="Elija la cuenta">
                  <p className="mb-2 text-sm text-muted">{plural(matches.length, 'cuenta coincide', 'cuentas coinciden')}: elija la correcta.</p>
                  <ul className="space-y-2">
                    {matches.map((m) => (
                      <li key={m.id}>
                        <button type="button" onClick={() => setAccount(m)} className="flex min-h-[44px] w-full items-center justify-between rounded-md border border-line px-3 py-2 text-left hover:bg-cream">
                          <span className="font-medium text-ink">{m.name}</span>
                          <span className="text-xs text-muted">{accountLine(m)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {account && (
                <form onSubmit={onSubmit} className="space-y-5" aria-label={`Recarga para ${account.name}`}>
                  <div className="flex items-center gap-3 rounded-md bg-cream-2 p-3">
                    {account.photo
                      ? <img src={account.photo} alt="" className="h-14 w-14 rounded-full object-cover" />
                      : <div className="flex h-14 w-14 items-center justify-center rounded-full bg-purple-light font-head text-lg font-bold text-purple" aria-hidden="true">{account.name.slice(0, 1)}</div>}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-head text-base font-bold text-ink">{account.name}</p>
                      <p className="text-xs text-muted">{accountLine(account)}</p>
                      <p className="text-sm text-ink">Saldo actual: <span className="font-semibold">{account.balance === null ? '—' : formatMXN(account.balance)}</span></p>
                    </div>
                    <button type="button" className="text-sm font-semibold text-purple hover:underline" onClick={reset}>Cambiar</button>
                  </div>
                  {!account.linked && (
                    <p className="flex items-start gap-2 rounded-md bg-danger-bg p-3 text-sm text-danger" role="alert">
                      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                      Esta cuenta aún no está vinculada a Loyverse: vincúlela en Cafetería antes de recargar.
                    </p>
                  )}

                  <fieldset>
                    <legend className="text-sm font-medium text-ink">Monto</legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {QUICK.map((q) => (
                        <button key={q} type="button" onClick={() => setAmount(String(q))} aria-pressed={amountNum === q}
                          className={`min-h-[44px] rounded-md px-4 text-sm font-semibold ${amountNum === q ? 'bg-purple text-white' : 'bg-purple-light text-purple hover:bg-purple/15'}`}>
                          {formatMXN(q)}
                        </button>
                      ))}
                      <label className="flex items-center gap-2 text-sm text-muted">
                        Otro monto
                        <input type="number" min="1" max={MAX} step="0.01" inputMode="decimal" value={amount}
                          onChange={(e) => setAmount(e.target.value)} className="input-field w-32" aria-label="Monto de la recarga" />
                      </label>
                    </div>
                    <p className={`mt-1 text-xs ${amountError ? 'text-danger' : 'text-subtle'}`} role={amountError ? 'alert' : undefined}>
                      {amountError || `Máximo ${formatMXN(MAX)} por recarga.`}
                    </p>
                  </fieldset>

                  <fieldset>
                    <legend className="text-sm font-medium text-ink">Forma de pago</legend>
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      {METHODS.map((m) => (
                        <label key={m.value} className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border px-3 text-sm ${method === m.value ? 'border-purple bg-purple-light text-ink' : 'border-line text-muted'}`}>
                          <input type="radio" name="desk-method" value={m.value} checked={method === m.value} onChange={() => setMethod(m.value)} />
                          {m.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {methodDef.reference && (
                    <label className="block text-sm font-medium text-ink">
                      {methodDef.reference}
                      <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} className="input-field mt-1 w-full" required />
                    </label>
                  )}
                  <label className="block text-sm font-medium text-ink">
                    Nota (opcional)
                    <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="input-field mt-1 w-full" />
                  </label>

                  <Button type="submit" disabled={!canSubmit} loading={create.isPending} className="min-h-[48px] w-full">
                    {amount && !amountError ? `Registrar recarga de ${formatMXN(amountNum)}` : 'Registrar recarga'}
                  </Button>
                </form>
              )}
            </div>
          )}
        </Card>

        <TodayList rows={today.data} loading={today.isLoading} isAdmin={isAdmin} />
      </div>

      <ConfirmDialog
        open={duplicate !== null}
        title="¿Es otra recarga?"
        message={duplicate ?? ''}
        confirmLabel="Sí, registrar otra"
        cancelLabel="No, revisar"
        loading={create.isPending}
        onConfirm={() => create.mutate(true)}
        onClose={() => setDuplicate(null)}
      />
    </>
  );
}

function Outcome({ done, onNew }: { done: { topup: CajaTopUp; outcome: CajaOutcome }; onNew: () => void }) {
  const { topup, outcome } = done;
  const amount = formatMXN(topup.amount);
  const view = {
    pushed: { Icon: CheckCircle2, tone: 'bg-success-bg text-success', title: `Cargada en Loyverse: ${topup.student.name} ya puede gastar ${amount}.` },
    applied: { Icon: CheckCircle2, tone: 'bg-success-bg text-success', title: `Registrada: ${amount} para ${topup.student.name}.` },
    waiting: { Icon: Clock, tone: 'bg-warning-bg text-warning', title: 'Pendiente de cargar en Loyverse: la app lo reintenta en unos minutos. No la cargue en el POS.' },
    failed: { Icon: AlertTriangle, tone: 'bg-danger-bg text-danger', title: 'La app no pudo cargarla en Loyverse. El equipo de cafetería recibió un aviso; no la cargue en el POS sin revisar Loyverse.' },
    skipped: { Icon: Clock, tone: 'bg-warning-bg text-warning', title: 'Registrada. La carga automática en Loyverse está apagada: aplíquela en Cafetería → Depósitos.' },
    voided: { Icon: Ban, tone: 'bg-cream-2 text-muted', title: 'Anulada.' },
  }[outcome.state];
  return (
    <div className="space-y-4" role="status" aria-live="polite">
      <div className={`flex items-start gap-3 rounded-md p-4 ${view.tone}`}>
        <view.Icon size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">{view.title}</p>
          <p className="mt-1 text-sm">
            Folio {topup.folio} · {topup.desk_method_label}
            {outcome.balance !== null && outcome.state === 'pushed' ? ` · Saldo actual: ${formatMXN(outcome.balance)}` : ''}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link to={`/admin/caja/recibo/${topup.id}`} className="btn-outline min-h-[44px]">
          <Printer size={16} aria-hidden="true" /> Imprimir recibo
        </Link>
        <Button onClick={onNew} className="min-h-[44px]">Nueva recarga</Button>
      </div>
    </div>
  );
}

const STATE_BADGE: Record<string, { label: string; variant: 'success' | 'warning' | 'error' | 'neutral' | 'info' }> = {
  pushed: { label: 'Cargada', variant: 'success' },
  applied: { label: 'Aplicada', variant: 'success' },
  waiting: { label: 'Pendiente', variant: 'warning' },
  failed: { label: 'No se cargó', variant: 'error' },
  skipped: { label: 'Por aplicar', variant: 'warning' },
  voided: { label: 'Anulada', variant: 'neutral' },
};

function TodayList({ rows, loading, isAdmin }: { rows?: CajaTopUp[]; loading: boolean; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [voiding, setVoiding] = useState<CajaTopUp | null>(null);
  const [reason, setReason] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: TODAY_KEY });
  const voidM = useMutation({
    mutationFn: async () => (await cajaApi.void(voiding!.id, reason.trim())).data,
    onSuccess: () => { toast.success(`Recarga ${voiding?.folio} anulada.`); setVoiding(null); setReason(''); void refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo anular la recarga.')),
  });
  const verifyM = useMutation({
    mutationFn: async (id: number) => (await cajaApi.verify(id)).data,
    onSuccess: () => { toast.success('Marcada como verificada en MultiCobros.'); void refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo marcar como verificada.')),
  });

  // What the desk received today and still counts (the base of the corte de caja).
  const totals = useMemo(() => {
    const t: Record<DeskMethod, number> = { cash: 0, card: 0, link: 0 };
    for (const r of rows ?? []) if (r.state !== 'voided') t[r.desk_method] += Number(r.amount);
    return t;
  }, [rows]);

  return (
    <Card title={isAdmin ? 'Recargas de hoy en recepción' : 'Mis recargas de hoy'}>
      <p className="mb-3 text-sm text-muted" aria-live="polite">
        Efectivo {formatMXN(totals.cash)} · Tarjeta {formatMXN(totals.card)} · Liga de pago {formatMXN(totals.link)}
      </p>
      {loading ? <p className="text-sm text-muted">Cargando…</p> : !rows?.length ? (
        <p className="text-sm text-muted">Aún no hay recargas registradas hoy.</p>
      ) : (
        <ul className="divide-y divide-line" aria-label="Recargas de hoy">
          {rows.map((r) => {
            const badge = STATE_BADGE[r.state] ?? STATE_BADGE.skipped;
            return (
              <li key={r.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{r.student.name} · {formatMXN(r.amount)}</p>
                  <p className="text-xs text-muted">
                    {time(r.created_at)} · {r.folio} · {r.desk_method_label}{r.reference ? ` (${r.reference})` : ''}{isAdmin && r.received_by ? ` · Recibió ${r.received_by}` : ''}
                  </p>
                  {r.state === 'voided' && r.void_reason && <p className="text-xs text-muted">Motivo: {r.void_reason}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  {r.needs_verification && <Badge variant="warning">Por verificar</Badge>}
                  <Link to={`/admin/caja/recibo/${r.id}`} className="text-sm font-semibold text-purple hover:underline" aria-label={`Recibo ${r.folio}`}>Recibo</Link>
                  {r.needs_verification && (
                    <Button size="sm" variant="secondary" loading={verifyM.isPending && verifyM.variables === r.id} onClick={() => verifyM.mutate(r.id)} aria-label={`Verificar en MultiCobros la recarga ${r.folio}`}>
                      <ShieldCheck size={14} aria-hidden="true" /> Verificar
                    </Button>
                  )}
                  {r.state !== 'voided' && r.state !== 'failed' && (
                    <Button size="sm" variant="ghost" onClick={() => { setVoiding(r); setReason(''); }} aria-label={`Anular la recarga ${r.folio}`}>Anular</Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={!!voiding}
        title="Anular recarga"
        message={voiding ? `Se quitarán ${formatMXN(voiding.amount)} del saldo de ${voiding.student.name} en Loyverse y en la app (folio ${voiding.folio}). La familia recibirá un aviso.` : ''}
        confirmLabel="Anular recarga"
        cancelLabel="Volver"
        confirmDisabled={reason.trim() === ''}
        loading={voidM.isPending}
        onConfirm={() => voidM.mutate()}
        onClose={() => setVoiding(null)}
      >
        <label className="mt-3 block text-sm font-medium text-ink">
          Motivo (obligatorio)
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} className="input-field mt-1 w-full" />
        </label>
      </ConfirmDialog>
    </Card>
  );
}
