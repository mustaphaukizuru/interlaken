import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { AlertTriangle, CheckCircle2, HelpCircle, Link2Off, PlugZap, Timer } from 'lucide-react';
import { cafeteriaApi, type SyncHealth } from '@/services/api';

type Tone = 'ok' | 'warn' | 'bad';

const TONE: Record<Tone, string> = {
  ok: 'border-green/30 bg-green/5 text-green-dark',
  warn: 'border-amber/30 bg-amber/5 text-amber',
  bad: 'border-coral/30 bg-coral/5 text-coral-dark',
};

/** How stale the poll cursor may get before it means "nothing is polling". */
const STALE_HOURS = 6;

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
  const cursorHours = hoursSince(h.last_purchases_cursor);
  const pollStale = cursorHours === null || cursorHours > STALE_HOURS;
  const unlinked = h.active_students - h.linked_students;

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
        ? `Último recibo leído: ${ago(h.last_purchases_cursor)}. Si no corre cada 5 minutos, `
          + 'los saldos solo se mueven cuando alguien presiona Sincronizar.'
        : `Último recibo leído ${ago(h.last_purchases_cursor)}.`,
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
