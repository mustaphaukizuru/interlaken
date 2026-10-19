/**
 * Scheduled application of card top-ups (backend: apps/cafeteria/schedule.py).
 *
 * Loyverse points cannot be written by API, so a paid card top-up reaches the
 * cafeteria balance only after the school types it into the POS: every school
 * day at 7:30, or right away when the family sends its comprobante by WhatsApp.
 * Dates are shown in the school's time zone whatever the parent's device says.
 */
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

/** The school's message about when a card top-up reaches the balance (as the school wrote it). */
export function applyNotice(policy?: Pick<TopUpPolicy, 'apply_time' | 'whatsapp'> | null): string {
  const clock = formatClock(policy?.apply_time || DEFAULT_APPLY_TIME);
  const whatsapp = policy?.whatsapp ?? DEFAULT_WHATSAPP;
  const base = sentence(`Después de realizar el pago, el saldo se actualizará al siguiente día hábil a las ${clock}`);
  if (!whatsapp) return base;
  return `${base} Si necesitas que se aplique de inmediato, para que tu hijo use el saldo el mismo día, `
    + `favor de mandar un mensaje por WhatsApp al ${formatWhatsapp(whatsapp)} con el comprobante de pago, `
    + 'para que te ayudemos.';
}

/** True when card top-ups wait for the POS load (the default). */
export const isScheduled = (policy?: Pick<TopUpPolicy, 'mode'> | null) => (policy?.mode ?? 'scheduled') === 'scheduled';
