/**
 * Scheduled application of card top-ups (backend: apps/cafeteria/schedule.py).
 *
 * Loyverse points cannot be written by API, so a paid card top-up reaches the
 * cafeteria balance only after the school types it into the POS: every school
 * day at 7:30, or right away when the family sends its comprobante by WhatsApp.
 * Dates are shown in the school's time zone whatever the parent's device says.
 */
import { formatMXN } from '@/lib/format';
import type { TopUpPolicy } from '@/types';

export const SCHOOL_TZ = 'America/Mexico_City';

/** Fallbacks while the policy has not loaded (the backend defaults). */
export const DEFAULT_APPLY_TIME = '07:30';
export const DEFAULT_WHATSAPP = '5553791188';

const partsOf = (d: Date) => {
  const parts = new Intl.DateTimeFormat('es-MX', {
    timeZone: SCHOOL_TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    weekday: get('weekday'), day: get('day'), month: get('month'), year: get('year'),
    hour: Number(get('hour')), minute: get('minute'),
  };
};

/** Today's date in the school's time zone, as the API's `YYYY-MM-DD`. */
export function schoolToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SCHOOL_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** "07:30" (or a Date) → "7:30 a.m." */
export function formatClock(value: string | Date): string {
  let hour: number;
  let minute: string;
  if (typeof value === 'string') {
    const [h, m] = value.split(':');
    hour = Number(h);
    minute = (m ?? '00').padStart(2, '0');
  } else {
    const p = partsOf(value);
    hour = p.hour;
    minute = p.minute;
  }
  if (!Number.isFinite(hour)) return value.toString();
  const meridiem = hour < 12 ? 'a.m.' : 'p.m.';
  return `${hour % 12 || 12}:${minute} ${meridiem}`;
}

const dayKey = (d: Date) => {
  const p = partsOf(d);
  return `${p.year}-${p.month}-${p.day}`;
};

/**
 * When a pending top-up will be applied, as a phrase that follows "se aplicará":
 * "hoy a las 7:30 a.m.", "mañana martes 20 de octubre a las 7:30 a.m." or
 * "el lunes 19 de octubre a las 7:30 a.m.".
 */
export function applyPhrase(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'el siguiente día hábil a las 7:30 a.m.';
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return 'el siguiente día hábil a las 7:30 a.m.';
  // Past its promised time and still waiting: never show a date already gone.
  if (when.getTime() < now.getTime() - 5 * 60 * 1000) return 'en la próxima carga del colegio';
  const p = partsOf(when);
  const date = `${p.weekday} ${p.day} de ${p.month}`;
  const clock = formatClock(when);
  if (dayKey(when) === dayKey(now)) return `hoy a las ${clock}`;
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (dayKey(when) === dayKey(tomorrow)) return `mañana ${date} a las ${clock}`;
  return `el ${date} a las ${clock}`;
}

/** Close a sentence without doubling the period of "a.m.". */
export const sentence = (text: string) => (text.endsWith('.') ? text : `${text}.`);

/** "55 5379 1188" */
export function formatWhatsapp(number: string): string {
  const d = number.replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}` : number;
}

/**
 * wa.me link to the school's WhatsApp with the request pre-written. Only the
 * folio and the amount travel in the URL: staff find everything else by folio.
 */
export function whatsappHref(number: string, { folio, amount }: { folio?: number | null; amount?: string | number }): string {
  const digits = number.replace(/\D/g, '').slice(-10);
  const lines = [
    'Hola, hice una recarga de cafetería en línea y necesito que se aplique hoy.',
    folio ? `Folio: ${folio}` : '',
    amount != null && amount !== '' ? `Monto: $${Number(amount).toFixed(2)}` : '',
    'Adjunto mi comprobante de pago.',
  ].filter(Boolean);
  return `https://wa.me/52${digits}?text=${encodeURIComponent(lines.join('\n'))}`;
}

/**
 * The school's message about when a card top-up reaches the balance (as the
 * school wrote it). With `auto_load: 'instant'` the app writes approvals up to
 * `auto_load_max` into the cafetería itself, so it says so instead.
 */
