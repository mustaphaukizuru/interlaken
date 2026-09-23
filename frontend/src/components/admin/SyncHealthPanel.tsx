import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { AlertTriangle, CheckCircle2, HelpCircle, Link2Off, PlugZap, Scale, Timer, Users, Zap, DatabaseBackup } from 'lucide-react';
import { cafeteriaApi, type SyncHealth } from '@/services/api';

type Tone = 'ok' | 'warn' | 'bad';

const TONE: Record<Tone, string> = {
  ok: 'border-green/30 bg-green/5 text-green-dark',
  warn: 'border-amber/30 bg-amber/5 text-amber',
  bad: 'border-coral/30 bg-coral/5 text-coral-dark',
};

/** How long the poll may go without RUNNING before it means "the cron stopped".
 *  Measured on last_poll_at, not the receipt cursor: the cursor legitimately
 *  stands still over a weekend or a holiday and would show red for no reason. */
const STALE_HOURS = 1;
/** A school day without a single Loyverse delivery means the hook is dead. */
const WEBHOOK_STALE_HOURS = 30;
/** Nightly at 02:30; anything older than a day and a bit is a missed night. */
const BACKUP_STALE_HOURS = 30;

function ago(iso: string | null): string {
  if (!iso) return 'nunca';
  return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: es });
}

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 36e5;
}

interface Check {
  key: string;
  icon: typeof PlugZap;
  tone: Tone;
  label: string;
  detail: string;
}

/**
 * Turn the raw health payload into the four questions an admin is actually
 * asking, in the order that makes them diagnostic: a dead token makes every
 * later signal meaningless, an unlinked roster explains "unmatched", a stale
 * cursor means nothing is polling, and a fresh cursor with a stale ledger is
 * the signature of receipts arriving that nobody recognises as wallet spend.
 */