export function applyNotice(
  policy?: Pick<TopUpPolicy, 'apply_time' | 'whatsapp' | 'auto_load' | 'auto_load_max'> | null,
): string {
  const clock = formatClock(policy?.apply_time || DEFAULT_APPLY_TIME);
  const max = Number(policy?.auto_load_max ?? 0);
  if (policy?.auto_load === 'instant' && max > 0) {
    return `Al confirmarse el pago, el saldo se carga en la cafetería en unos segundos (recargas de hasta ${formatMXN(max)}). `
      + `Las recargas mayores se aplican cuando el colegio verifica el pago, a más tardar el siguiente día hábil a las ${clock}.`;
  }
  const whatsapp = policy?.whatsapp ?? DEFAULT_WHATSAPP;
  const base = sentence(`Después de realizar el pago, el saldo se actualizará al siguiente día hábil a las ${clock}`);
  if (!whatsapp) return base;
  return `${base} Si necesitas que se aplique de inmediato, para que tu hijo use el saldo el mismo día, `
    + `favor de mandar un mensaje por WhatsApp al ${formatWhatsapp(whatsapp)} con el comprobante de pago, `
    + 'para que te ayudemos.';
}

/** True when card top-ups wait for the POS load (the default). */
export const isScheduled = (policy?: Pick<TopUpPolicy, 'mode'> | null) => (policy?.mode ?? 'scheduled') === 'scheduled';

/** "123.45" → 12345 (whole cents, so sums never drift). */
const cents = (value: string | number | null | undefined) => Math.round(Number(value ?? 0) * 100) || 0;

/**
 * True when the paid card top-ups on their way bring the balance to or above
 * the family's low-balance level. Same rule as the alert e-mail (backend
 * `pending_covers_low_balance`): the family already paid, so «Saldo bajo»
 * would only alarm them. Nothing pending → false, the balance speaks alone.
 */
export function pendingCoversLowBalance(
  balance: string | number,
  threshold: string | number | null | undefined,
  pending: ReadonlyArray<{ amount: string }> = [],
): boolean {
  const onTheWay = pending.reduce((sum, t) => sum + cents(t.amount), 0);
  if (onTheWay <= 0) return false;
  return cents(balance) + onTheWay >= cents(threshold ?? '20');
}

/**
 * `applyPhrase` without the weekday and date for today and tomorrow, for the
 * short line under a balance: "hoy a las 7:30 a.m.", "mañana a las 7:30 a.m.",
 * "el lunes 23 de noviembre a las 7:30 a.m." (other days keep their date).
 */
export function applyPhraseShort(iso: string | null | undefined, now: Date = new Date()): string {
  const phrase = applyPhrase(iso, now);
  return phrase.startsWith('mañana ') ? `mañana a las ${formatClock(new Date(iso as string))}` : phrase;
}