export function buildChecks(h: SyncHealth): Check[] {
  // Older builds have no last_poll_at yet; fall back to the cursor so the light
  // never reads "never" against a server that simply has not deployed it.
  const pollAt = h.last_poll_at ?? h.last_purchases_cursor;
  const cursorHours = hoursSince(pollAt);
  const pollStale = cursorHours === null || cursorHours > STALE_HOURS;
  const unlinked = h.active_students - h.linked_students;
  const hookHours = hoursSince(h.last_webhook_at);
  const hookStale = hookHours === null || hookHours > WEBHOOK_STALE_HOURS;
  const backupHours = hoursSince(h.backup?.ok ? h.backup.at : null);
  const backupStale = backupHours === null || backupHours > BACKUP_STALE_HOURS;
  const audit = h.wallet_audit;
  const drifting = audit?.drifting ?? 0;
  const driftTotal = Math.abs(parseFloat(audit?.drift_total ?? '0'));
  const stale = h.stale_links ?? 0;
  const newKids = audit?.unlinked_students ?? 0;
  const parked = h.unmatched_receipts ?? 0;
  // Stale links and unlinked pupils need a person; parked receipts on their
  // own are usually staff or test cards and only get mentioned.
  const rosterIssues: string[] = [];
  if (stale > 0) rosterIssues.push(`${stale} enlace(s) obsoleto(s)`);
  if (newKids > 0) rosterIssues.push(`${newKids} alumno(s) nuevo(s) en Loyverse sin vincular`);
  const rosterLabel = rosterIssues.length > 0 && parked > 0
    ? [...rosterIssues, `${parked} recibo(s) sin alumno`] : rosterIssues;

  return [
    {
      key: 'api',
      icon: PlugZap,
      tone: h.loyverse_ok ? 'ok' : 'bad',
      label: h.loyverse_ok ? 'Loyverse responde' : 'Loyverse no responde',
      detail: h.loyverse_ok
        ? 'El token es válido y la API está disponible.'
        : `${h.loyverse_error || 'Sin detalle.'} Nada puede sincronizarse hasta resolverlo.`,
    },
    {
      key: 'poll',
      icon: Timer,
      tone: pollStale ? 'bad' : 'ok',
      label: pollStale ? 'El sondeo no está corriendo' : 'Sondeo al día',
      detail: pollStale
        ? `Última corrida del sondeo: ${ago(pollAt)}. Si no corre cada 5 minutos, `
          + 'los saldos solo se mueven cuando alguien presiona Sincronizar.'
        : `Corrió ${ago(pollAt)}; último recibo leído ${ago(h.last_purchases_cursor)}.`,
    },
    {
      key: 'webhook',
      icon: Zap,
      // A dead hook is a warning, not a failure: the 5-minute poll still runs.
      tone: hookStale ? 'warn' : 'ok',
      label: hookStale ? 'Sin entregas en tiempo real' : 'Tiempo real activo',
      detail: hookStale
        ? `Última entrega de Loyverse: ${ago(h.last_webhook_at)}. Las ventas siguen llegando cada 5 minutos por el sondeo; `
          + 'revise que el webhook en Loyverse apunte a interlaken.edu.mx.'
        : `Loyverse avisó ${ago(h.last_webhook_at)} (${h.last_webhook_type || 'evento'}). Compras y recargas llegan en segundos.`,
    },
    {
      key: 'linked',
      icon: Link2Off,
      tone: unlinked === 0 ? 'ok' : unlinked > h.active_students / 2 ? 'bad' : 'warn',
      label: unlinked === 0
        ? 'Todos los alumnos vinculados'
        : `${unlinked} alumno(s) sin vincular a Loyverse`,
      detail: unlinked === 0
        ? `${h.linked_students} de ${h.active_students} alumnos activos.`
        : 'Sus compras llegan como “sin alumno vinculado”. Use Vincular Loyverse en Alumnos.',
    },
    {
      key: 'ledger',
      icon: AlertTriangle,
      tone: h.purchases_last_7d > 0 ? 'ok' : pollStale ? 'warn' : 'bad',
      label: h.purchases_last_7d > 0
        ? `${h.purchases_last_7d} compra(s) registradas en 7 días`
        : 'Sin compras registradas en 7 días',
      detail: h.purchases_last_7d > 0
        ? `Último movimiento ${ago(h.last_transaction_at)}.`
        : pollStale
          ? 'Esperado si el sondeo no corre: primero resuelva el sondeo.'
          : 'El sondeo corre pero no registra nada: probablemente el POS cobra el monedero '
            + 'de una forma que el lector de recibos no reconoce.',
    },
    {
      key: 'drift',
      icon: Scale,
      // No audit yet is a warning (the cron has not compared the roster); drift
      // is a warning too: the nightly re-read usually explains it, and a person
      // only needs to act if it survives the night.
      tone: !audit ? 'warn' : drifting === 0 ? 'ok' : 'warn',
      label: !audit
        ? 'Sin conciliación reciente'
        : drifting === 0
          ? 'Saldos conciliados con Loyverse'
          : `${drifting} alumno(s) con saldo por encima de Loyverse`,
      detail: !audit
        ? 'El sondeo aún no ha comparado el plantel completo con Loyverse.'
        : drifting === 0
          ? `${audit.compared} alumno(s) comparados ${ago(audit.at)}`
            + (audit.deferred > 0 ? `; ${audit.deferred} en espera por movimientos recientes.` : '.')
          : `Diferencia total $${driftTotal.toFixed(2)} (${ago(audit.at)}). Si persiste después del `
            + 'repaso nocturno, revise la pestaña Reconciliación.',
    },
    {
      key: 'roster',
      icon: Users,
      tone: rosterIssues.length === 0 ? 'ok' : 'warn',
      label: rosterIssues.length === 0 ? 'Plantel alineado con Loyverse' : rosterLabel.join(', '),
      detail: rosterIssues.length === 0
        ? 'Ningún alumno sin cliente en Loyverse ni cliente de alumno sin vincular.'
          + (parked > 0 ? ` ${parked} recibo(s) sin alumno (tarjetas de personal o de prueba).` : '')
        : 'Los enlaces obsoletos son alumnos cuyo cliente ya no existe en Loyverse (bajas): '
          + 'Alumnos → Vincular Loyverse → Dar de baja. Los alumnos nuevos se vinculan solos cada '
          + 'madrugada y sus recibos pendientes se aplican en ese momento.',
    },
    {
      key: 'backup',
      icon: DatabaseBackup,
      tone: backupStale ? 'bad' : h.backup?.offsite ? 'ok' : 'warn',
      label: backupStale
        ? (h.backup && !h.backup.ok ? 'El respaldo de anoche falló' : 'Sin respaldo reciente')
        : h.backup?.offsite ? 'Respaldo nocturno al día' : 'Respaldo nocturno al día, sin copia externa',
      detail: backupStale
        ? `Último respaldo correcto: ${ago(h.backup?.ok ? h.backup.at : null)}. Mientras tanto no existe una copia reciente de los datos.`
        : `${Math.round((h.backup?.size ?? 0) / 1024)} KB, ${ago(h.backup?.at ?? null)}`
          + (h.backup?.offsite
            ? `; copia externa ${ago(h.backup.offsite_at)}.`
            : '. Solo existe en el propio servidor: configure el almacenamiento externo para tener una copia fuera.'),
    },
  ];
}

/**
 * "¿Está funcionando la sincronización?" as a panel.
 *
 * This was previously answerable only by SSH-ing to the server and reading the
 * cron log, so in practice nobody could answer it — the balances just drifted
 * and the cause stayed invisible.
 */
export function SyncHealthPanel() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['cafeteria-sync-health'],
    queryFn: async () => (await cafeteriaApi.syncHealth()).data,
    staleTime: 60_000,
  });

  if (isLoading || isError || !data) return null;
  const checks = buildChecks(data);
  const worst: Tone = checks.some((c) => c.tone === 'bad')
    ? 'bad' : checks.some((c) => c.tone === 'warn') ? 'warn' : 'ok';

  return (
    <section aria-label="Estado de la sincronización" className="mb-4">
      <h2 className="mb-2 flex items-center gap-1.5 font-head text-[13px] font-bold uppercase tracking-wider text-subtle">
        Estado de la sincronización
        {worst === 'ok' ? (
          <CheckCircle2 size={14} className="text-green-dark" aria-label="Todo en orden" />
        ) : (
          <AlertTriangle size={14} className={worst === 'bad' ? 'text-coral' : 'text-amber'} aria-label="Requiere atención" />
        )}
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {checks.map((c) => {
          const Icon = c.tone === 'ok' ? CheckCircle2 : c.icon;
          return (
            <li key={c.key} className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${TONE[c.tone]}`}>
              <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold">{c.label}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{c.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {worst !== 'ok' && (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] text-subtle">
          <HelpCircle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          Resuelva de arriba hacia abajo: una falla temprana hace que las siguientes no signifiquen nada.
        </p>
      )}
    </section>
  );
}

export default SyncHealthPanel;