/** "el lunes …" → "a partir del lunes …"; "en la próxima carga" → "a partir de la próxima carga". */
const fromWhen = (phrase: string) => {
  if (phrase.startsWith('el ')) return `a partir del ${phrase.slice(3)}`;
  if (phrase.startsWith('en ')) return `a partir de ${phrase.slice(3)}`;
  return `a partir de ${phrase}`;
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Whole cents → "$1,234.50" (the portal's one money format). */
export const formatCents = (centsValue: number) => formatMXN(centsValue / 100);
const money = formatCents;

/** Paid top-ups loaded the same day and time, and the balance once they are in. */
export interface ProjectionStep {
  /** What these top-ups add, in cents. */
  amount: number;
  count: number;
  /** "mañana viernes 20 de noviembre a las 7:30 a.m." (full, for screen readers). */
  phrase: string;
  /** "mañana a las 7:30 a.m." (short, for the visible line). */
  short: string;
  /** The balance after this step, in cents. */
  total: number;
}

export interface BalanceProjection {
  /** The real balance (what the cashier has in Loyverse), in cents. */
  balance: number;
  /** Everything paid and waiting, in cents. */
  pending: number;
  /** The balance once every paid top-up is loaded, in cents. */
  total: number;
  count: number;
  /** In load order; more than one only when the load dates differ. */
  steps: ProjectionStep[];
}

/**
 * Where a wallet is heading while paid card top-ups wait for the POS load:
 * the real balance stays the balance, the projection only adds what is paid.
 * In whole cents ($0.10 + $0.20 is $0.30, never $0.30000000000000004), the
 * same arithmetic as `pendingCoversLowBalance`. Null when nothing is pending,
 * so the balance speaks alone. The list must be the backend's PAID online
 * top-ups (`pending_topups`): refunded or applied ones are never in it.
 */
export function projectBalance(
  balance: string | number,
  pending: ReadonlyArray<{ amount: string; apply_due_at: string | null }> | null | undefined,
  now: Date = new Date(),
): BalanceProjection | null {
  const due = (iso: string | null) => {
    const t = iso ? new Date(iso).getTime() : NaN;
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
  };
  const items = (pending ?? [])
    .map((t) => ({ amount: cents(t.amount), apply_due_at: t.apply_due_at }))
    .filter((t) => t.amount > 0)
    .sort((a, b) => due(a.apply_due_at) - due(b.apply_due_at));
  if (!items.length) return null;
  const start = cents(balance);
  const steps: ProjectionStep[] = [];
  let running = start;
  for (const t of items) {
    running += t.amount;
    const phrase = applyPhrase(t.apply_due_at, now);
    const last = steps[steps.length - 1];
    if (last && last.phrase === phrase) {
      last.amount += t.amount;
      last.count += 1;
      last.total = running;
    } else {
      steps.push({ amount: t.amount, count: 1, phrase, short: applyPhraseShort(t.apply_due_at, now), total: running });
    }
  }
  return { balance: start, pending: running - start, total: running, count: items.length, steps };
}

/** "Recarga de $200.00 pagada" / "2 recargas pagadas por $300.00". */
const paidLabel = (count: number, amount: number) => (count === 1
  ? `Recarga de ${money(amount)} pagada`
  : `${count} recargas pagadas por ${money(amount)}`);

/**
 * The one short line under the projected balance:
 * "Recarga de $200.00 pagada · disponible mañana a las 7:30 a.m.",
 * "2 recargas pagadas por $300.00 · disponibles mañana a las 7:30 a.m." or,
 * when they load on different days, when all of it is there:
 * "2 recargas pagadas por $300.00 · todo disponible el lunes 23 de noviembre a las 7:30 a.m.".
 */
export function projectionSummary(p: BalanceProjection): string {
  const last = p.steps[p.steps.length - 1];
  const when = p.steps.length > 1 ? `todo disponible ${last.short}` : `${p.count > 1 ? 'disponibles' : 'disponible'} ${last.short}`;
  return `${paidLabel(p.count, p.pending)} · ${when}`;
}

/** One line per load day (several days only): "Mañana a las 7:30 a.m.: $250.00 · recarga de $100.00 pagada". */
export function projectionStepLine(step: ProjectionStep): string {
  return `${capitalize(step.short)}: ${money(step.total)} · ${paidLabel(step.count, step.amount).replace(/^R/, 'r')}`;
}

/**
 * The sentence screen readers get instead of the arrow: «Saldo actual $150.00.
 * Con la recarga pagada de $200.00 será $350.00 a partir de mañana viernes 20
 * de noviembre a las 7:30 a.m.»
 */
export function projectionSentence(p: BalanceProjection): string {
  const last = p.steps[p.steps.length - 1];
  const paid = p.count === 1
    ? `la recarga pagada de ${money(p.pending)}`
    : `las ${p.count} recargas pagadas por ${money(p.pending)}`;
  return `Saldo actual ${money(p.balance)}. ${sentence(`Con ${paid} será ${money(p.total)} ${fromWhen(last.phrase)}`)}`;
}
